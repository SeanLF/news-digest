---
title: A symptom is not a mechanism; read why each case happened before choosing the stage to fix
date: 2026-09-29
category: best-practices
module: cluster, select, write
problem_type: best_practice
severity: high
applies_when:
  - A reader-visible defect (a duplicate, a wrong fact) has one obvious explanation and you are about to fix the stage it points at
  - A fix scores perfectly on the run that showed the bug
  - Several experiments on one defect fail and all of them share an assumption about how it arises
  - Parallel model calls each see a slice of the output and none sees the whole
tags: [duplicates, write, select, clustering, held-out, mechanism, evaluation]
---

"The same story twice" looked like one thing: an event split into two clusters. Every
experiment on 2026-09-29 assumed it, and the biggest share of the duplicates was something
else. **Read each case's cause before choosing where to fix; a symptom can have several
mechanisms, each living in a different stage.**

## The evidence

Of the 8 labelled duplicates in runs 284-311 (`docs/2026-09-29-duplicate-stories.md`):

| mechanism | cases | stage |
|---|---|---|
| a writer leads with a neighbour's event from a dual-topic article in its own cluster | 294, 296, 301 | WRITE |
| an article tagged in its own language never joins the English coverage | 311 North Korea | extract |
| two clusters on one negotiation, or one story containing another | 311 Iran, 311 OpenAI, 303 | a judgement |

What the single assumption cost:

- **A SELECT rule tuned on the day that showed the bug.** 11/11 merges on run 311; held out
  (291, 294, 296, 301, 303) 5/15, plus a sidebar pair merged 3/6. On 301 SELECT was *right*
  to pick both clusters (Russia's sanctions bill; Xi's visit): the duplicate was written.
- **Story Forest on tags: 0/5 held out.** Its test set was the residue of a tag join that had
  already failed, and two of its five cases were not cluster splits at all.

The WRITE mechanism surfaced only by opening 301's two clusters and asking where the second
writer got the bill from: one SCMP article in the Xi cluster, "Trump signs bill targeting
China's Russia energy imports days before Xi's US visit". The fix is a newsroom's story
budget: each writer sees the other stories' labels (262a9e0). 9/9 bleeds → 0/9, controls
unchanged.

## The shape

- Before fixing a class of defect, pull every case you have and label *why* each happened,
  not only *that* it did. If the causes live in different stages, a fix in one stage is
  tested on the wrong population.
- A fix that scores perfectly on the triggering run has been fitted, not tested. Hold out
  runs it was not written for, and confirm the control arm reproduces the defect first
  ([[measure-a-prompt-change-against-a-control-run]]).
- When several experiments fail, list their shared assumption before trying a fifth
  ([[when-four-levers-fail-the-target-is-the-finding]]).
- Fan-out is a mechanism generator: N isolated calls each optimise their slice, and nothing
  owns the whole. Anything a reader sees across slices (repetition, contradiction, a lead
  used twice) needs a shared view going in or a whole-output check coming out.

## Related

[[a-threshold-needs-a-distribution-that-splits]] · [[discriminative-is-not-reproducible]] ·
[[a-bound-that-guarded-one-call-does-not-guard-n]]
