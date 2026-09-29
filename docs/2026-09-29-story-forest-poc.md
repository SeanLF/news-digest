# Story Forest's story layer, replayed over runs 284-311 — 2026-09-29

*A PoC, no production code. Harness, inputs, labels and outputs in `docs/proposed/story-forest/`.*

## The question

Run 311 shipped duplicates, and the design discussion that followed proposed a story layer between
clustering and SELECT, shaped like Story Forest (arXiv:1803.00189): each day's event clusters are
assigned to an existing story or start one, and inside a story an event is merged (a duplicate) or
added as a branch (a sidebar). Would that layer, built the paper's way on the tags we already have,
have merged the duplicates we shipped without merging distinct events?

## Pre-registration (written before the mechanism existed)

1. **Labels first.** Candidate pairs of *shipped* stories in runs 284-311: every pair the thread
   linker proposed for one thread, the top 3 pairs per run by entity + primary_event overlap, and
   run 311's Zelensky pair by name. Each read (summaries and cited articles) and labelled by event
   identity (`docs/2026-09-01-citation-relevance-rubric.md`): SAME_EVENT / SAME_SITUATION (different
   event, sidebar material) / UNRELATED.
2. **Mechanism.** Story Forest's assignment, adapted: an event joins the story whose recent entity
   set it overlaps most if entity Jaccard >= δ and it shares >= n event words (the paper's title
   check); inside the story it merges with a same-day event if mean(entity, word Jaccard) >= μ,
   else it extends. Stories carry across days (3-day window). Variants: match the story's whole
   vocabulary (the paper) or its closest event; with or without article titles.
3. **Selection.** Parameters chosen on 284-297 by (duplicates merged − labelled non-duplicates
   merged), reported on 298-311.
4. **Controls.** Tags shuffled across a day's clusters should merge ~no duplicates; the RSS
   instrument must see a planted 100 MB allocation.

## Results

### The verified duplicate rate

92 candidate pairs read: 8 SAME_EVENT, 14 SAME_SITUATION, 70 UNRELATED (`labels.json`).

| | runs | share of 28 |
|---|---|---|
| ≥1 SAME_EVENT pair shipped | 291, 294, 296, 301, 303, 311 | **6 (21%)** |
| counting only straight restatements (not a market reaction or one story contained in another) | 294, 301, 303, 311 | 4 (14%) |

A lower bound: the screen reads same-thread pairs and each run's top 3 by overlap, not every pair.

### The replay

| | tune 284-297 | held out 298-311 |
|---|---|---|
| best operating point: duplicates merged | 1 of 3 (294's pipeline) | **0 of 5** |
| its labelled non-duplicates merged | 0 | 0 |
| point merging the most duplicates (picked on all runs, held-out included: an upper bound, not a selection) | 2 of 3 | 3 of 5 |
| its labelled non-duplicates merged | 12 | 21 |
| its merges across all clusters | 965 | 1,043 |
| shuffled tags, duplicates merged (5 seeds, both points) | 0 | 0 |

**Why no threshold works** (`diag.py`): pairwise, SAME_EVENT pairs have entity Jaccard 0.00-0.32 and
event-word Jaccard 0.01-0.16; SAME_SITUATION pairs 0.02-0.26 and 0.01-0.17; same-thread UNRELATED
pairs 0.05-0.30. The distributions sit on top of each other. Run 311's Zelensky pair has entity
Jaccard 0.00 (Spanish tags, fixed since 00afb4e); 301's sanctions bill has event-word Jaccard 0.01.

**Mega-stories.** At the best operating point one story absorbs 1,286 events across all 28 days
(first label "Nepal catastrophic floods"; it becomes a catch-all through chained entity overlap),
and up to 12 of one day's shipped stories sit in a single tree. The "sidebar" count the replay
reports (5 of 7, 6 of 7) is therefore an artefact, not organisation: labelled UNRELATED pairs share
a tree 13 and 21 times.

**Thread-first** (the production linker's threads as the stories): same thread for 3 of 8
SAME_EVENT pairs, 6 of 14 SAME_SITUATION, and 4 UNRELATED pairs the Iran-war thread lumped.

### Resources

Pure standard-library Python: one 28-day replay 0.85 s, peak RSS 95 MiB including loading all 28
runs (control: +100 MB planted → 194 MiB). A daily run would cost well under that. Resource use is
not the obstacle.

## Verdict

**Don't build Story Forest's layer on our tags.** The paper's matching (keyword Jaccard plus a shared
title word) cannot tell a duplicate from a sidebar from an unrelated story on this data: the
signal is not in the features, so no threshold recovers it, and chaining across days produces
catch-all stories. The *shape* (story above event, merge vs branch) stands as the design; the
decision inside it needs the raw text, which is the 2026-09-16 Jev finding again (event identity
needs raw text; extraction is lossy).

What that leaves, in order of cost:
1. **The doubles check after WRITE** — one model call over the ~17 written stories, all English and
   at story granularity, where all 8 duplicates exist as two written stories side by side. Cheap,
   and the one place every class (language, granularity, contained, reaction) is in view; whether a
   model call catches them there is not measured — `labels.json` is the set to measure it on.
2. **A model-judged story layer** (the linker's prompt moved upstream, on raw titles and summaries),
   if duplicates survive (1). Its pairwise decision is what the tags failed; measure it against
   `labels.json` before building.

Not verified: pairs outside the screen (the rate is a lower bound); whether a model-judged layer
separates the classes (not run); tags after 00afb4e (only run 311's English re-tags exist).

## Reproduce

```sh
bin/db-clone --live                                              # the local clone, runs to 311
docs/proposed/story-forest/fetch.sh 284 311                      # inputs/<run>.json (read-only)
D=docs/proposed/story-forest
docker run --rm -v "$PWD/$D:/w" -w /w python:3.13-slim sh -c 'python candidates.py && python sheet.py'   # candidates.json, sheet.txt (labels.json is hand-written from sheet.txt)
docker run --rm -v "$PWD/$D:/w" -w /w python:3.13-slim python diag.py      # the overlapping similarity ranges
docker run --rm -v "$PWD/$D:/w" -w /w python:3.13-slim python grid.py      # out/grid.json (~90 s)
docker run --rm -v "$PWD/$D:/w" -w /w python:3.13-slim python report.py    # out/report.json: controls, mega-stories, thread-first
docker run --rm -v "$PWD/$D:/w" -w /w python:3.13-slim python rss.py       # out/resources.jsonl (and `rss.py control`)
```
