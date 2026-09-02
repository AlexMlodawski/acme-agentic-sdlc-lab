"""Materialize a tenant-reviewable agent YAML from the model template."""

from __future__ import annotations

import argparse
import re
import tempfile
from pathlib import Path

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

PLACEHOLDER = "__WXO_MODEL_ID__"
MODEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{2,254}$")


def materialize(template: Path, output: Path, model_id: str) -> None:
    """Render and validate an agent definition without contacting a tenant."""

    if not MODEL_ID_PATTERN.fullmatch(model_id):
        raise ValueError(
            "Model ID must contain only letters, digits, dots, underscores, colons, "
            "slashes, or hyphens."
        )

    source = template.read_text(encoding="utf-8")
    if source.count(PLACEHOLDER) != 1:
        raise ValueError(f"Template must contain exactly one {PLACEHOLDER} placeholder.")

    rendered = source.replace(PLACEHOLDER, model_id)
    parsed = yaml.safe_load(rendered)
    agent = Agent.model_validate(parsed)
    if agent.name != "store_support_agent" or agent.llm != model_id:
        raise ValueError("Materialized agent identity or model does not match the request.")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(rendered, encoding="utf-8", newline="\n")
    temporary.replace(output)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model-id",
        default="groq/openai/gpt-oss-120b",
        help="Model identifier to place in the materialized agent definition.",
    )
    parser.add_argument(
        "--template",
        type=Path,
        default=PACKAGE_ROOT / "agents" / "store_support_agent.template.yaml",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PACKAGE_ROOT / "agents" / "store_support_agent.yaml",
    )
    args = parser.parse_args()
    materialize(args.template.resolve(), args.output.resolve(), args.model_id)
    print(f"Materialized {args.output} with model {args.model_id} (offline validation passed).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        _OFFLINE_CONFIG.cleanup()
