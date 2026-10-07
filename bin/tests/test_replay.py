"""Tests for bin/replay: the plan format, the agent-file overrides, and the call-slot gate.

The docker steps are not run here; --dry-run pins the commands they would be.
"""

import threading
import time
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

import pytest

_loader = SourceFileLoader("replay", str(Path(__file__).resolve().parents[1] / "replay"))
replay = module_from_spec(spec_from_loader("replay", _loader))
_loader.exec_module(replay)

AGENT = "---\nname: select\nmodel: claude-sonnet-5-5\nthinking: adaptive\n---\nBody: keep\nmodel: in body\n"


def test_plan_lines_comments_and_overrides():
    plan = replay.parse_plan(
        "# effort sweep\n\nselect high1 319 select.effort=high  # note\n"
        "coherence haiku313 313 coherence.model=claude-haiku-5-5 coherence.effort=low\ncluster base 319\n"
    )
    assert [(p["mode"], p["label"], p["run"]) for p in plan] == [
        ("select", "high1", 319),
        ("coherence", "haiku313", 313),
        ("cluster", "base", 319),
    ]
    assert plan[1]["overrides"] == {"coherence": {"model": "claude-haiku-5-5", "effort": "low"}}
    assert plan[2]["overrides"] == {}


@pytest.mark.parametrize(
    "text, err",
    [
        ("write w1 319", "mode 'write'"),
        ("select a 319\nselect a 318", "label 'a' repeats"),
        ("select a", "expected MODE LABEL RUN"),
        ("select a 319 effort=high", "expected MODE LABEL RUN"),
    ],
)
def test_plan_refuses(text, err):
    with pytest.raises(replay.PlanError, match=err):
        replay.parse_plan(text)


def test_frontmatter_replaces_or_adds_and_never_touches_the_body():
    replaced = replay.set_frontmatter(AGENT, "model", "claude-haiku-5-5")
    assert "model: claude-haiku-5-5\nthinking" in replaced and "model: in body" in replaced
    added = replay.set_frontmatter(AGENT, "effort", "high")
    assert added.startswith("---\nname: select\nmodel: claude-sonnet-5-5\nthinking: adaptive\neffort: high\n---\n")
    assert added.endswith("Body: keep\nmodel: in body\n")


def test_build_agents_applies_overrides_and_refuses_an_unknown_stage(tmp_path):
    src = tmp_path / "agents"
    src.mkdir()
    (src / "select.md").write_text(AGENT)
    replay.build_agents(src, tmp_path / "v", {"select": {"effort": "high"}})
    assert "effort: high" in (tmp_path / "v" / "select.md").read_text()
    assert "effort" not in (src / "select.md").read_text()
    with pytest.raises(replay.PlanError, match="no agent file for stage 'selekt'"):
        replay.build_agents(src, tmp_path / "w", {"selekt": {"effort": "high"}})


def test_a_cluster_replay_holds_the_fanout_and_wide_takes_do_not_deadlock():
    assert replay.slots("cluster") == replay.CLUSTER_FANOUT and replay.slots("select") == 1
    gate, peak, live, lock = replay.Slots(4), [0], [0], threading.Lock()

    def job(k):
        gate.take(k)
        with lock:
            live[0] += k
            peak[0] = max(peak[0], live[0])
        time.sleep(0.01)
        with lock:
            live[0] -= k
        gate.give(k)

    threads = [threading.Thread(target=job, args=(k,)) for k in (4, 2, 2, 1, 4, 3, 1)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)
    assert not any(t.is_alive() for t in threads) and peak[0] <= 4


def test_dry_run_skips_done_lines_and_refuses_out_of_data(tmp_path, capsys, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr(replay, "DATA", data)
    plan = tmp_path / "p.plan"
    plan.write_text("select s1 319\nselect s2 319 select.effort=high\n")
    out = data / "replay" / "p"
    out.mkdir(parents=True)
    (out / "select-s1.json").write_text("{}")
    assert replay.main([str(plan), "--dry-run"]) == 0
    printed = capsys.readouterr().out
    assert "1 done, 1 to run" in printed and "s2:" in printed and "s1:" not in printed
    assert "RUN=319" in printed and "AGENTS_DIR=/app/data/replay/p/agents/s2" in printed
    with pytest.raises(replay.PlanError, match="--out must be under"):
        replay.main([str(plan), "--dry-run", "--out", str(tmp_path / "elsewhere")])
    plan.write_text("cluster c1 319\n")
    with pytest.raises(replay.PlanError, match="needs 4 call slots"):
        replay.main([str(plan), "--dry-run", "--calls", "2"])
