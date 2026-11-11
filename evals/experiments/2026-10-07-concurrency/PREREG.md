# Pre-registration: subscription concurrency (2026-10-07, before any run)
Question: how many concurrent model calls does the Claude subscription (CLAUDE_CODE_OAUTH_TOKEN, Agent SDK)
take before it pushes back? Published: nothing official (Anthropic documents 5-hour and weekly usage, not
concurrency); a vendor blog claims 1, already contradicted by today's runs at 4+.
Instrument: make replay, ATTRIBUTE on Haiku 5.5 (14 calls, 4 in flight per replay), run 319.
Steps: REPLAY_CALLS = 4 (baseline), 8, 16, 32; J = calls/4 replays at once; REPS = 2 x J (two waves).
Metrics per step: failed replays (and their error text), median replay latency.
The CLI retries 429/overload internally, so pushback may show as latency, not errors: hence both.
Rule: a step holds if 0 failures and median latency <= 1.5 x the baseline's. New cap = highest step that holds.
