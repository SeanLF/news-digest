# Multilingual attach PoC, 2026-09-29

*Stale by default. Harness, inputs and outputs: `docs/proposed/multilingual-attach/`.*

## The question

Run 311 shipped Zelensky's 10,000 North Korean troops twice: extract tagged Clarín's Spanish article
"Ucrania", "Corea del Norte", and the tag join, which matches words, never met the English coverage.
00afb4e tells extract to tag in English; that is a prompt, and nothing checks it. Can a small
multilingual encoder, run after the join, catch a cross-language split whatever extract writes, within
the box's memory?

Not the question: whether embeddings should replace the join. That was measured and refused
(`docs/2026-08-30-health-check-and-clustering-sota.md`: five embedders, all inside the reference's own
noise band).

## Pre-registration (written before any vector was computed)

**Mechanism.** After `joinTags`, every cluster of 1-2 articles is a candidate. Embed each article's
title plus the first 300 characters of its summary (the text extract sees: `SUMMARY_CAP`, HTML
unescaped, links removed). A candidate attaches to the cluster of 3+ articles holding the single most
similar article (max-member cosine), when that cosine is at least τ.

Max-member, not the centroid: 23% of shipped clusters bundle 3+ stories
(`docs/2026-08-01-cluster-junk-drawer-findings.md`), so a centroid is diluted exactly where the target
is big; a split-off report of the same event should sit close to at least one member. The cost is
chaining onto a junk drawer's stray, which the labels below will show.

**Arms.**
- Primary (the decision): cross-language only. The candidate holds an article from a non-English
  source (`le_monde` fr, `clarin_mundo` es, `der_spiegel` de, `jeune_afrique` fr) and the
  best-matching member is from a source of a different language.
- Secondary (reported, decides nothing): any language, to show what the step would add beyond its
  scope.

**Models.**
- `paraphrase-multilingual-MiniLM-L12-v2`, ONNX int8 (`model_qint8_avx512.onnx`, the box has
  AVX-512F and no VNNI), onnxruntime + tokenizers, no torch, max 128 tokens, mean pooling.
- `static-similarity-mrl-multilingual-v1`, a static embedding table (no transformer at inference):
  tokenize, average the rows. Measured full (1024-d) and truncated to 256-d fp16 (it is trained
  Matryoshka), which is what would ship.

**τ.** Swept 0.50 to 0.90 in 0.05 steps on run 310 (tuning). Every cross-language attach at τ ≥ 0.50
on 310 is labelled; τ is the lowest value with no false attach on 310. Reported at that τ on runs
304-309 and 311 (held out).

