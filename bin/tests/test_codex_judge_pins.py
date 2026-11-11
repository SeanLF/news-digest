"""The Codex judge's three pins move together, or `make judges` loses a family.

promptfoo 0.125.1's openai:codex-sdk provider refuses any @openai/codex-sdk outside ^0.156.1 (the run
errors on every Codex call), and the Makefile installs the Codex CLI that SDK drives. A bump of
promptfoo fails the first test until its required range is read again; a bump of either Codex pin
fails the second.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _evals_deps() -> dict[str, str]:
    return json.loads((ROOT / "evals" / "package.json").read_text())["dependencies"]


def _codex_cli() -> str:
    m = re.search(r"^CODEX_VERSION = (\S+)$", (ROOT / "Makefile").read_text(), re.M)
    assert m, "the Makefile no longer pins CODEX_VERSION"
    return m[1]


def test_codex_sdk_sits_in_the_range_promptfoo_0_125_1_requires():
    deps = _evals_deps()
    assert deps["promptfoo"] == "0.125.1", "promptfoo moved: read its codex-sdk range again and update this test"
    major, minor, patch = (int(x) for x in deps["@openai/codex-sdk"].split("."))
    assert (major, minor) == (0, 156) and patch >= 1


def test_the_codex_cli_the_judge_runs_is_the_sdks_own_version():
    assert _codex_cli() == _evals_deps()["@openai/codex-sdk"]
