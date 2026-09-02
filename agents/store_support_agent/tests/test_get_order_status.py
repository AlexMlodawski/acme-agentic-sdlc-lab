"""Unit tests for the ADK tool and its connection boundary."""

from __future__ import annotations

import json

import httpx
import pytest
from ibm_watsonx_orchestrate.agent_builder.connections import ConnectionType
from ibm_watsonx_orchestrate.agent_builder.tools import ToolPermission

import tools.get_order_status as module


def _record(order_id: str = "ACME-1042") -> dict[str, str]:
    return {
        "orderId": order_id,
        "customerName": "Jordan Lee",
        "status": "delayed",
        "estimatedDeliveryDate": "2026-08-26",
        "carrier": "Acme Express",
        "trackingNumber": "AX-88271042",
    }


def _install_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: httpx.MockTransport,
    captured_options: dict[str, object] | None = None,
) -> None:
    original_client = httpx.Client

    def client_factory(*args: object, **kwargs: object) -> httpx.Client:
        kwargs["transport"] = handler
        if captured_options is not None:
            captured_options.update(kwargs)
        return original_client(*args, **kwargs)

    monkeypatch.setattr(module.httpx, "Client", client_factory)


def test_normalizes_valid_order_id() -> None:
    assert module.normalize_order_id("  acme-1042 ") == "ACME-1042"


@pytest.mark.parametrize("value", ["", "1042", "ACME-42", "ACME-ABCD"])
def test_rejects_invalid_order_id(value: str) -> None:
    with pytest.raises(ValueError, match="ACME-NNNN"):
        module.normalize_order_id(value)


def test_tool_metadata_is_read_only_and_declares_key_value_connection() -> None:
    assert module.get_order_status.permission is ToolPermission.READ_ONLY
    assert len(module.get_order_status.expected_credentials) == 1
    expected = module.get_order_status.expected_credentials[0]
    assert expected.app_id == "acme_support_api"
    assert expected.type is ConnectionType.KEY_VALUE

    spec = module.get_order_status.__tool_spec__
    assert spec.name == "get_order_status"
    assert spec.permission is ToolPermission.READ_ONLY
    assert spec.output_schema.type == "object"
    assert "lookup_status" in (spec.output_schema.properties or {})


def test_success_uses_connection_and_optional_bearer_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {
            "base_url": "https://support.example.invalid/",
            "api_token": "test-token",
        },
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://support.example.invalid/orders/ACME-1042"
        assert request.headers["Authorization"] == "Bearer test-token"
        return httpx.Response(200, json=_record(), request=request)

    captured_options: dict[str, object] = {}
    _install_transport(monkeypatch, httpx.MockTransport(handler), captured_options)
    result = module.get_order_status.fn(" acme-1042 ")

    assert result.lookup_status == "found"
    assert result.order_id == "ACME-1042"
    assert result.order_status == "delayed"
    assert result.error_code is None
    assert captured_options["trust_env"] is False


def test_connection_environment_lookup_is_case_insensitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module.connections, "key_value", lambda app_id: {})
    monkeypatch.setenv(
        "WXO_CONNECTION_ACME_SUPPORT_API_BASE_URL",
        "https://support.example.invalid",
    )
    monkeypatch.setenv(
        "WXO_CONNECTION_ACME_SUPPORT_API_API_TOKEN",
        "test-token",
    )

    assert module._connection_settings() == (
        "https://support.example.invalid",
        "test-token",
    )


def test_connection_environment_fills_only_missing_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://configured.example.invalid"},
    )
    monkeypatch.setenv(
        "WXO_CONNECTION_ACME_SUPPORT_API_BASE_URL",
        "https://environment.example.invalid",
    )
    monkeypatch.setenv(
        "WXO_CONNECTION_ACME_SUPPORT_API_API_TOKEN",
        "test-token",
    )

    assert module._connection_settings() == (
        "https://configured.example.invalid",
        "test-token",
    )


@pytest.mark.parametrize(
    "base_url",
    [
        "http://support.example.invalid",
        "https://user:password@support.example.invalid",
        "https://support.example.invalid?",
        "https://support.example.invalid?region=internal",
        "https://support.example.invalid#private",
        "https://support.example.invalid:99999",
    ],
)
def test_rejects_unsafe_connection_urls_before_sending_a_token(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {
            "base_url": base_url,
            "api_token": "SENTINEL-TRANSPORT-TOKEN",
        },
    )
    requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json=_record(), request=request)

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert requests == 0
    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_CONNECTION_UNAVAILABLE"
    assert "SENTINEL-TRANSPORT-TOKEN" not in result.message


