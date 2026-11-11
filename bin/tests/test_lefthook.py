"""lefthook.yml: the pre-commit jobs work from a linked worktree as well as the main checkout.

git runs a worktree's hooks with GIT_DIR set, so inside a job whose lefthook `root` is a
subdirectory, `git rev-parse --show-toplevel` answers that subdirectory, not the worktree.
"""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ("digest", "src")


def _oxfmt_mount_source() -> str:
    text = (ROOT / "lefthook.yml").read_text()
    job = re.search(r"^    1-oxfmt:\n((?:      .*\n)+)", text, re.M)
    assert job, "lefthook.yml has no 1-oxfmt job"
    root = re.search(r"^      root: (\S+)", job.group(1), re.M)
    run = re.search(r"^      run: (.*)$", job.group(1), re.M)
    mount = re.search(r'-v "([^"]+):/app/digest/src"', run.group(1))
    assert root and root.group(1).rstrip("/") == "digest"
    assert mount, "the oxfmt job no longer mounts digest/src"
    return mount.group(1)


def _git(cwd: Path, *args: str, hooks: Path | None = None) -> None:
    hooks_path = ["-c", f"core.hooksPath={hooks}"] if hooks else []
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *hooks_path, *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


def test_the_oxfmt_job_mounts_the_worktrees_own_sources_when_git_runs_the_hook(tmp_path):
    source = _oxfmt_mount_source()
    main = tmp_path / "main"
    main.joinpath(*SOURCES).mkdir(parents=True)
    main.joinpath(*SOURCES, "a.ts").write_text("x\n")
    _git(main, "init", "-q", "-b", "main")
    _git(main, "add", ".")
    _git(main, "commit", "-q", "-m", "init")
    worktree = tmp_path / "wt"
    _git(main, "worktree", "add", "-q", "-b", "wt", str(worktree))

    out = tmp_path / "resolved"
    hook = main / ".git" / "hooks" / "pre-commit"
    hook.write_text(f'#!/bin/sh\ncd digest && printf %s "{source}" > {out}\n')
    hook.chmod(0o755)
    worktree.joinpath(*SOURCES, "a.ts").write_text("y\n")
    _git(worktree, "add", ".")
    _git(worktree, "commit", "-q", "-m", "change", hooks=hook.parent)

    assert out.read_text() == str(worktree.joinpath(*SOURCES))
