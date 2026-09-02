"""Read-only watsonx Orchestrate tool for looking up Acme order status."""

import json
import os
import re
from datetime import date
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from ibm_watsonx_orchestrate.agent_builder.connections import (
    ConnectionType,
    ExpectedCredentials,
)
from ibm_watsonx_orchestrate.agent_builder.tools import ToolPermission, tool
from ibm_watsonx_orchestrate.run import connections
from pydantic import BaseModel, ConfigDict, Field, ValidationError

APP_ID = "acme_support_api"
REQUEST_TIMEOUT_SECONDS = 3.0
MAX_RESPONSE_BODY_BYTES = 64 * 1024
ORDER_ID_PATTERN = re.compile(r"^ACME-\d{4}$")


class OrderStatusBackendPayload(BaseModel):
    """Validated representation of the Support API order response."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    order_id: str = Field(alias="orderId")
    customer_name: str = Field(alias="customerName")
    status: Literal["processing", "shipped", "delayed", "delivered"]
    estimated_delivery_date: date = Field(alias="estimatedDeliveryDate")
    carrier: str
    tracking_number: str = Field(alias="trackingNumber")


class OrderStatusResult(BaseModel):
    """Safe, explicit result returned to the agent."""

    order_id: str = Field(description="Normalized Acme order identifier.")
    lookup_status: Literal["found", "not_found", "invalid", "unavailable"] = Field(
        description="Outcome of the order lookup."
    )
    order_status: str | None = Field(
        default=None, description="Current order status when the order exists."
    )
    customer_name: str | None = Field(
        default=None, description="Fictional customer name from the demo API."
    )
    estimated_delivery_date: str | None = Field(
        default=None, description="Estimated delivery date in YYYY-MM-DD format."
    )
    carrier: str | None = Field(default=None, description="Order carrier name.")
    tracking_number: str | None = Field(
        default=None, description="Order tracking number."
    )
    message: str = Field(description="Safe user-facing summary of the lookup.")
    error_code: str | None = Field(
        default=None,
        description="Stable diagnostic code when the lookup cannot return an order.",
    )


def normalize_order_id(order_id: str) -> str:
    """Normalize and validate an Acme order identifier.

    Args:
        order_id: Order identifier supplied by the user.

    Returns:
        The trimmed, uppercase identifier.

    Raises:
        ValueError: If the identifier does not match ``ACME-NNNN``.
    """

    normalized = order_id.strip().upper()
    if not ORDER_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Order ID must use the format ACME-NNNN.")
    return normalized


def _validated_base_url(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Connection field 'base_url' is required.")

    base_url = value.strip().rstrip("/")
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or not parsed.hostname:
        raise ValueError("Connection field 'base_url' must be a valid HTTP(S) URL.")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Connection field 'base_url' must not embed credentials.")
    if "?" in base_url or "#" in base_url:
        raise ValueError("Connection field 'base_url' must not include query or fragment data.")
    try:
        parsed.port
    except ValueError as error:
        raise ValueError("Connection field 'base_url' has an invalid port.") from error

    loopback_hosts = {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme == "http" and parsed.hostname.casefold() not in loopback_hosts:
        raise ValueError(
            "Connection field 'base_url' must use HTTPS except for local loopback."
        )
    return base_url


def _connection_settings() -> tuple[str, str | None]:
    credentials = dict(connections.key_value(APP_ID))
    prefix = f"WXO_CONNECTION_{APP_ID}_".casefold()
    environment_credentials = {
        key[len(prefix) :].casefold(): value
        for key, value in os.environ.items()
        if key.casefold().startswith(prefix)
    }
    for field in ("base_url", "api_token"):
        if not credentials.get(field) and environment_credentials.get(field):
            credentials[field] = environment_credentials[field]
    base_url = _validated_base_url(credentials.get("base_url"))
    api_token_value = credentials.get("api_token")
    api_token = (
        api_token_value.strip()
        if isinstance(api_token_value, str) and api_token_value.strip()
        else None
    )
    return base_url, api_token


def _unavailable(order_id: str, error_code: str, message: str) -> OrderStatusResult:
    return OrderStatusResult(
        order_id=order_id,
        lookup_status="unavailable",
        message=message,
        error_code=error_code,
    )


def _content_length_exceeds_decoded_limit(response: httpx.Response) -> bool:
    """Use Content-Length only when it describes the decoded identity body."""

    if response.headers.get("transfer-encoding"):
        return False

    content_encodings = {
        encoding.strip().casefold()
        for encoding in response.headers.get("content-encoding", "").split(",")
        if encoding.strip()
    }
    if any(encoding != "identity" for encoding in content_encodings):
        return False

    declared_length = response.headers.get("content-length")
    if declared_length is None:
        return False
    try:
        parsed_length = int(declared_length)
    except ValueError:
        return False
    return parsed_length >= 0 and parsed_length > MAX_RESPONSE_BODY_BYTES


def _read_limited_response_body(response: httpx.Response) -> bytes | None:
    """Read decoded response bytes without retaining a body over the limit."""

    if _content_length_exceeds_decoded_limit(response):
        return None

    body = bytearray()
    for chunk in response.iter_bytes():
        if len(body) + len(chunk) > MAX_RESPONSE_BODY_BYTES:
            return None
        body.extend(chunk)
    return bytes(body)


def _get_order_status_impl(order_id: str) -> OrderStatusResult:
    try:
        normalized = normalize_order_id(order_id)
    except (AttributeError, TypeError, ValueError):
        supplied = order_id.strip().upper() if isinstance(order_id, str) else ""
        return OrderStatusResult(
            order_id=supplied,
            lookup_status="invalid",
            message="Use an order ID in the format ACME-NNNN.",
            error_code="ORDER_ID_INVALID",
        )

    try:
        base_url, api_token = _connection_settings()
    except Exception:
        return _unavailable(
            normalized,
            "ORDER_STATUS_CONNECTION_UNAVAILABLE",
            "The order service connection is not configured. Try again later.",
        )

    headers = {"Accept": "application/json"}
    if api_token is not None:
        headers["Authorization"] = f"Bearer {api_token}"

    endpoint = f"{base_url}/orders/{quote(normalized, safe='')}"
    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            with client.stream("GET", endpoint, headers=headers) as response:
                if response.status_code == 404:
                    return OrderStatusResult(
                        order_id=normalized,
                        lookup_status="not_found",
                        message=f"No order was found for {normalized}.",
                        error_code="ORDER_NOT_FOUND",
                    )

                if not 200 <= response.status_code < 300:
                    return _unavailable(
                        normalized,
                        "ORDER_STATUS_SERVICE_ERROR",
                        "The order service could not complete the lookup. Try again later.",
                    )

                response_body = _read_limited_response_body(response)
    except httpx.TimeoutException:
        return _unavailable(
            normalized,
            "ORDER_STATUS_TIMEOUT",
            "The order service did not respond in time. Try again later.",
        )
    except httpx.RequestError:
        return _unavailable(
            normalized,
            "ORDER_STATUS_NETWORK_ERROR",
            "The order service is temporarily unavailable. Try again later.",
        )
    except Exception:
        return _unavailable(
            normalized,
            "ORDER_STATUS_UNAVAILABLE",
            "The order status could not be checked right now. Try again later.",
        )

    if response_body is None:
        return _unavailable(
            normalized,
            "ORDER_STATUS_INVALID_RESPONSE",
            "The order service returned an invalid response. Try again later.",
        )

    try:
        payload = OrderStatusBackendPayload.model_validate(json.loads(response_body))
    except (ValueError, ValidationError):
        return _unavailable(
            normalized,
            "ORDER_STATUS_INVALID_RESPONSE",
            "The order service returned an invalid response. Try again later.",
        )

    try:
        response_order_id = normalize_order_id(payload.order_id)
    except ValueError:
        return _unavailable(
            normalized,
            "ORDER_STATUS_INVALID_RESPONSE",
            "The order service returned an invalid response. Try again later.",
        )

    if response_order_id != normalized:
        return _unavailable(
            normalized,
            "ORDER_STATUS_MISMATCH",
            "The order service returned an unexpected order. Try again later.",
        )

    return OrderStatusResult(
        order_id=payload.order_id,
        lookup_status="found",
        order_status=payload.status,
        customer_name=payload.customer_name,
        estimated_delivery_date=payload.estimated_delivery_date.isoformat(),
        carrier=payload.carrier,
        tracking_number=payload.tracking_number,
        message=(
            f"Order {payload.order_id} is {payload.status}. "
            f"Estimated delivery: {payload.estimated_delivery_date.isoformat()}; "
            f"carrier: {payload.carrier}; tracking: {payload.tracking_number}."
        ),
    )


@tool(
    name="get_order_status",
    display_name="Get order status",
    description=(
        "Looks up a specific Acme order in the Support API and returns only "
        "validated status facts. Use it whenever a user asks about a concrete order."
    ),
    permission=ToolPermission.READ_ONLY,
    expected_credentials=[
        ExpectedCredentials(app_id=APP_ID, type=ConnectionType.KEY_VALUE)
    ],
)
def get_order_status(order_id: str) -> OrderStatusResult:
    """Look up an Acme order without changing any external data.

    Args:
        order_id: The Acme order identifier in ``ACME-NNNN`` format.

    Returns:
        A validated result that distinguishes found, not found, invalid, and
        temporarily unavailable outcomes without exposing raw exceptions.
    """

    return _get_order_status_impl(order_id)
