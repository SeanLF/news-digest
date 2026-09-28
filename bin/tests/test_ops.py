"""bin/ops: read-only operator queries against prod, over the SSH channel that already exists.

The security property under test is that this tool can only READ. It runs on the box with production
data under it, so a payload that could write would be a foot-gun. It reads Postgres as the
digest_ro role in a read-only session. The payloads are executed against a real server in
digest/src/ops/ops-payloads.test.ts.
"""

import os
import re
import shlex
import subprocess
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

import pytest

OPS_PATH = Path(__file__).resolve().parents[2] / "bin" / "ops"


def _load():
    loader = SourceFileLoader("ops", str(OPS_PATH))
    spec = spec_from_loader("ops", loader)
    mod = module_from_spec(spec)
    loader.exec_module(mod)
    return mod


ops = _load()

SQL_SUBCOMMANDS = ("run", "usage", "health", "artifacts", "artifact")


@pytest.mark.parametrize("sub", SQL_SUBCOMMANDS)
def test_no_postgres_payload_carries_a_write_or_a_session_change(sub):
    """A SET could turn the read-only session off, so it counts as a write here. A psql
    meta-command runs as root in the database's container on the box (\\! is a shell, \\o writes a
    file), so only the ones the payloads need may appear; those lines and comments are not SQL."""
    lines = [line for line in ops.build_payload(sub).splitlines() if not line.lstrip().startswith("--")]
    allowed = {
        "\\set",
        "\\pset",
        "\\getenv",
        "\\bind",
        "\\g",
        "\\gset",
        "\\if",
        "\\else",
        "\\endif",
        "\\warn",
        "\\echo",
    }
    for meta in re.findall(r"\\[^\s:]+", "\n".join(lines)):
        assert meta in allowed, f"{sub} payload runs {meta}"
    sql = "\n".join(line for line in lines if not line.lstrip().startswith("\\")).lower()
    for verb in (
        "insert",
        "update",
        "delete",
        "merge",
        "drop",
        "alter",
        "create",
        "truncate",
        "grant",
        "revoke",
        "copy",
        "set",
        "reset",
        "begin",
        "start",
        "commit",
        "do",
        "call",
        "lock",
    ):
        assert not re.search(rf"\b{verb}\b", sql), f"{sub} payload contains {verb!r}"


@pytest.mark.parametrize("sub", SQL_SUBCOMMANDS)
def test_a_postgres_payload_is_the_psql_script_the_real_server_test_runs(sub):
    payload = ops.build_payload(sub)
    assert payload == (ops.PAYLOAD_DIR / f"{sub}.sql").read_text()
    # The run id (and the name) reach Postgres as bound parameters read from the environment.
    assert "\\getenv rid OPS_RUN" in payload and "\\bind" in payload


def test_the_postgres_command_logs_in_as_the_read_only_role_in_a_read_only_session():
    """The two guarantees on Postgres: digest_ro holds SELECT only, and PGOPTIONS makes every
    transaction read-only. ops-payloads.test.ts shows each refusing a write without the other."""
    argv = shlex.split(ops.remote_command({"OPS_RUN": "285", "OPS_NAME": ""}))
    exec_at = argv.index("exec")
    assert argv[exec_at - 1] == "docker"
    assert "PGOPTIONS=-c default_transaction_read_only=on" in argv
    assert argv[argv.index("-U") + 1] == "digest_ro"
    assert argv[argv.index("-d") + 1] == "digest"
    assert ops.PG_CONTAINER in argv
    # Stops at the first error, even one before the payload's own \\set ON_ERROR_STOP.
    assert "ON_ERROR_STOP=1" in argv
    assert argv[-2:] == ["-f", "-"]


def test_the_postgres_command_passes_an_empty_run_id_rather_than_none():
    """An unset variable reaches \\bind as the literal text ':rid'; an empty one means the latest."""
    argv = shlex.split(ops.remote_command({"OPS_RUN": "", "OPS_NAME": ""}))
    assert "OPS_RUN=" in argv and "OPS_NAME=" in argv


def test_a_hostile_name_stays_one_quoted_word_in_the_postgres_command():
    hostile = "x'; docker rm -f news-digest-temporal-postgres; echo '"
    argv = shlex.split(ops.remote_command({"OPS_RUN": "1", "OPS_NAME": hostile}))
    assert f"OPS_NAME={hostile}" in argv
    assert "rm" not in argv


def test_print_command_on_postgres_shows_the_payload_and_runs_nothing(monkeypatch, capsys):
    monkeypatch.setattr(ops, "_ssh", lambda *a: pytest.fail("--print-command must not run anything"))
    assert ops.main(["artifact", "285", "clusters.json", "--print-command"]) == 0
    out = capsys.readouterr().out
    assert "psql" in out and "OPS_NAME=clusters.json" in out
    assert "\\getenv name OPS_NAME" in out


def test_run_id_defaults_to_the_latest_run():
    payload = ops.build_payload("run")
    assert "max(id)" in payload.lower()


