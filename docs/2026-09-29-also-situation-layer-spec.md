# "Also": the pipeline half of the situation layer (spec, 2026-09-29)

*Status: PARKED 2026-09-29. Option C failed its pre-registered gates twice (see Results); nothing built. Handoff from session news-digest-37; the
web prototype is in that session's scratchpad (`sidebar/proto4.html`, `build4.py`).*

## The pain, and whose

The reader's. 20 of 63 runs (32%) shipped two or more top-level stories that the thread linker
put on one thread. Most are one situation told through different events (the US-Iran war: a
strike exchange and Russia arming Iran), which read as the same story twice or as the issue
failing to connect them. About 5-7 are true duplicates the issue budget (`253709c`) and English
tags (`00afb4e`) are meant to stop. Prod reach is near zero, so this is page quality for the
builder-recognition goal, not a retention fix.

## Requirements (Sean's, via the handoff)

| # | requirement |
|---|---|
| R1 | An also is a `<details>` under its main story: summary "› Also *headline*", no report count; opens in place to its summary and sources box; works without JS. |
| R2 | An also has no tier; it shares its lead's slot (main bar and sidebar). |
| R3 | Fold only when it is the same situation and the lead carries the main point. A distinct headline event stays its own story. |
| R4 | Email: an also is its headline, linking to its web anchor. |
| R5 | Threads link through the lead. |
| R6 | Evaluated on runs the prompt was not designed on; every harness negative-controlled. |
| R7 | The repo is public: no RSS text or article data committed. |

## Options

**A. SELECT picks situations** (a lead plus optional alsos, typed output). One decision where
selection happens, and WRITE could write alsos compactly. Against: both SELECT rule changes
failed held out (the "one story per situation" rule merged 5/15 duplicates and over-merged
sidebars in 3/6); SELECT works on clusters that are ~11% junk, before the story exists; and
it changes `Selected`, which fulltext, planStories and WRITE consume.

**B. A group pass after SELECT, before WRITE.** Relabels picks without touching SELECT. Against:
it groups picks, not stories, and writers re-angle (on 311 both North Korea stories moved off
what SELECT picked), so a pre-WRITE grouping can be wrong by the time it renders.

**C. A group pass after assemble (recommended before the PoC; it failed, see Results).** One Sonnet call, structured output, over the
issue's final headlines and summaries: for each story, top-level or `also_of` another. The
doubles check already has this shape and is the only one measured stable (5/8 same event,
0/70 unrelated, stable across reps). The 92 labels were read on shipped headlines, which is
exactly this pass's input, so there is an evaluation set for C and none for A or B. Every
checking stage (coherence, repair, attribute) is untouched: an also is a brief that was
written and checked like any other. Against: an also is a full brief, not a compact one (the
prototype shows a summary, so a brief fits); SELECT's tier targets don't know about folding,
so a folded issue shows fewer top-level stories (arguably the tighter digest `select.md`
asks for).

## Design (option C, not built)

**Placement.** A `group` activity after `assemble`, before the gnews decode and the threads
phase, so the linker sees leads only (R5) and its "already claimed" collisions for folded
pairs disappear. Best-effort, one attempt, bounded like `attribute`: a failure ships the issue
as today, flat.

**Contract.** Flat, not nested: a story gains `also_of?: number` (the lead's position in
`must_know ++ should_know` after assemble), and `SelectionsSchema` checks it points at a
story that is not itself an also. Every existing consumer that counts or iterates stories
(pre-send `STORIES_DROPPED`, run health, `recordShownHeadlines`, `archiveRun`, gnews) keeps
treating an also as a story, which is today's behaviour. A nested `also: Brief[]` would make
every consumer I miss silently skip alsos: pre-send's `STORY_COUNT_RANGES` (should-know
3-14) would count a folded issue short, and yesterday's headlines would lose the alsos that
SELECT's continuity rule reads. Only render, email, threads and the site's rail read
`also_of`.

**Tier.** An also leaves its tier list on the page (R2) but keeps its place in the data. The
lead is never lower-tier than its also (see question 2).

