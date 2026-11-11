"""The dev stack's signal targets send the signal the workflow listens for, to the workflow the alert names."""

import datetime
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _dry(*args: str) -> str:
    r = subprocess.run(
        ["make", "-s", "-n", "-f", str(ROOT / "Makefile"), "-C", str(ROOT), *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return r.stdout.strip()


@pytest.mark.parametrize("decision", ["retry", "abort"])
def test_a_parked_run_takes_retry_or_abort_on_the_retry_signal(decision):
    out = _dry(f"digest-{decision}", "WORKFLOW=digest-2026-11-10")
    assert out.endswith(
        f'temporal workflow signal --workflow-id digest-2026-11-10 --name retry --input \'{{"decision":"{decision}"}}\''
    )


@pytest.mark.parametrize("decision", ["retry", "abort"])
def test_the_workflow_defaults_to_the_dates_run_and_the_date_to_today_utc(decision):
    assert "--workflow-id digest-2026-09-18 " in _dry(f"digest-{decision}", "DATE=2026-09-18")
    today = datetime.datetime.now(datetime.UTC).date().isoformat()
    assert f"--workflow-id digest-{today} " in _dry(f"digest-{decision}")
