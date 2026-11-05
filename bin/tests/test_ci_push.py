"""bin/ci --push: the pre-push run is skipped when this exact committed tree already passed a full run."""

import subprocess
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _load():
    loader = SourceFileLoader("ci", str(ROOT / "bin" / "ci"))
    spec = spec_from_loader("ci", loader)
    mod = module_from_spec(spec)
    loader.exec_module(mod)
    return mod


ci = _load()


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "ci@example.test")
    git(tmp_path, "config", "user.name", "ci")
    git(tmp_path, "config", "commit.gpgsign", "false")
    (tmp_path / "a.txt").write_text("one\n")
    git(tmp_path, "add", "a.txt")
    git(tmp_path, "commit", "-q", "-m", "one")
    return tmp_path


def test_a_clean_tree_that_has_not_passed_is_not_skipped(repo):
    assert ci.tree_stamp(repo) is not None
    assert not ci.already_passed(repo)


def test_a_recorded_pass_skips_the_same_tree(repo):
    ci.record_pass(repo)
    assert ci.already_passed(repo)
    assert ci.tree_stamp(repo).name == git(repo, "rev-parse", "HEAD^{tree}")


def test_a_new_commit_is_a_new_tree_and_runs_again(repo):
    ci.record_pass(repo)
    (repo / "a.txt").write_text("two\n")
    git(repo, "commit", "-q", "-am", "two")
    assert not ci.already_passed(repo)


def test_a_dirty_worktree_never_skips_and_is_never_recorded(repo):
    ci.record_pass(repo)
    (repo / "a.txt").write_text("edited, not committed\n")
    assert ci.tree_stamp(repo) is None
    assert not ci.already_passed(repo)
    ci.record_pass(repo)
    git(repo, "checkout", "-q", "a.txt")
    assert ci.already_passed(repo)


def test_an_untracked_file_counts_as_dirty(repo):
    (repo / "new.txt").write_text("x\n")
    assert ci.tree_stamp(repo) is None


def test_suite_selects_one_suite_and_refuses_an_unknown_one():
    assert ci.selected_suites(["--suite", "worker"]) == {ci.WORKER}
    assert ci.selected_suites([]) == ci.ALL_SUITES
    with pytest.raises(SystemExit):
        ci.selected_suites(["--suite", "nope"])


def test_a_pass_is_recorded_only_for_the_tree_the_run_started_on(repo):
    started = ci.tree_stamp(repo)
    (repo / "a.txt").write_text("committed during the run\n")
    git(repo, "commit", "-q", "-am", "mid-run")
    ci.record_pass(repo, started)
    assert not ci.already_passed(repo)
    git(repo, "checkout", "-q", "HEAD~1")
    assert not ci.already_passed(repo)
