"""Local integration tests for the ADK 2.15.0 connection environment contract."""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import tools.get_order_status as module


ORDERS = {
    "ACME-1042": {
        "orderId": "ACME-1042",
        "customerName": "Jordan Lee",
        "status": "delayed",
        "estimatedDeliveryDate": "2026-08-26",
        "carrier": "Acme Express",
        "trackingNumber": "AX-88271042",
    },
    "ACME-2048": {
        "orderId": "ACME-2048",
        "customerName": "Casey Morgan",
        "status": "shipped",
        "estimatedDeliveryDate": "2026-08-28",
        "carrier": "Acme Express",
        "trackingNumber": "AX-88272048",
    },
}


class LocalSupportApiHandler(BaseHTTPRequestHandler):
    authorization_headers: list[str | None] = []

    def log_message(self, format: str, *args: object) -> None:
        return

    def _write(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.__class__.authorization_headers.append(self.headers.get("Authorization"))
        order_id = self.path.removeprefix("/orders/")
        if order_id == "ACME-9998":
            self._write(200, b"not-json", "application/json")
            return
        if order_id == "ACME-9999":
            time.sleep(0.2)
            self._write(200, json.dumps(ORDERS["ACME-1042"]).encode(), "application/json")
            return
        if order_id not in ORDERS:
            body = json.dumps({"code": "ORDER_NOT_FOUND"}).encode()
            self._write(404, body, "application/json")
            return
        body = json.dumps(ORDERS[order_id]).encode()
        self._write(200, body, "application/json")


@pytest.fixture
def local_support_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    LocalSupportApiHandler.authorization_headers = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), LocalSupportApiHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    monkeypatch.setenv("WXO_SECURITY_SCHEMA_acme_support_api", "key_value_creds")
    monkeypatch.setenv(
        "WXO_CONNECTION_acme_support_api_base_url",
        base_url,
    )
    monkeypatch.setenv(
        "WXO_CONNECTION_acme_support_api_api_token",
        "local-integration-token",
    )
    try:
        yield base_url
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize(
    ("order_id", "expected_lookup", "expected_status"),
    [
        ("ACME-1042", "found", "delayed"),
        ("ACME-2048", "found", "shipped"),
        ("ACME-4040", "not_found", None),
    ],
)
def test_official_environment_convention_and_order_outcomes(
    local_support_api: str,
    order_id: str,
    expected_lookup: str,
    expected_status: str | None,
) -> None:
    result = module.get_order_status.fn(order_id)

    assert result.lookup_status == expected_lookup
    assert result.order_status == expected_status
    assert LocalSupportApiHandler.authorization_headers[-1] == (
        "Bearer local-integration-token"
    )


def test_local_backend_invalid_json(local_support_api: str) -> None:
    result = module.get_order_status.fn("ACME-9998")
    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_INVALID_RESPONSE"


def test_local_backend_timeout(
    local_support_api: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "REQUEST_TIMEOUT_SECONDS", 0.03)
    result = module.get_order_status.fn("ACME-9999")
    assert result.lookup_status == "unavailable"
    assert result.error_code == "ORDER_STATUS_TIMEOUT"
