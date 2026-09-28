# Attribution: what each cited article backs (2026-09-28)

Inputs: the drafts, full text and article CSVs of prod runs 307-310 (65 stories, 317 cited articles,
63 read in full; P2's second fetch was not yet live), under `/scratch/backfill/<run>/`. Article text
is not committed.

- `backfill.ts`: the checker (coherence.md with the claims instruction) run twice per run.
- `removals.py S [reps]`: articles read in full that back no claim, per checker run.
- `attribute.ts`: the attribution matrix, one call per story (ATTR_MODEL, ATTR_SPEC, ATTR_TAG).
- `score_attr.py S TAG`: completeness, verbatim quotes, agreement with the checker, removals. It
  refuses to score when more than 2% of pairs are missing (the first Haiku run was 98% missing
  because the model wrote "C1: text" for the id: a broken harness, not a result).

## Removal from the checker's lists fails

Two checker runs agreed on 4 removals. Checked against each article's text:

| Run | Article | Text | Verdict |
|---|---|---|---|
| 309 | A37 BBC | Mass on Place de la Concorde, "an estimated 700,000" | wrong: backs the story, and differs on the crowd |
| 308 | A18 Al Jazeera | the seven-day plan; "talks through mediators are continuing" | wrong |
| 307 | A8 Al Jazeera | Netanyahu accused Mamdani of anti-Semitism in the speech | borderline |
| 308 | A16 Al Jazeera | Bangkok red alerts, 48 hours of rain; none of the story's specifics | right |

A93 (EFE, run 307, removed by one run only) states the 30% cap and the Valditara details. Both runs
skip the same articles, so agreement does not catch it. A prompt fix (one specific per claim, list
every article) still removed A18.

## Attribution

| Arm | Cost, 4 runs | Pairs answered | Quotes verbatim | Removals |
|---|---|---|---|---|
| Haiku 4.5 | $0.85 | 85% | | fails completeness |
| Sonnet 5.5, rep 1 | $1.29 | 1911/1914 | 543/562 | A8, A16 |
| Sonnet 5.5, rep 2 | $1.28 | | | A8, A16 |
| Sonnet 5.5, shipped prompt | $1.32 | 1914/1914 | 591/609 | A8, A16 |

The 18 quotes that failed are all feed summaries with HTML entities; the shipped check decodes them.
Rep 1 against rep 2: 1882/1910 pairs agree (98.5%). Against the checker: 124 supporters it missed
(12 of 12 sampled are right, e.g. Spiegel's German "Sabotage" report on the Starlink fire), 13 it
listed that attribution calls silent (A217, run 308: the checker's, the article never names Heidenau).

## "Differs" is mostly a figure that moved

15 differs both reps agree on, by publication time: 5 are a count or estimate the story updated
(Dera Ismail Khan 11 then 12 dead; South Africa 27 then 28; Ukraine 5 then 8; the Mass 700,000
then 800,000), 1 where the story kept the earlier figure (Sarandon arrests "dozens"; SCMP, newest,
100), 6 compatible statements (fines of 200 to 1,000 euros against "up to 1,000"), 1 real
disagreement (NYT: Trump "demurred" on strikes after the midterms), 1 claim no source makes (the
bomb threat, run 309, which the checker passed). Recorded, not rendered.

## End to end (dev run 310, 2026-09-28)

15 stories, 15 complete, $0.18. It removed A24 from the Ukraine drones story: the stored "full text"
was a bot wall ("JavaScript is disabled in your browser"), and A24 is the story's only source for
"Le Monde reported loud explosions". With the feed title and summary shown above the full text, A24
backs "explosions in Kyiv, air force ballistic missile warning" and nothing is removed.