@pytest.mark.parametrize(
    "base_url",
    ["http://localhost:4000", "http://127.0.0.1:4000", "http://[::1]:4000"],
)
def test_allows_plain_http_only_for_exact_loopback_hosts(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": base_url},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_record(), request=request)

    _install_transport(monkeypatch, httpx.MockTransport(handler))

    assert module.get_order_status.fn("ACME-1042").lookup_status == "found"


def test_does_not_follow_service_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {
            "base_url": "https://support.example.invalid",
            "api_token": "SENTINEL-REDIRECT-TOKEN",
        },
    )
    requested_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(
            302,
            headers={"location": "http://redirect.example.invalid/orders/ACME-1042"},
            request=request,
        )

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert requested_urls == ["https://support.example.invalid/orders/ACME-1042"]
    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_SERVICE_ERROR"


def test_not_found_is_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"code": "ORDER_NOT_FOUND"}, request=request)

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-4040")

    assert result.lookup_status == "not_found"
    assert result.error_code == "ORDER_NOT_FOUND"
    assert "ACME-4040" in result.message


def test_invalid_json_is_not_exposed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text="definitely-not-json",
            headers={"content-type": "application/json"},
            request=request,
        )

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_INVALID_RESPONSE"
    assert "definitely-not-json" not in result.message


def test_oversized_streamed_json_is_rejected_without_exposing_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )
    monkeypatch.setattr(module, "MAX_RESPONSE_BODY_BYTES", 128)
    oversized_marker = "oversized-private-marker"
    record = _record()
    record["customerName"] = oversized_marker * 32
    body = json.dumps(record).encode("utf-8")
    chunks = [body[offset : offset + 64] for offset in range(0, len(body), 64)]
    chunks_read = 0

    class ChunkedBody(httpx.SyncByteStream):
        def __iter__(self):
            nonlocal chunks_read
            for chunk in chunks:
                chunks_read += 1
                yield chunk

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            stream=ChunkedBody(),
            request=request,
        )

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert json.loads(body)["orderId"] == "ACME-1042"
    assert chunks_read < len(chunks)
    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_INVALID_RESPONSE"
    assert oversized_marker not in result.message


def test_oversized_identity_content_length_fails_before_stream_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )

    class UnreadBody(httpx.SyncByteStream):
        def __iter__(self):
            raise AssertionError("oversized declared body must not be read")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-length": str(module.MAX_RESPONSE_BODY_BYTES + 1),
                "content-type": "application/json",
            },
            stream=UnreadBody(),
            request=request,
        )

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_INVALID_RESPONSE"


def test_invalid_payload_schema_is_not_exposed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )
    invalid_record = _record(order_id="NOT-AN-ACME-ID")
    invalid_record["status"] = "invented-status"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=invalid_record, request=request)

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_INVALID_RESPONSE"
    assert "invented-status" not in result.message


def test_network_error_is_not_exposed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        module.connections,
        "key_value",
        lambda app_id: {"base_url": "https://support.example.invalid"},
    )

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("private network detail", request=request)

    _install_transport(monkeypatch, httpx.MockTransport(handler))
    result = module.get_order_status.fn("ACME-1042")

    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_NETWORK_ERROR"
    assert "private network detail" not in result.message


def test_connection_error_does_not_leak_raw_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_connection(app_id: str) -> dict[str, str]:
        raise RuntimeError("real-secret-would-be-here")

    monkeypatch.setattr(module.connections, "key_value", fail_connection)
    result = module.get_order_status.fn("ACME-1042")

    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_CONNECTION_UNAVAILABLE"
    assert "real-secret" not in result.message


def test_invalid_input_does_not_read_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected_connection(app_id: str) -> dict[str, str]:
        raise AssertionError("connection must not be read")

    monkeypatch.setattr(module.connections, "key_value", unexpected_connection)
    result = module.get_order_status.fn("not-an-order")

    assert result.lookup_status == "invalid"
    assert result.error_code == "ORDER_ID_INVALID"
