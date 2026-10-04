---
title: A 200 from a monitoring endpoint does not mean the ping was recorded, and chatty side-channel pings can crowd out the one that matters.
date: 2026-10-04
category: integration-issues
module: healthcheck
problem_type: silent_noop
severity: high
applies_when:
  - a dead-man's switch pages as down but the job it watches succeeded
  - adding progress or log pings to the same check that carries start/success/fail
  - a client treats an HTTP status as proof that a third-party service acted on the request
tags: [healthchecks.io, rate-limit, dead-mans-switch, monitoring, hc-ping]
---

## The lesson

healthchecks.io records at most 5 pings a minute per check. It answers each ping past that with
**HTTP 200 and the body `OK (rate limited)`**, and records nothing. A client that checks only
`res.ok` reads the dropped ping as delivered. The rule: read the body of a monitoring ping, and give
low-value pings (`/log` progress lines) a budget that can never consume the slot the success ping needs.

## What happened

Run 316 (2026-10-04) sent its email at 10:31:26 UTC. The workflow's `healthcheck("success")`
activity completed in 21 ms and logged no warning. healthchecks.io had nothing after the run's last
`/log` at 10:31:20, so the cron check `news-digest daily` went down. In the 60 s before the success
ping, the per-stage `/log` lines (WRITE, threads) had sent 8 pings. Every earlier run's success ping
had happened to land in a quieter minute.

You can reproduce the gap with two reads. One, the check's pings
(`GET https://healthchecks.io/api/v3/checks/<uuid>/pings/` with the API key from 1Password item
"healthchecks.io") show the `start` ping and then nothing after the last `log`. Two, the Temporal
history (`temporal workflow show --workflow-id digest-scheduled-<date>T10:25:00Z`) shows the
`healthcheck` activity COMPLETED.

The fix is commit 822194a. `/log` is capped at 3 per rolling minute, per instance. The worker's stage
lines and the ops activities share one instance, and the next line that goes out carries the count of
dropped lines. A body other than `OK` is now a warning.

## The general shape

Any fire-and-forget call to a third party that "never throws" has two silent failure modes. The
call can fail without anyone noticing. The call can also succeed at the HTTP level while the service
discards the request. The second is invisible unless you read what the service said.

When one channel carries both a high-volume signal (progress) and a low-volume critical one
(success), the volume one sets the failure rate of the critical one. Budget the volume signal
explicitly, or give it its own channel.

## Related

- [[test-the-detectors-not-the-happy-path]]
- [[a-reader-pointed-at-nothing-reports-a-clean-bill]]
