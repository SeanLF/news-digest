---
title: Before picking a similarity threshold on free text, plot the distribution; if it does not split in two, no threshold is safe.
date: 2026-09-28
category: best-practices
module: render
problem_type: best_practice
severity: medium
applies_when:
  - deciding whether two articles, titles or passages are "the same" by a similarity score
  - a design says "Jaccard >= 0.6" or "cosine >= 0.8" without a histogram behind it
  - the text compared is a feed summary rather than the article
tags: [threshold, jaccard, dedup, grouping, wire, measurement, goodhart]
---

# A threshold needs a distribution that splits

*2026-09-28. The sources-box design proposed grouping wire reprints by title word overlap at
Jaccard 0.6, "the August audit's threshold". Measuring it first killed it.*

## The lesson

**A cut-off on a similarity score is only as good as the gap it sits in.** Plot the score over
real pairs first. If same-report and different-report pairs form two humps with a gap, put the cut
in the gap. If the values spread smoothly, any cut is a guess that trades misses for false merges
at a rate nobody measured, and it moves when the catalogue or the language mix does.

On runs 307-310, 1,139 cross-outlet pairs within stories (a scratch replay over the archived
artifacts, no model calls):

```
title Jaccard, pairs per 0.1 bucket:   0.3:50  0.4:27  0.5:15  0.6:10  0.7:13  0.8:8  0.9+:29
feed-summary 5-gram overlap:           964 of 985 pairs share nothing, identical-headline
                                       Reuters reprints included
```

Titles spread smoothly with one spike at near-identical; summaries carry no signal at all, because
Reuters' feed summary is its headline and other outlets write their own teasers. What the data
supports is equality (identical normalised headlines) and explicit tags (wire in the byline or
dateline), so that is all the grouping uses (`digest/src/render/reports.ts`).

## How to apply

- **Histogram before threshold**, on the text the rule will actually see in production (feed
  fields, not the article you imagine behind them).
- **Prefer evidence that needs no threshold**: tags, equality, a dateline. Undercounting is the
  safe error when the alternative is inventing a merge.
- **Know where the strong signal lives and whether you have it.** Verbatim wire reuse shows in the
  body; only 31 of those pairs had full text on both sides, so body matching waits for more full
  text (design phase P2) and ships only if its distribution splits.
- **Prior art for body matching exists**: Boumans et al. (2018) traced agency copy across a year of
  Dutch news by automated text reuse detection; adopt their method rather than tune one.

## Related

- `docs/2026-09-28-sources-box-design.md` §3 D4.
- [the-metric-was-the-problem.md](../the-metric-was-the-problem.md).
