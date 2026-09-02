"""Offline validator for the public Store Support Agent source package."""

from __future__ import annotations

import importlib.metadata
import re
import sys
import tempfile
import tomllib
from pathlib import Path
from types import SimpleNamespace

import yaml

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
_OFFLINE_CONFIG = tempfile.TemporaryDirectory(prefix="acme-wxo-offline-")
OFFLINE_CONFIG_ROOT = Path(_OFFLINE_CONFIG.name)

from ibm_watsonx_orchestrate_core.utils import config as adk_config

adk_config.DEFAULT_CONFIG_FILE_FOLDER = str(OFFLINE_CONFIG_ROOT / "config")
adk_config.AUTH_CONFIG_FILE_FOLDER = str(OFFLINE_CONFIG_ROOT / "cache")
adk_config.Config.__init__.__defaults__ = (
    adk_config.DEFAULT_CONFIG_FILE_FOLDER,
    adk_config.DEFAULT_CONFIG_FILE,
)

from ibm_watsonx_orchestrate.agent_builder.agents.agent import Agent
from ibm_watsonx_orchestrate.agent_builder.connections import (
    ConnectionEnvironment,
    ConnectionSecurityScheme,
    ConnectionType,
)
from ibm_watsonx_orchestrate.agent_builder.knowledge_bases.knowledge_base import (
    KnowledgeBase,
)
from ibm_watsonx_orchestrate.agent_builder.tools import ToolPermission
from ibm_watsonx_orchestrate.agent_builder.tools import utils as tool_utils

AGENT = PACKAGE_ROOT / "agents" / "store_support_agent.yaml"
TEMPLATE = PACKAGE_ROOT / "agents" / "store_support_agent.template.yaml"
KB = PACKAGE_ROOT / "knowledge_bases" / "acme_return_policy.yaml"
CASES = PACKAGE_ROOT / "tests" / "agent-cases.yaml"
PYPROJECT = PACKAGE_ROOT / "pyproject.toml"
EXPECTED_ADK = "2.15.0"
PLACEHOLDER = "__WXO_MODEL_ID__"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_python_and_lock() -> None:
    require(
        sys.version_info[:2] == (3, 12),
        f"Python 3.12 is required; found {sys.version.split()[0]}",
    )
    actual_adk = importlib.metadata.version("ibm-watsonx-orchestrate")
    require(actual_adk == EXPECTED_ADK, f"Expected ADK {EXPECTED_ADK}; found {actual_adk}")

    project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]
    require(
        "ibm-watsonx-orchestrate==2.15.0" in project["dependencies"],
        "pyproject.toml must pin ibm-watsonx-orchestrate==2.15.0",
    )
    lock = PACKAGE_ROOT / "uv.lock"
    require(lock.is_file(), "uv.lock is missing")
    lock_text = lock.read_text(encoding="utf-8")
    require(
        'name = "ibm-watsonx-orchestrate"' in lock_text
        and 'version = "2.15.0"' in lock_text,
        "uv.lock does not contain ADK 2.15.0",
    )


def validate_agent() -> None:
    agent = Agent.from_spec(str(AGENT))
    require(agent.spec_version.value == "v1", "Agent spec_version must be v1")
    require(agent.kind.value == "native", "Agent kind must be native")
    require(agent.name == "store_support_agent", "Unexpected agent name")
    require(agent.style.value == "react_core", "Agent style must be react_core")
    require(agent.restrictions.value == "editable", "Agent must remain editable")
    require(agent.tools == ["get_order_status"], "Agent tool list is not deterministic")
    require(
        agent.knowledge_base == ["acme_return_policy"],
        "Agent knowledge base reference is incorrect",
    )

    template = TEMPLATE.read_text(encoding="utf-8")
    require(template.count(PLACEHOLDER) == 1, "Agent template placeholder is invalid")
    template_data = yaml.safe_load(template.replace(PLACEHOLDER, agent.llm))
    template_agent = Agent.model_validate(template_data)
    require(template_agent.name == agent.name, "Template changes the agent identity")


def validate_knowledge_base() -> None:
    kb = KnowledgeBase.from_spec(str(KB))
    kb.validate_documents_or_index_exists()
    require(kb.name == "acme_return_policy", "Unexpected knowledge base name")
    require(len(kb.documents or []) == 1, "Knowledge base must use exactly one document")
    relative = Path((kb.documents or [""])[0])
    require(not relative.is_absolute(), "Knowledge document path must be relative")
    resolved = (KB.parent / relative).resolve()
    require(
        resolved == PACKAGE_ROOT / "knowledge" / "return-policy.txt",
        "Knowledge document resolves outside its expected portable path",
    )
    require(resolved.is_file(), "Knowledge document is missing")