**Render.** Web: the also renders after its lead's body as `<details class="also"
id="also-…">` with proto4's markup and CSS moved into `digest.css`. Email: a headline link to
that anchor (R4). The rail lists leads only.

**Workflow.** Adding an activity changes the command sequence: runs are pinned to the build
that started them (`deployment.ts`), so no `patched()`, but the replay fixtures are
re-recorded in the same commit (`digest.workflow.ts` header).

**Prompt.** `digest/agents/group.md`, the event-identity rubric from the labels
(`SAME_EVENT`, `SAME_SITUATION`, `UNRELATED`) plus R3's fold test: fold `SAME_SITUATION` only
when the lead's headline carries the situation's main point.

## Evaluation (pre-registered for the first PoC)

- **Design set:** runs 284-299. **Held out:** runs 300-311 (labelled today, not looked at
  through the grouper), plus Python-era issues before 284 labelled blind before the grouper
  runs on them.
- **Pass:** on held out, 0 folds of an `UNRELATED` pair (a wrong fold hides a distinct story,
  the costly error); at least half the `SAME_SITUATION` pairs folded; each fold agreed by 3/3
  reps. Lead choice is judgement: accept where reps agree, no gold.
- **Negative controls:** an issue of 12 unrelated stories folds nothing; a known pair planted
  into an unrelated issue is folded (the harness can see a fold at all).
- **Cost:** one Sonnet call per run; measured at $0.014 a call (Results).
- Harness and inputs in the scratchpad or gitignored with a `fetch.sh` (R7).

## Prior art

Techmeme runs a lead headline with related coverage beneath it; Google News groups coverage
under a lead with "full coverage"; print newsrooms call it the sidebar (all from memory, not
re-checked today). Story Forest's event tree is the academic version and was measured today:
0/5 held out on tags, because tags can't separate same event from same situation. The typed
decision over raw text that replaced it here is what C does.

## Open questions (Sean's calls)

1. **True duplicates** (`SAME_EVENT`): fold as an also, or drop the weaker? Folding keeps
   the text and costs one collapsed line; dropping is what a reader expects of a duplicate.
2. **A must-know folded under a should-know:** swap the lead, or refuse the fold?
3. **Scope:** does "pipeline half" include the render and email (proposed above), leaving the
   site's rail and old-issue pages to the web half?
4. **Old issues:** leave them flat (proposed), or run the grouper over archived issues?

## Results: option C PoC (2026-09-29)

Harness and inputs in the session scratchpad (`also/`: `group_one.mjs`, `run.sh`, `score.py`,
`PREREG.md`), not committed. Prompt iterated twice on runs 284-299, then frozen with one
enforced rule (a must-know folds only as the same event: the prompt alone ignored it, 3/3).
Sonnet 5.5, adaptive thinking, 3 reps per issue, $0.014 a call.

| gate (held out, frozen prompt) | pass | result |
|---|---|---|
| G1: folds of labelled UNRELATED pairs, runs 300-311, summed over reps | <= 1 | **7** (3 pairs) |
| G2: wrong folds on runs 250-283, read one by one | <= 10% | **~21/36 (58%)** |
| G3: folds proposed by all 3 reps | >= 67% | **43%** (300-311), 58% (250-283) |
| PC1: planted same-event pair folded | 3/3 | 3/3 |
| NC1/NC2: 12 stories from 12 days | no cross-topic fold | 0 cross-topic; 2 of 6 reps fold same-war stories from different days |

The failure is one mechanism: the model's "situation" collapses to the widest frame. An umbrella
lead gathers distinct headline events: "UN General Assembly opens" took Burnham's G20, Zelensky
meeting the CIA chief and the Greenland deal; "Iran warns neighbours" took Iran-linked hackers
shutting a UK power plant; a Kyiv strike took Zaporizhzhia losing external power. The
"several fronts are several situations" rule and "a headline event stays standalone" are in the
prompt and did not hold. It is the cluster junk-drawer failure again, one level up.

What did work: same-event folds. Labelled SAME_EVENT pairs held out were folded 3/3 in 4 of 5;
of the 7 distinct folds the model itself called SAME_EVENT across all sets, 6 are right on
reading. Small n, and that restriction was chosen after seeing the held-out data, so it needs a
fresh held-out set before anyone trusts it.

Grading G2 was one reader (Claude), not blind to the grouper's reasons; the margin is wide
enough that a lenient reader still fails it.

## Results: v3, quote-grounded (2026-09-29, same day)

Deterministic evidence first, to gate the model's folds: none separates them. True duplicates
share no cited article (0/8: each story cites from its own cluster); the thread linker proposes
a thread for too few stories to compare (1 of 5 same-situation pairs, 26 of 39 labelled pairs
have none). Tags failed earlier (Story Forest).

v3 asks for the words in the also's summary that refer to the lead's own event (not the wider
war), and code keeps a fold only when the quote is in that summary. Dev once, then frozen;
held out on runs 200-249 (unseen; 45 issues, since 201-203, 218 and 229 archived no selections) and 300-311.

| gate | pass | v1 | v3 |
|---|---|---|---|
| G1: rep-folds of UNRELATED pairs, 300-311 | <= 1 | 7 | **1** |
| G2: wrong folds on unseen runs, read one by one | <= 10% | 58% (250-283) | **29%** (8/28, 200-249) |
| G3: folds by all 3 reps | >= 67% | 43% | **54%** |
| issues with a fold (majority) | | | 18/45 |
| PC1 duplicate / PC2 sidebar planted | 3/3 each | 3/3, 3/3 | 3/3, **2/3 (miss)** |

The instruction did the work, not the check: all 88 proposed quotes were verbatim, so the code
never removed a fold. Of the 8 wrong folds, 5 are unstable (1-2 reps); the stable 3 are a
headline event folded as a sidebar (Venezuela blocks Machado's return, under the quake toll)
and a different front (Houthis strike Aramco, under oil falling on the US-Iran pause). Keeping
only 3/3 folds leaves 3/15 wrong (20%), still over the gate, and was not pre-registered.

The grouper's SAME_EVENT label is not a drop signal: 3 of 8 on runs 200-249 are wrong on
reading. Dropping duplicates belongs to the doubles check (0/70 false alarms).

The 10% gate priced a wrong fold as hiding a story. The also's headline stays on the page,
one click from its summary, so a wrong fold may cost less than that; that is a product call,
not a reason to move the gate after the fact.

## Decision (Sean, 2026-09-29)

Park "also"; build nothing now.

- **Duplicates are dropped, not folded.** The doubles check is the instrument (0/70 false alarms,
  95% upper bound ~5%; recall 5/8, 31-86%). It stays a run-health monitor until the issue budget
  and English tags are deployed; build the drop only if it keeps flagging real duplicates after.
- **The grouper is not built.** 8/28 wrong folds is 15-47% (95%); at a true 10% rate, 8 or more
  would happen 0.5% of the time. Its benefit (a better page for readers) cannot be measured with
  today's readership.
- **Why per-decision, not per-issue, evidence:** detecting a drop in issues shipping a duplicate
  from 21% (6 of 28 issues in runs 284-311, `docs/2026-09-29-duplicate-stories.md`; the 5-7
  of 63 above is the thread-collision count, a different window) to 5% needs ~66 issues per arm (21% to 10%: ~159), months at one issue a day.
