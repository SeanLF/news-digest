# Duplicate stories: where they come from, and what stops them (2026-09-29)

*Run 311 shipped the same story twice. This records the day's tests and the approach they
support. Harnesses and outputs were in the session scratchpad; the numbers below are the record.*

## Rate

Of the 92 candidate pairs in runs 284-311, read against the event-identity rubric
(`docs/proposed/story-forest/labels.json`): 8 same event, 14 same situation, 70 unrelated.
6 of 28 issues (21%) shipped a duplicate. A lower bound: candidates were screened by shared
thread and tag overlap, so a duplicate low on both was never read.

## Three mechanisms, not one

| mechanism | cases | fix |
|---|---|---|
| **WRITE bleed**: a writer, alone, leads with a neighbour's event from a dual-topic article in its cluster | 294, 301, 296 (297 in the Python era) | the issue budget |
| **language split**: extract tagged a Spanish article in Spanish; the join never met the English coverage | 311 North Korea | English tags (`00afb4e`) |
| **situation overlap**: two clusters on one negotiation, or a story "containing" another | 311 Iran, 311 OpenAI, 303 | none needed yet; the doubles check calls these related, not doubles |

Every earlier experiment assumed "duplicate = one event split into two clusters" (the first
row of a different table), which is why the Story Forest replay scored 0/5 held out and the
SELECT rule scored 5/15 held out.

## Tests

**Issue budget** (`issue_budget.txt`: each writer sees the other stories' tier and cluster
label; one rule in `write.md`). Negative control: the old prompt reproduces production's
duplicate in 9/9 writes on 294, 296, 301.

| | old `write.md` | + budget |
|---|---|---|
| offending story leads with the neighbour's event (294, 301, 296; 3 reps) | 9/9 | 0/9 headlines |
| control stories keep their lead | 9/9 | 9/9 |
| doubles in the whole rewritten issue, bleed runs (301, 294, 296; 2 checker reps) | 3 runs x 1 | 0 |
| the same on 311 (a language split, not a bleed) | 1 | 0 |
| doubles on three ordinary runs (305, 307, 309) | 0 | 0 |
| coherence fails per 98 story checks (305, 307, 309; old rewritten twice) | 8, 9 | 13 |
| cost | | +5% |

The coherence gap is unresolved at this n: 13 sits above both old arms (8, 9), but it is one
write per story and one budget arm, and the new fails are the same error classes on the same
stories as the old-again arm (uncited detail, "Abiy" where the source says "the prime
minister"). Neither "noise" nor "cost" is shown; watch coherence fails after deploy. Lead changes between old and old-again are as frequent as between old
and budget (hurricane → school phones on 305 happens with no budget at all).

On 311 the rewritten issue also lost its duplicate, but not by the mechanism the budget is for:
the writers re-angled the two North Korea stories (Seoul's POW row; Zelensky's mobilisation
claim) away from what SELECT picked as one event. Count it as a side effect, not a fix; the
language split's fix is English tags.

**Doubles check** (one Sonnet call over the issue's headlines and summaries, structured
output). Stable across reps; 5/8 same-event, 0/70 unrelated. Its two "false alarms" were real
bleeds (297, 296: a summary carrying the neighbour's event). Misses the situation-overlap row,
which is where the definition of a double is a judgement.

**SELECT "one story per situation" rule** (`00afb4e`). 11/11 on 311, the day it was written
for; held out on 291, 294, 296, 301, 303: 5/15 duplicates merged, and a sidebar pair merged
in 3/6. Reverted on this branch.

**Story Forest assignment on tags** (`docs/2026-09-29-story-forest-poc.md`): 0/5 held out.
Its test set was the residue of a tag join that had already failed; tags cannot separate these.

**Multilingual embedding attach** (`docs/2026-09-29-multilingual-attach-poc.md`): 62%
precision; English tags do the work.

**Jev and kin**: hosted Jev has no self-hosting, trace or event-identity evidence; the open
Jev-likes (Jeff, Kev, Jeeves) are English-only or need a GPU; OpenRouter's free decision model
(Respan Span-01 Lite) scores conversation behaviours. The typed-decision shape is right; Claude
with an output schema already gives it.

## Approach

Bottom up. Ship English tags (done) and the issue budget; drop the SELECT rule. Keep the
doubles check as a run-health monitor, not an action, to see what still gets through. The
story layer (situation → events, main story + sidebar) is a product decision about the page,
not a duplicate fix; revisit if the monitor shows situation-overlap doubles readers mind.

## Not verified

- The budget on production's own code path end to end (the harness rebuilt branches from
  archived artifacts; the implementation's file format matches it).
- Runs after `00afb4e` deploys: English tags are measured on 80 articles of one run.
- Labels are one model's reading; 291 and 296 (a market reaction) are arguably sidebars.
