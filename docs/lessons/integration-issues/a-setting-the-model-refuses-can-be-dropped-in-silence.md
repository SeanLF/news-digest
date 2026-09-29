---
title: A setting the model refuses can be dropped in silence by the layer in between; measure what ran.
date: 2026-09-29
category: integration-issues
module: runner, agents
problem_type: integration
severity: medium
applies_when:
  - moving a stage to a new model whose API refuses a setting the old one took
  - a config value is recorded from the spec, not from the request that was sent
tags: [sonnet-5-5, thinking, effort, agent-sdk, model_calls]
---

Sonnet 5.5's API returns a 400 for `thinking: {"type": "disabled"}`. Five stages kept that setting
when they moved to 5.5 (cluster-extract, select, repair, thread-audit, thread-synthesis), and every
run still succeeded. The Agent SDK passes the setting to the Claude Code CLI, which makes the API
call, and the request that reached the model thought adaptively. model_calls recorded "disabled",
copied from the spec.

Measured, because nothing reports it: the same reasoning prompt sent as `disabled` and as `adaptive`
gave the same output tokens (about 300 for a 20-character answer) and the same answers, with and
without tools (runs of 2026-09-29, `scratchpad/readprobe/think*.ts`). The specs now say adaptive.

Any setting the model refuses can go the same way, effort included: `runStage` records the effort
it sends, or "(sdk default)"; what the SDK then sends is not observable from here. Before trusting a
recorded setting, probe it: a paired call that differs only in that setting, read on a quantity the
setting must move (output tokens for thinking).
