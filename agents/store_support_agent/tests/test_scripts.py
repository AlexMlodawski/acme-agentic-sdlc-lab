"""Offline tests for the public agent materializer."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import yaml
from ibm_watsonx_orchestrate.agent_builder.agents.agent import Agent

PACKAGE_ROOT = Path(__file__).resolve().parents[1]


def _load_materializer():
    script = PACKAGE_ROOT / "scripts" / "materialize_agent.py"
    spec = importlib.util.spec_from_file_location("materialize_agent", script)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_python_materializer_supports_model_override(tmp_path: Path) -> None:
    materializer = _load_materializer()
    output = tmp_path / "agent.yaml"
    model_id = "watsonx/ibm/example-reviewed-model"
    materializer.materialize(
        PACKAGE_ROOT / "agents" / "store_support_agent.template.yaml",
        output,
        model_id,
    )
    parsed = yaml.safe_load(output.read_text(encoding="utf-8"))
    agent = Agent.model_validate(parsed)
    assert agent.llm == model_id
    assert "__WXO_MODEL_ID__" not in output.read_text(encoding="utf-8")


@pytest.mark.parametrize("model_id", ["", "has whitespace/model", "$(unsafe)", "../../ unsafe"])
def test_python_materializer_rejects_unsafe_model_id(tmp_path: Path, model_id: str) -> None:
    materializer = _load_materializer()
    with pytest.raises(ValueError, match="Model ID"):
        materializer.materialize(
            PACKAGE_ROOT / "agents" / "store_support_agent.template.yaml",
            tmp_path / "agent.yaml",
            model_id,
        )


def test_public_agent_package_has_no_tenant_write_helper() -> None:
    scripts = {path.name for path in (PACKAGE_ROOT / "scripts").iterdir() if path.is_file()}
    assert "import-to-wxo.ps1" not in scripts
    assert "wxo_import_helper.py" not in scripts


def test_offline_scripts_never_delete_the_user_config_directory() -> None:
    for name in ("materialize_agent.py", "validate_local.py"):
        source = (PACKAGE_ROOT / "scripts" / name).read_text(encoding="utf-8")
        assert 'PACKAGE_ROOT / ".wxo-local-config"' not in source
        assert "TemporaryDirectory" in source