def validate_tool() -> None:
    if str(PACKAGE_ROOT) not in sys.path:
        sys.path.insert(0, str(PACKAGE_ROOT))
    from tools.get_order_status import get_order_status

    require(
        get_order_status.permission is ToolPermission.READ_ONLY,
        "get_order_status must be read-only",
    )
    require(
        len(get_order_status.expected_credentials) == 1,
        "Tool must declare exactly one expected connection",
    )
    expected = get_order_status.expected_credentials[0]
    require(expected.app_id == "acme_support_api", "Unexpected tool connection app_id")
    require(expected.type is ConnectionType.KEY_VALUE, "Connection must use KEY_VALUE")
    spec = get_order_status.__tool_spec__
    require(spec.name == "get_order_status", "Unexpected tool name")
    require(spec.output_schema.type == "object", "Tool output must use an explicit model")

    offline_connection = SimpleNamespace(
        app_id="acme_support_api",
        connection_id="offline-connection-id",
        environment=ConnectionEnvironment.DRAFT,
        security_scheme=ConnectionSecurityScheme.KEY_VALUE,
        auth_type=None,
    )

    class OfflineConnectionsClient:
        def get(self, app_id: str) -> SimpleNamespace | None:
            return offline_connection if app_id == "acme_support_api" else None

        def list(self) -> list[SimpleNamespace]:
            return [offline_connection]

    original_client_factory = tool_utils.get_connections_client
    original_is_local_dev = tool_utils.is_local_dev
    tool_utils.get_connections_client = lambda: OfflineConnectionsClient()
    tool_utils.is_local_dev = lambda: True
    try:
        extracted = tool_utils.extract_python_tools(
            file=str(PACKAGE_ROOT / "tools" / "get_order_status.py"),
            requirements_file=str(PACKAGE_ROOT / "tools" / "requirements.txt"),
            app_ids=["acme_support_api"],
            log_requirements_path=False,
        )
    finally:
        tool_utils.get_connections_client = original_client_factory
        tool_utils.is_local_dev = original_is_local_dev

    require(len(extracted) == 1, "ADK import extractor did not find exactly one tool")
    extracted_spec = extracted[0].__tool_spec__
    require(
        extracted_spec.binding.python.function == "get_order_status:get_order_status",
        "ADK import binding is not portable",
    )
    require(
        extracted_spec.binding.python.requirements
        == ["httpx==0.28.1", "pydantic==2.13.4"],
        "ADK import requirements differ from tools/requirements.txt",
    )
    require(
        extracted_spec.binding.python.connections
        == {"acme_support_api": "offline-connection-id"},
        "ADK import extractor did not bind the expected connection",
    )


def validate_cases() -> None:
    cases = yaml.safe_load(CASES.read_text(encoding="utf-8"))["cases"]
    require(len(cases) >= 10, "At least 10 agent cases are required")
    case_ids = [case["id"] for case in cases]
    require(len(case_ids) == len(set(case_ids)), "Agent case IDs must be unique")
    categories = {case["category"] for case in cases}
    required = {
        "status_existing",
        "missing_order_id",
        "status_not_found",
        "policy_only",
        "combined_status_policy",
        "damaged_product",
        "personalized_product",
        "anti_hallucination",
        "tool_failure",
        "case_creation_boundary",
    }
    require(required <= categories, "Agent case catalog is missing required coverage")


def validate_security() -> None:
    prohibited_files = [PACKAGE_ROOT / ".env", PACKAGE_ROOT / ".env.local"]
    require(not any(item.exists() for item in prohibited_files), "A real .env file is present")

    obvious_secret_patterns = [
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
        re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
        re.compile(r"\bsk-[A-Za-z0-9_-]{24,}\b"),
    ]
    scanned_extensions = {".py", ".ps1", ".yaml", ".yml", ".toml", ".txt", ".md"}
    mac_user_prefix = "/" + "Users" + "/"
    windows_user_prefix = "C:" + "\\" + "Users" + "\\"
    for path in PACKAGE_ROOT.rglob("*"):
        if not path.is_file() or ".venv" in path.parts or path.suffix not in scanned_extensions:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        require(mac_user_prefix not in content, f"Absolute user path found in {path.name}")
        require(windows_user_prefix not in content, f"Absolute user path found in {path.name}")
        for pattern in obvious_secret_patterns:
            require(not pattern.search(content), f"Potential secret found in {path.name}")


def main() -> int:
    checks = [
        ("Python and locked ADK", validate_python_and_lock),
        ("agent YAML", validate_agent),
        ("knowledge base YAML and document", validate_knowledge_base),
        ("Python tool metadata", validate_tool),
        ("offline agent cases", validate_cases),
        ("secret and absolute-path scan", validate_security),
    ]
    for label, check in checks:
        check()
        print(f"PASS: {label}")
    print("Local validation completed without tenant access.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    finally:
        _OFFLINE_CONFIG.cleanup()
