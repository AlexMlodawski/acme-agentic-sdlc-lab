"""Offline structural and deterministic tests for agent package artifacts."""

from __future__ import annotations

import importlib.metadata
import re
from pathlib import Path

import yaml
from ibm_watsonx_orchestrate.agent_builder.agents.agent import Agent
from ibm_watsonx_orchestrate.agent_builder.knowledge_bases.knowledge_base import (
    KnowledgeBase,
)

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
AGENT_FILE = PACKAGE_ROOT / "agents" / "store_support_agent.yaml"
AGENT_TEMPLATE = PACKAGE_ROOT / "agents" / "store_support_agent.template.yaml"
KB_FILE = PACKAGE_ROOT / "knowledge_bases" / "acme_return_policy.yaml"
CASES_FILE = PACKAGE_ROOT / "tests" / "agent-cases.yaml"
DEFAULT_MODEL = "groq/openai/gpt-oss-120b"
OFFLINE_EXAMPLE_HEADER = (
    "# Offline example only. Re-materialize with a model confirmed in your own "
    "Draft tenant.\n"
)


def test_exact_adk_version_is_installed() -> None:
    assert importlib.metadata.version("ibm-watsonx-orchestrate") == "2.15.0"


def test_materialized_agent_validates_with_pinned_adk() -> None:
    agent = Agent.from_spec(str(AGENT_FILE))
    assert agent.spec_version.value == "v1"
    assert agent.kind.value == "native"
    assert agent.name == "store_support_agent"
    assert agent.display_name == "Store Support Agent"
    assert agent.llm == DEFAULT_MODEL
    assert agent.style.value == "react_core"
    assert agent.restrictions.value == "editable"
    assert agent.tools == ["get_order_status"]
    assert agent.knowledge_base == ["acme_return_policy"]
    assert agent.starter_prompts is not None
    assert len(agent.starter_prompts.prompts) == 3
    assert [prompt.id for prompt in agent.starter_prompts.prompts] == [
        "acme-order-status",
        "acme-return-window",
        "acme-case-boundary",
    ]


def test_template_materializes_to_checked_in_agent() -> None:
    template = AGENT_TEMPLATE.read_text(encoding="utf-8")
    assert template.count("__WXO_MODEL_ID__") == 1
    materialized = template.replace("__WXO_MODEL_ID__", DEFAULT_MODEL)
    checked_in = AGENT_FILE.read_text(encoding="utf-8")
    assert checked_in.startswith(OFFLINE_EXAMPLE_HEADER)
    assert materialized == checked_in.removeprefix(OFFLINE_EXAMPLE_HEADER)

    parsed = yaml.safe_load(materialized)
    agent = Agent.model_validate(parsed)
    assert agent.llm == DEFAULT_MODEL


def test_agent_instructions_cover_required_safety_boundaries() -> None:
    instructions = yaml.safe_load(AGENT_FILE.read_text(encoding="utf-8"))[
        "instructions"
    ].lower()
    normalized_instructions = " ".join(instructions.split())
    required_phrases = [
        "always call get_order_status",
        "ask for an id",
        "do not guess",
        "knowledge base",
        "separate order-specific facts",
        "never promise or approve a refund",
        "never create a support case",
        "cannot be checked right now",
        "do not reveal",
    ]
    for phrase in required_phrases:
        assert phrase in normalized_instructions


def test_knowledge_base_validates_and_uses_one_relative_document() -> None:
    kb = KnowledgeBase.from_spec(str(KB_FILE))
    kb.validate_documents_or_index_exists()
    assert kb.name == "acme_return_policy"
    assert kb.documents == ["../knowledge/return-policy.txt"]

    document = Path(kb.documents[0])
    assert not document.is_absolute()
    resolved = (KB_FILE.parent / document).resolve()
    assert resolved == PACKAGE_ROOT / "knowledge" / "return-policy.txt"
    assert resolved.is_file()


def test_return_policy_has_all_deterministic_rules() -> None:
    policy = (PACKAGE_ROOT / "knowledge" / "return-policy.txt").read_text(
        encoding="utf-8"
    ).lower()
    for expected in [
        "30 calendar days",
        "14 calendar days",
        "48 hours",
        "prepaid return label",
        "personalized products",
        "final sale",
        "does not authorize an automatic promise of a refund",
        "does not create a support case",
    ]:
        assert expected in policy


def test_agent_case_catalog_has_required_coverage() -> None:
    catalog = yaml.safe_load(CASES_FILE.read_text(encoding="utf-8"))
    cases = catalog["cases"]
    assert len(cases) >= 10
    assert len({case["id"] for case in cases}) == len(cases)
    categories = {case["category"] for case in cases}
    assert {
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
    } <= categories

    for case in cases:
        assert case["user_input"].strip()
        assert case["expected"]["behavior"]


def test_runtime_yaml_contains_no_absolute_paths_or_secret_values() -> None:
    mac_user_prefix = "/" + "Users" + "/"
    windows_user_prefix = "C:" + "\\" + "Users" + "\\"
    for config_file in (AGENT_FILE, AGENT_TEMPLATE, KB_FILE):
        text = config_file.read_text(encoding="utf-8")
        assert mac_user_prefix not in text
        assert windows_user_prefix not in text
        assert not re.search(r"(?im)^\s*(api_token|password|api_key):\s*\S+", text)
