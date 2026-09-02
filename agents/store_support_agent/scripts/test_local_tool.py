"""Exercise get_order_status against a running local Acme Support API."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from tools.get_order_status import get_order_status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4000")
    parser.add_argument(
        "--order-id",
        action="append",
        dest="order_ids",
        help="Order to check; may be repeated.",
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")

    try:
        response = httpx.get(f"{base_url}/health", timeout=3.0, follow_redirects=False)
        response.raise_for_status()
    except (httpx.HTTPError, ValueError) as error:
        print(f"Local Support API health check failed: {type(error).__name__}", file=sys.stderr)
        return 1

    os.environ["WXO_SECURITY_SCHEMA_acme_support_api"] = "key_value_creds"
    os.environ["WXO_CONNECTION_acme_support_api_base_url"] = base_url
    optional_token = os.environ.get("ACME_SUPPORT_API_TOKEN", "").strip()
    if optional_token:
        os.environ["WXO_CONNECTION_acme_support_api_api_token"] = optional_token

    order_ids = args.order_ids or ["ACME-1042", "ACME-2048", "ACME-4040"]
    expected = {
        "ACME-1042": "found",
        "ACME-2048": "found",
        "ACME-4040": "not_found",
    }
    failures = 0
    for order_id in order_ids:
        result = get_order_status.fn(order_id)
        print(result.model_dump_json(exclude_none=True))
        expected_outcome = expected.get(order_id.upper())
        if expected_outcome is not None and result.lookup_status != expected_outcome:
            failures += 1
            print(
                f"Unexpected outcome for {order_id}: {result.lookup_status}; "
                f"expected {expected_outcome}",
                file=sys.stderr,
            )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
