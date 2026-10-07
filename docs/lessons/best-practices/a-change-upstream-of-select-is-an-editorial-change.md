---
title: A change upstream of SELECT is an editorial change; replay SELECT on fixed inputs before blaming it
date: 2026-10-07
category: best-practices
module: cluster-extract, select, band
problem_type: silent_regression
severity: medium
applies_when:
  - Changing the model, effort or prompt of any stage before SELECT (cluster-extract, recap, tags)
  - A band shows the lead story or must-know set moving between arms
  - About to write "that swing is SELECT's own" or "noise" about a selection difference
tags: [select, clustering, labels, confound, band, editorial, model-switch]
---

Moving cluster-extract from Sonnet 5.5 to Haiku 5.5 changed which story led the issue, through the
cluster labels SELECT reads, while SELECT itself was untouched. Attribute a selection difference to
SELECT only after replaying SELECT, several times, on each arm's own clusters with everything else fixed.

## The measurement

Prod run 319 (2026-10-07). Same SELECT (Sonnet 5.5, same prompt), only the clusters differ:

| Cluster | On Sonnet's clusters (prod + 5 replays) | On Haiku's clusters (5 replays) |
|---|---|---|
| Trump / Iran (7-8 articles, same members) | must-know 5/6, labelled "US-Israeli war with Iran leadership uncertainty" | dropped 5/5, labelled "Trump remarks on Iran war leadership and oil prices" |
| French student protests | should-know 2/6 (30 articles) | must-know 4/5 (34, with the budget pieces folded in) |

Pair-level, Haiku's clustering was within Sonnet's own run-to-run spread (keeps 88-94% of prod's pairs;
a Sonnet replay kept 86%), so a partition metric would have called the swap neutral. What moved the
editorial outcome was the label wording and a few members, which no partition metric sees.

The band (full workflow, 2 reps per arm) showed the Trump story led / demoted / dropped and the switch
commit (205e3ac) called that "SELECT's own" swing. It was not: the band changed the clusters and SELECT
together, so it could not separate them.

## The shape

- A stage's output is the next stage's prompt. Labels, summaries and tags written by a cheap upstream
  model steer the expensive judgement downstream, whatever their accuracy.
- A full-pipeline band answers "did the issue change", never "which stage changed it". To attribute,
  hold everything before the stage fixed (the replay harness in a scratch copy of the prod clone does
  this for one stage at ~$0.15 a SELECT call) and repeat it: one replay is an anecdote, SELECT at
  default effort had an off-brief run in 1 of 6.
- Judge an upstream change by what readers see first (the must-know set), not only by its own metric.

## Related

- [[measure-a-prompt-change-against-a-control-run]]
- [[the-metric-was-the-problem]]
- [[a-symptom-is-not-a-mechanism-classify-the-cases-before-choosing-the-stage]]