def test_journal_reads_the_running_worker_container_not_a_systemd_unit():
    cmd = ops.journal_command(since="1h", lines=200, grep=None)
    assert "name=^digest-worker-worker-" in cmd
    assert "journalctl" not in cmd
    assert "tail -n 200" in cmd


@pytest.mark.parametrize(
    ("service", "prefix"),
    [("worker", "digest-worker-worker-"), ("python", "digest-python-worker-"), ("site", "digest-site-web-")],
)
def test_service_selects_its_kamal_container(service, prefix):
    assert f"name=^{prefix}" in ops.journal_command(since="1h", lines=10, grep=None, service=service)


@pytest.mark.parametrize(
    ("since", "expected"),
    [
        ("6h", "6h"),
        (" 6h ", "6h"),
        ("30m", "30m"),
        ("4d", "96h"),
        ("1w", "168h"),
        ("2026-09-03 10:00", "2026-09-03T10:00"),
    ],
)
def test_the_window_is_one_docker_understands(since, expected):
    assert f"--since {expected} " in ops.journal_command(since=since, lines=10, grep=None)


@pytest.mark.parametrize(
    "argv",
    [
        ["run", "285", "stray"],
        ["artifact", "285", "clusters.json", "stray"],
        # journal takes no positional args; it was the one subcommand the guard missed.
        ["journal", "stray"],
    ],
)
def test_extra_positional_arguments_are_refused(argv):
    with pytest.raises(SystemExit):
        ops.main(argv)


def test_journal_grep_is_quoted():
    """A pattern reaches the remote shell quoted, so a pattern with a semicolon stays a
    pattern."""
    cmd = ops.journal_command(since="1h", lines=10, grep="a; rm -rf /")
    assert "; rm -rf /" not in cmd.replace("'a; rm -rf /'", "")


_FAKE_DOCKER = """#!/usr/bin/env python3
import os, sys
argv = sys.argv[1:]
if argv[0] == "ps":
    prefix = next(a for a in argv if a.startswith("name=^"))[len("name=^"):]
    if prefix in os.environ.get("RUNNING", ""):
        print("c0ffee")
    sys.exit(0)
if argv[0] == "logs":
    with open(os.environ["LOG_FIXTURE"]) as f:
        sys.stderr.write(f.read())
    sys.exit(int(os.environ.get("LOGS_RC", "0")))
sys.exit(2)
"""


def _run_journal(tmp_path, lines, cmd, running="digest-worker-worker-", logs_rc=0):
    fixture = tmp_path / "container.log"
    fixture.write_text("".join(f"{line}\n" for line in lines))
    stub = tmp_path / "docker"
    stub.write_text(_FAKE_DOCKER)
    stub.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "LOG_FIXTURE": str(fixture),
        "RUNNING": running,
        "LOGS_RC": str(logs_rc),
    }
    return subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, env=env, timeout=10)


def test_grep_pattern_alternates_instead_of_matching_a_literal_pipe(tmp_path):
    lines = ["starting run", "ERROR: fetch failed", "Traceback (most recent call last):", "done"]
    result = _run_journal(tmp_path, lines, ops.journal_command(since="1h", lines=200, grep="ERROR|Traceback"))
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines() == ["ERROR: fetch failed", "Traceback (most recent call last):"]


def test_grep_searches_the_whole_window_and_lines_bounds_the_matches(tmp_path):
    lines = ["Traceback: old", *[f"heartbeat {i}" for i in range(250)], "Traceback: new"]
    result = _run_journal(tmp_path, lines, ops.journal_command(since="6h", lines=1, grep="Traceback"))
    assert result.stdout.splitlines() == ["Traceback: new"]
    result = _run_journal(tmp_path, lines, ops.journal_command(since="6h", lines=200, grep="Traceback"))
    assert result.stdout.splitlines() == ["Traceback: old", "Traceback: new"]


def test_no_match_is_an_empty_success(tmp_path):
    result = _run_journal(tmp_path, ["heartbeat"], ops.journal_command(since="1h", lines=10, grep="Traceback"))
    assert (result.returncode, result.stdout) == (0, "")


def test_no_running_container_fails_loudly(tmp_path):
    result = _run_journal(tmp_path, ["x"], ops.journal_command(since="1h", lines=10, grep=None), running="")
    assert result.returncode != 0
    assert "digest-worker-worker-" in result.stderr


def test_a_failing_docker_logs_is_not_masked_by_the_pipe(tmp_path):
    cmd = ops.journal_command(since="1h", lines=10, grep="x")
    assert _run_journal(tmp_path, ["x"], cmd, logs_rc=1).returncode != 0


def test_a_run_id_that_is_not_a_number_is_refused():
    with pytest.raises(SystemExit):
        ops.main(["run", "285;", "--print-command"])


def test_unknown_subcommand_exits_nonzero():
    with pytest.raises(SystemExit) as e:
        ops.main(["nonesuch"])
    assert e.value.code != 0
