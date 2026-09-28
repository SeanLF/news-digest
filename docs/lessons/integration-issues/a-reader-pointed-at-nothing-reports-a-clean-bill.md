---
title: A log reader pointed at a source that no longer exists prints nothing and exits 0, which reads as "no errors".
date: 2026-09-28
category: integration-issues
module: ops
problem_type: integration
severity: medium
applies_when:
  - a service moves between process managers (systemd to Kamal or Docker, or the reverse)
  - an ops tool reads logs, metrics or state by the name of a unit, container or file
  - a sweep for errors comes back empty
tags: [bin-ops, journalctl, docker-logs, kamal, negative-control, observability]
---

# A reader pointed at nothing reports a clean bill

*2026-09-28. Four days after the Kamal cut-over, a health check asked `bin/ops journal` for
errors and warnings over four days and got none.*

## The lesson

**When a log sweep comes back empty, prove the reader can see a line you know is there before
believing it.** `journalctl -u <unit>` for a unit that no longer exists prints nothing and exits 0.
So does `docker logs` for a container name that matches nothing, if the name was resolved by a
filter that returns empty. An empty result from a pointer to nothing is indistinguishable from a
clean system.

The worker had moved from `news-digest-worker.service` to a Kamal container on 2026-09-25.
`bin/ops journal` still read the unit. It returned two stale lines from the migration and exit 0,
and the health check reported "no errors, unverified". The container had, in fact, logged an hnrss
timeout on 26 Sept and an aborted model call during run 310.

## How to apply

- **Negative control on every empty sweep**: grep for a line that must exist (the start-up line,
  `schema is current`) in the same window with the same command. If that comes back empty too, the
  reader is broken, not the system clean.
- **Make absence an error in the tool.** `bin/ops journal` now resolves the running container
  first and exits 3 with "no running digest-worker-worker-* container" when there is none
  (`bin/tests/test_ops.py`, `test_no_running_container_fails_loudly`).
- **A move between process managers retires every reader keyed on the old name**, in the same
  change: grep for the unit, container and file names (`rg -n 'news-digest-worker'`) across `bin/`,
  `docs/` and runbooks.

## Related

- `8493ebd` (the fix), `docs/operations.md` ("Reading production").
- [a-detector-nobody-reads-is-not-a-detector.md](../best-practices/a-detector-nobody-reads-is-not-a-detector.md):
  the same shape from the other side, a signal emitted where nobody looks.