**Labels.** Every attach is read (both articles' title and summary) and labelled same event or
different event, by the event-identity rule of `docs/2026-09-01-citation-relevance-rubric.md` (genre
is not the test; same actors on a different event is different). A checkable fact, not a golden set.

**Controls.** (1) `rejoin.mjs` reproduces each run's archived `clusters.json` exactly before anything
changes. (2) The same attach over vectors shuffled across articles attaches ~nothing at τ. (3) The RSS
instrument sees a known 200 MB allocation.

**Ship if all four hold.**
1. Run 311 with its shipped tags: A89 (Clarín) attaches to the cluster "North Korea to send 10,000
   more troops to Russia".
2. Held-out cross-language precision ≥ 0.9.
3. Peak memory of the step fits under the Python worker's 384 MB cap with room for the worker's
   78 MB idle, or a stated alternative (subprocess, the TS worker's 1.25 GB) fits instead.
4. Every new dependency is maintained.

## Results

*(below this line written after measuring)*

**Verdict: don't ship either model.** The model that finds cross-language splits (MiniLM) fails
precision at the pre-registered τ and is OOM-killed under the 384 MB cap. The model that fits
(static256) passes the gate as written, but it finds 1 of the 9 real splits: it is precise because
it is nearly blind. The pre-registration had no recall criterion, which was a mistake, so that pass
is not a result. Today's English-tag prompt (00afb4e) joined all three of run 311's real splits
on its own. Stay with the prompt and watch for cross-language singletons (below).

### Controls

| control | result |
|---|---|
| re-join reproduces archived `clusters.json`, runs 304-311 | 8/8 identical |
| RSS instrument sees a 200 MiB allocation | 49.1 → 249.1 MiB |
| shuffled vectors attach ~nothing | **ill-posed, both versions.** Permuting all vectors hands candidates big-cluster members' vectors (attaches *more* than real). Permuting among candidates keeps the multiset of candidate vectors, so the count hardly moves. A count cannot be nulled this way; the labels are the test. |

### Resources (amd64 under emulation on the Mac, the prod image `digest-python` + deps; 5,112 articles, 8 runs)

| arm | under `--memory=384m` | peak RSS | ms/article | model on disk |
|---|---|---|---|---|
| MiniLM-L12 int8 ONNX | **killed (137)** | 621 MiB (at 1 GiB) | 37.2 | 118 MB |
| MiniLM, lean session (no arena, no graph opt, batch 8) | **killed (137)** | 634 MiB | 33.6 | 118 MB |
| static, 1024-d fp32 | **killed (137)** | 511 MiB | 0.08 | 434 MB |
| static, 256-d fp16 (mmap) | fits | 132 MiB | 0.09 | 52 MB |

Image delta: 155 MB (onnxruntime 62, numpy 57, tokenizers 12), or ~69 MB for the static arm
alone (no onnxruntime). Timings are from Rosetta emulation, not the box; memory should transfer,
speed may not. All four dependencies were pushed within the last week and none is archived
(`gh repo view … --json pushedAt,isArchived`, 2026-09-29).

MiniLM would fit only as a short-lived subprocess with its own ~768 MB, or in the TS worker
(1.25 GB cap, 338 MB idle). The TS worker also hosts the extract batches' SDK subprocesses at the
same point in the run, so that headroom is unmeasured. With no swap, an OOM there kills the run.

### Accuracy (46 cross-language attaches at cosine ≥ 0.50, every one read; `labels.json`)

| | same event | different event |
|---|---|---|
| all labelled | 9 | 37 |

| arm | τ (lowest with no false attach on 310) | held-out attaches | precision | real splits found (of 9) |
|---|---|---|---|---|
| MiniLM | 0.65 (310's highest false: 0.605) | 13 | **0.62** (8/13) | 8 |
| static256 | 0.50 (310 had no attach at all) | 1 | 1.00 (1/1) | **1** |

Post hoc, not a pass: MiniLM at 0.70 is 7/7 held out. The false attaches sit up to 0.694 (Doral
deportations vs Trump-Rodríguez; Trump's UNGA AI remarks vs a Trump-Xi summit essay), so 0.70 rests
on two points and would move with the next run.

The failure mode is the one the junk-drawer work found: same actors, same theme, different event
(Netanyahu overflying France vs his UN speech; two Madrid protests against Sánchez). The static
model's cosines for the eight real splits it missed are 0.28-0.46, inside its noise.

### After the prompt fix

`inputs/311fix/` is run 311 re-joined with the new-prompt tags for the 80 articles re-extracted
today (batches A81-A120 and A241-A280: Clarín and Le Monde). All three real splits in 311 join by
tags alone: A89 → North Korea troops (11 articles), A259 → UNHCR cuts (4), A90+A96 → the Pope's
France visit (11). MiniLM's remaining cross-language attaches ≥ 0.50 on 311fix read as false, but they were not
entered in `labels.json`, so that claim rests on a reading the committed data does not record.
Not verified: the other 584 articles (Der Spiegel's batch was not re-extracted) or any run after
00afb4e deploys.

### What next

- The prompt is the fix; nothing enforces it. A cheap monitor would: count articles from non-English
  sources that end up as singletons per run (304-311 had 5-20 cross-language candidates a run). If
  that count stays high after the deploy, the tags have drifted back.
- If an embedding step comes back, it is MiniLM-class or larger, in a subprocess with its own
  memory limit, and its τ needs more than one tuning run. The labels here are a start.

### Reproduce

```sh
docs/proposed/multilingual-attach/fetch.sh 304 305 306 307 308 309 310 311   # inputs (read-only bin/ops)
docs/proposed/multilingual-attach/models.sh <models-dir>                      # 118 MB + 434 MB, sha256 printed
docker build --platform linux/amd64 -t mlattach-poc:amd64 docs/proposed/multilingual-attach
docker compose run --rm --no-deps -v "$PWD/docs/proposed/multilingual-attach:/m" --entrypoint node digest-worker /m/rejoin_fix.mjs   # inputs/311fix/clusters.json, which run.sh reads
docs/proposed/multilingual-attach/run.sh <models-dir>                         # resources.jsonl, then attach_summary.jsonl (vectors are not committed)
docker compose run --rm --no-deps -v "$PWD/docs/proposed/multilingual-attach:/m:ro" --entrypoint node digest-worker /m/rejoin.mjs /m/inputs 304 305 306 307 308 309 310 311
```
