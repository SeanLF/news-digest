# Sources box and claim ledger (2026-09-28)

Design for how an issue shows its sources: a bias bar that counts reports, what each source backs,
and an email that links out instead of carrying the detail. It also covers the two defects that
work exposed: stories cite articles that support nothing in them (the "kitchen sink"), and the
checker mostly reads feed summaries, not articles. Mock-up:
https://claude.ai/artifact/VXjerjw2yqrZjz7Eq4MxTv (private).

## 1. Requirements (Sean, 2026-09-28)

| # | Requirement |
|---|---|
| R1 | Email: no bias bar, no "how reporting varies"; both live on the web. |
| R2 | Email: each story ends with one line, `5 reports · 7 outlets | Sources and coverage →`, linking to the story on the web. |
| R3 | No "checked" mark anywhere; a reader assumes a story was checked. |
| R4 | The bar counts reports: a wire origin or an outlet's own reporting, with reprints nested under their origin. |
| R5 | Web: each report says what in the story it backs, as its own column, separate from how reporting varies. |
| R6 | Web: a link per article, as today. |
| R7 | Web: "how reporting varies" stays as it is. |
| R8 | Read depth (full article, or headline and summary only) is web-only; never in the email. |
| R9 | Kitchen-sink articles are a bug: a cited article that backs nothing in the story is not shown. |
| R10 | Forward-only: archived issue HTML never changes. |
| R11 | No new external services, and nothing US-hosted added; privacy first. |
| R12 | A standalone per-claim fact-check block: undecided, not built. |

R5 and R9 both need a record of which article backs which claim, so the claim ledger (§3, D1) is
required even though R12 is undecided.

## 2. The system today

| Stage | What it produces about sources | Where |
|---|---|---|
| prepare | `article_index.json`: `wire`, `wire_agency` from author or dateline | `digest/src/prepare/prepare.ts:51-60`, `wire.ts` |
| full text | the first `FULLTEXT_PER_STORY`=3 ids of each selected cluster, before WRITE | `digest/src/activities/fulltext.ts:17-28` |
| write | `sources: [{article_id}]` within the plan's context; `reporting_varies: [{source, angle, bias}]` with `source` as free text | `digest/agents/write.md:47,67,71-100`, `write.ts:60-86` |
| coherence | per story `{article_ids, pass, reason, failed_fields, failure_kinds}` over the CSVs and the full text | `digest/src/contracts/coherence.ts:4-13`, `coherence.ts:116-122` |
| repair, assemble | patch failed fields and recheck, joined on article ids; drop or blank the rest | `repair.ts:26-89,144-153`, `assemble.ts:37-93` |
| threads | `whats_new: [{fact, sources}]`, audited per fact | `digest/agents/thread-synthesis.md:21`, `threads.ts:312-370` |
| render | `collapseReposts` merges verbatim reposts; web sources box and bar; email bar, angles and "view sources online" | `render/resolve.ts:18-35`, `render/web.ts:7-49`, `render/email.ts:68-108` |
| storage, site | `issues.html` as rendered; stories carry `id=<slug>` anchors the email already links to | `db/migrations/20260923200000_schema.sql:107-117`, `render/web.ts:34-79` |

Measured, runs 307-310 (`bin/ops artifact <run> …`):
- Of 81 articles cited in run 310, 17 had full text; 12 of the rest were Straits Times and 9 SCMP
  World, which extract.
- Of 317 citations across the four runs, 126 (40%) sit in their cluster's first three articles,
  60 (19%) in 4-6, 131 (41%) at 7 or later.
- The writer's rule against citing off-event articles is prose only (`write.md:47`); its citation
  self-check tells it to add articles (`write.md:98`), never to remove one.
- `reporting_varies` can name an outlet the story does not cite (run 310, RAF Fairford story: NYT).

## 3. Decisions

### D1. The claim ledger, written by the checker

One record per story, keyed by its cited article-id set (repair can rewrite the headline;
`repair.ts:80-89` and `assemble.ts:41-61` already join on ids):

```json
{ "article_ids": ["A5", "A26", "A129", "A471"],
  "claims": [ { "field": "summary", "text": "investigators focus on a possible Iran link",
                "supported_by": ["A129"] } ],
  "read": { "A5": "full", "A26": "truncated", "A129": "summary" } }
```

The checker writes `claims`; it already reads every cited article and enumerates specifics in its
probes (`coherence.md`, probe 1). The activity fills `read` from `article_fulltext.json`. An
article's "what it backs" (R5) is the claims naming it. Articles naming no claim are the kitchen
sink (R9), derived, not asked for.

Amended after P3's backfill: the checker's `supported_by` is incomplete (it cites the first source
it finds), so a separate stage, `attribute`, fills it. Per story it asks, for every (article, claim)
pair, `states`, `differs` or `silent` with a verbatim quote; code keeps an answer only when the quote
is in the article and calls a story complete only when every pair is answered. The checker still
extracts the claims. Measured in `docs/proposed/attribution-2026-09-28/`.

| Option | For | Against |
|---|---|---|
| A. WRITE declares claims, checker verifies (the thread pattern) | writer accountable for citations | two stages change; unlisted claims escape the check |
| **B. The checker writes the ledger** | WRITE untouched; the adversarial reader is independent | output grows; the list is only as complete as its probes |
| C. A separate extraction stage | separation | one more call and failure mode, no evidence it beats B |

Repair changes: its recheck (`repair.ts:144-153`) emits ledgers for the stories it patched, and
assemble replaces each first-pass ledger by id set.

### D2. Kitchen sink: removed at assemble, after full text is fixed

The detector is D1: a cited article that backs no claim. The fix is assemble removing it from the
story's `sources` before render, so it is never shown (R9). Two things decide the order:

1. It must not act on partial text. An article checked against a 500-character teaser, or against
   the first 4,000 characters of a longer piece, can back nothing in the story and still be about
   it. So D3 lands first, and the removal only drops an article whose `read` is `full`, not
   `truncated` or `summary` (§6a). A summary-only article that backs nothing stays, and is counted
   in `claim_ledger.json` so the rate is visible.
2. Its size is unknown. Backfilling ledgers for runs 307-310 (the checker over their archived
   drafts, about $3) measures it before anything is removed.

Prevention in WRITE stays prose, as today; enforcement is the removal.

### D3. Full text for what is cited: a second fetch after WRITE

The pre-write fetch stays (the writer uses it, `write.md:45`). A new activity pair
(`planFulltextTopup`, the existing `fetchFulltext`) fetches cited ids with no full text, before
coherence, behind `patched("fulltext-topup")`, merged into `article_fulltext.json`. Raising
`FULLTEXT_PER_STORY` is ruled out by §2: doubling it reaches at most 59% of citations, and it is a
confounded test, since WRITE prefers to cite what it has full text for (`write.md:22`).

### D4. Report grouping: explicit provenance only, no free-text threshold

A reprint joins its origin only on evidence that needs no tuned cut-off:
1. a wire named by the feed's author field or summary dateline (today's `wire_agency`);
2. a wire named in the full text's dateline (new: `wireFromDateline` over the first paragraph);
3. the same headline after normalisation (case, punctuation, a trailing " - Reuters"), extending
   `collapseReposts` across outlets. Equality, not similarity.

Anything else counts as independent. That undercounts reprints, the error that leaves the bar where
it is today rather than inventing a merge.

Measured on runs 307-310 (a scratch script over the archived artifacts; 1,139 cross-outlet pairs
within stories), no free-text similarity in the feed has a threshold the data supports:
- Title word Jaccard spreads smoothly across 0.3-0.9 (50, 27, 15, 10, 13, 8 pairs per 0.1 bucket),
  with one spike at 0.9 and above (29 pairs, near-identical headlines, covered by rule 3). Any
  cut-off in between is a guess, and reposters rewrite headlines.
- Feed summaries share no five-word run in 964 of 985 pairs, including identical-headline Reuters
  reprints: Reuters' feed summary is its headline, and other outlets write their own teasers.
- Full text names a wire in its first 600 characters for 14 of 118 articles (13 Al-Monitor), which
  rule 2 uses.
- Shared passages in full text are the strong signal, but only 31 pairs had full text on both
  sides; P2 is needed before their distribution can be read. Body-passage grouping is revisited
  then, and ships only if the distribution splits cleanly in two.

A wire report takes its agency's own rating (Sean, 2026-09-28): state agencies are not neutral, so
wire copy is not a grey segment. Ratings are MBFC's (`AGENCY_RATINGS`, `render/common.ts`); PA Media
and IANS have no page and render unrated. The agency's aliases ("ap", "associated press") are one
agency. Carriers are listed under the report and do not add to the bar: reuse of agency copy online
is heavy and lightly edited (Boumans et al. 2018, a year of Dutch news: up to 75% of online articles
agency-based, largely verbatim), so a carrier's choice to run it is a weak signal. Identical
headlines with no wire tag are one report of unknown origin, "Shared copy", unrated, since nothing
says who copied whom. Translations do not group.

### D5. `reporting_varies` names cited articles

The writer gives each angle an `article_id`; assemble drops an angle whose id is not in the story's
`sources`, and render takes the outlet name from the index instead of free text. Deterministic,
small, independent of the rest.

### D6. Thread facts about another thread

Built instead without a model (2026-09-29): a fact that cites none of its own story's articles and
some of another story's this run is that story's fact, carried in by the late-binding neighbourhood,
and is dropped whatever the audit says (`offThread`, counted as `off_thread` in the thread's audit
record). Over the 29 installments stored in production (runs 248-310) it drops 5 of 191 facts: 4
plainly another thread's (the Fairford arrests in Hormuz, Trump's talks remark in Fairford, the
Pope's Metz remarks and the Swiss neutrality vote in the Ukraine strikes thread), 1 arguable
(Beijing's Iran stance in the Iran thread, citing only the Trump-Xi summit's articles). No fact
cited both its own story and another. The audit-prompt design below was not built:

`thread-audit.md` returns `{id, supported, about_thread}`; `applyInstallment` drops a fact that
fails either. The re-ask prompt (`digest/src/threads/synthesis.ts:126-127`) and the parser
(`synthesis.ts:145-188`) change with it, or a round-2 reply omits the field and the outer
fail-open (`threads.ts:364-369`) keeps every fact. An unreadable `about_thread` keeps the fact and
is counted in `thread_health.json`. Run 310's case: the Hormuz thread (t634) carried the RAF
Fairford arrests, which have their own thread (t986).

## 4. Display (R1-R8)

**Web**, per story, unchanged except the sources box:
- "How reporting varies" as today (R7), fed by D5.
- The box's closed line: bar and `5 reports · 7 outlets`.
- Open: one row per report, reprinting outlets nested beneath (R4); columns Report, Leaning,
  What it backs (R5, from the ledger; blank until P3), Articles as numbered links (R6), each
  link with its own read mark, since one outlet's articles can differ. Readers see two states,
  "read" (full or truncated) and "headline and summary"; truncated stays internal, for removal
  only (§6c, Hick). A one-line note inside the box when nothing was read (R8).

**Email**, per story: headline, summary, why it matters, then
`5 reports · 7 outlets | Sources and coverage →` to `/issues/<date>#<slug>` (R1, R2). The bar and
the angles blocks are removed from `render/email.ts:100-108`.

Forward-only (R10): issues rendered after each phase ships get it; stored HTML is never rewritten.

## 5. Non-functional

- N1. Cost: at most +$0.50 per run over the four-run mean of about $4.35, measured.
- N2. Time: at most +5 minutes per run typically. Worst case, the second fetch's retry policy
  (`digest/src/workflow/digest.workflow.ts:65`): about 18 minutes, inside the 230-minute deadline.
- N3. New workflow steps behind a Temporal patch (`CLAUDE.md`, Layering).
- N4. R11: no new service. The model-call traces to PostHog will carry the ledger too
  (`privacyMode: false`), an open question.
- N5. Claude still never sees URLs; everything is article ids.

## 6. Failure modes

| Failure | Behaviour |
|---|---|
| no ledger, or it fails schema | the story renders with an empty "What it backs" column; nothing is removed |
| a ledger claim names an id outside the story's citations | drop that mapping, log it |
| every cited article backs nothing | contradicts a passing check: treat as no ledger, log |
| second fetch down | the run goes on; `read` records what was read, so nothing summary-only is removed |
| repair patches a field | its recheck's ledger replaces the first, by id set |
| an angle's id is not cited | the angle is dropped (D5) |
| `about_thread` unreadable | fact kept, counted |

## 6a. Edge cases

Each with a decision. The ones marked **changes the design** are reflected above or below.

**Read depth**
- **Truncated full text** (changes the design). Full text is cut at 4,000 characters
  (`digest/python/settings.py:8`); 36 of the 118 articles extracted in runs 307-310 (31%) hit the
  cap. `read` has three values: `full`, `truncated`, `summary`. Only `full` counts as read in full,
  on the web dot and for kitchen-sink removal (D2); a truncated article that backs nothing stays.
- **Text that is not the article** (changes the design): a bot wall, a paywall teaser or a page
  footer is stored as full text and looks read in full (4 of 134 texts in runs 307-310 and dev
  run 310; the dev run removed Le Monde's live page, A24, on a "JavaScript is disabled" page).
  Attribution always shows the feed's title and summary above the full text, so an article whose
  own summary is on the story backs it; with that, the dev run removes nothing. An article said to
  back a claim whose quote is not in its text is never removed.
- **A live blog** (Le Monde's "EN DIRECT" pages): the text is a snapshot that changes after we read
  it. Treated like any article; the link may show different text later. No special case.
- **Full text in another language**: the checker reads French, German and Spanish today
  (Le Monde, Spiegel, Clarín). No special case.
- **The second fetch gives the checker text the writer never saw**: a writer's figure that the body
  corrects now fails the check. That is the check working, but repair load may rise; P2's gate
  watches the repair count alongside cost.

**Grouping**
- **A wire service that is also a catalogue source** (Reuters is fetched directly): the origin row
  links its own articles. Only an origin we don't fetch (AP, AFP) has a row with no link.
- **One outlet carrying two wires** on the same story (Straits Times running Reuters and AFP): the
  outlet appears under both origins. Counted once in "7 outlets", twice in the table.
- **An outlet's own reporting plus wire copy in one article** ("with reporting from Reuters"):
  grouped only if the author or dateline names the wire; otherwise it counts as the outlet's own.
  Undercounting a reprint is the safe error.
- **Chaining**: none, since every edge is an explicit tag or an exact headline. Generic headlines
  ("What we know", "Live updates") are excluded from rule 3 by a short fixed list, not a length
  threshold.
- **Two outlets' independent, identically-worded headlines on a terse event**: rule 3 would merge
  them. P1's hand check counts how often; if it happens, rule 3 requires a shared wire tag too.
- **An aggregator** (Hacker News links to other sites): its row is its own report, leaning as
  catalogued. Out of scope to resolve through to the linked site.
- **A translation of wire copy** is not grouped (out of scope, §3 D4), so it overcounts reports.
- **An undecoded Google News link** (the decoder is best-effort): the Articles link is the Google
  News URL, as today.

**Ledger and removal**
- **A claim only in the headline**: ledger claims carry `field`; headline claims count like any
  other.
- **why_it_matters analysis**: needs no support by design (`coherence.md`, "Do NOT fail on"); only
  its factual specifics become ledger claims.
- **Order inside assemble** (changes the design): blank or drop fields first, then remove
  articles that back nothing in what is left, then drop `reporting_varies` angles whose article
  was removed (D5). An article that only backed a blanked why_it_matters is then removed.
- **Removal empties a story's sources**: the story is not dropped for it; nothing is removed and
  the ledger is logged as contradicting the check (§6).
- **Checker nondeterminism** (changes the design): the same story can get a different ledger on a
  re-run, so a removal can flip. Both runs agreeing did not help: they skipped the same articles.
  Removal now needs the story's attribution to be complete; without it nothing is removed and the
  box shows the checker's list.
- **A figure that moved** (`differs`): most are a count or estimate that changed between reports
  (11 then 12 dead), not a disagreement. Recorded in `attribution.json` with each article's
  publication time, rendered nowhere; an article that differs still counts as covering the story.
- **Threads read the story's sources** after assemble (`digest.workflow.ts:244`): they get the
  cleaned list. Intended.
- **`story_sources`, `/sources` and `/stats`** record what was shown, so removed articles leave
  the outlet counts there too. Intended; old runs keep their rows (forward-only).

**Display**
- **Singular forms**: "1 report · 1 outlet".
- **Wire-only story**: one grey segment; leaning column shows "wire".
- **A brief (should_know)**: gets the same box on the web and the same line in the email; the email
  renders sources for briefs today (`render/email.ts:108`).
- **The markdown copy** (changes the design): `render/markdown.ts:20-27` builds its own spread
  line and outlet table; it changes with the web box in P1, or the markdown served at
  `/issues/<date>.md` disagrees with the page.
- **The email's link after a forced re-run**: the web may serve a newer revision whose headlines,
  and so slugs, differ; the link lands at the top of the page, not the story. Accepted: re-runs of
  sent days are rare and the page still loads.
- **No web copy** (send disabled or rejected): nothing is emailed either, so no dead link.
- **Read-depth dots and screen readers**: each dot carries visually hidden text ("read in full",
  "headline and summary only"), not only a `title`.
- **The email has no plain-text part** (none found in `render/email.ts` or `activities/broadcast.ts`):
  the line needs nothing extra; if a text part is added later, the link text must carry the URL.

## 6b. Measuring improvement without gaming it

What we want is for a reader to be able to trust two things: "N reports" means N separate pieces
of reporting, and every source shown backs the story. With 12 readers there is no outcome metric
for that trust, so every number here is a proxy, and each is paired with the number that would
move the other way if the proxy were gamed.

| Metric | Proxy for | Gamed by | Counter-metric |
|---|---|---|---|
| cited articles read in full | depth of the check | counting truncated as full; the writer citing fewer or easier outlets | full and truncated reported apart; citations and distinct outlets per story must not fall |
| reports per story | honesty of the bar | merging more | every merge hand-checked; merges broken down by rule |
| articles removed as backing nothing | a clean source list | removing more | hand-labelled removal precision; removals agreeing across two checker runs; sources per passing story must not fall below today's |
| coherence pass rate | story accuracy | a more lenient checker | planted-error recall on the fixed band (`make planted`) |
| cost and time | efficiency | skipping work (a second fetch failing quietly) | `fulltext_health.json` outcomes per run |

Rules:
1. **Labels are fixed before the change, blind, and never tuned on.** Sean labels the P1 pairs and
   the P3 stories without knowing which version produced them. A prompt is never judged on the set
   it was written from.
2. **Noise first.** Every model-judged number gets its self-agreement band (the same input run
   twice) before any difference is read as a gain.
3. **The model doesn't grade itself.** The ledger is scored against hand labels, not against the
   checker, and not against another model unless that model's agreement with the hand labels is
   measured first.
4. **Production numbers are tripwires, not targets.** Run-health watches the removal rate, the
   truncated share and reports per outlet, and alerts on a jump. Nobody optimises them.
5. **One outcome check we can afford**: each month, Sean reads the sources box of ten random
   stories blind and marks any report or source that is wrong. Small and subjective, and the only
   measurement here that isn't a proxy.

## 6c. The laws, applied

| Law | What it changed or confirmed here |
|---|---|
| Goodhart | §6b: every metric has a counter-metric; production numbers are tripwires |
| Chesterton's fence | the cap of 3 full-text fetches per story (`399a78c`, "the first 3 cited articles per story") bounds time under a 120 s deadline, and later the stall fix (`aa55df6`); D3's second fetch keeps both bounds and restores the "cited" intent. The email bar was a deliberate part of the 2026-07-05 redesign (`dd7fac9`); it goes because Sean asked |
| Occam | D4 dropped fuzzy title matching for explicit tags and exact headlines |
| Pareto | measure before growing anything: how many reprints the explicit rules catch (P1), how common the kitchen sink is (P3's backfill) |
| Hick | readers see two read states, "read" and "headline and summary"; truncated stays internal |
| Hofstadter, Parkinson | each phase is timeboxed and ships alone; P4 (threads) waits until P3 has shipped |
| Dunning-Kruger | this design changed shape seven times in one session; confidence is not evidence, hence a hand-checked gate on every phase |
| Hanlon | the kitchen sink comes from the writer's own self-check, which says add articles and never remove one (`write.md:98`); the fix is enforcement, not blame |
| Peter principle | the checker is promoted from pass/fail per story to the source of truth for display and removal; its competence at that is unmeasured until P3's gate |
| Brooks | phases are built one at a time by one owner; parallel agents add coordination, not speed |

## 7. Phases and gates (pre-registered)

| Phase | Ships | Gate |
|---|---|---|
| P1 | grouping (D4), the web box without "What it backs", the markdown copy, the email line; D5 | every grouped pair in runs 307-310 checked (explicit rules make them few): ≥ 95% the same report; reprints the rules miss counted, not gated; render tests for web, markdown and MJML. Passed 2026-09-28, 19/19: all Reuters; every tagged carrier's text has a "(Reuters)" dateline, every untagged member has a tagged member's exact headline |
| P2 | second fetch (D3) | every cited article from a source that extracts gets its text, the misses only sources known to block us (Reuters, the paywalls); cost and time within N1, N2 over three prod runs; repair count reported against runs 307-310. Measured before deploy on runs 307-310 from the box: 229 of 317 cited (72%, from 28%), all 88 misses blocked or paywalled |
| P3 | ledger (D1), attribution, "What it backs", kitchen-sink removal (D2) | planted-error band recall stays 8/8 (`make planted`); every removal on runs 307-310 checked against the removed article's own text, none of which states a specific of its story; removals the same across two attribution runs. The first gate (checker lists, two checker runs, hand labels) failed: 2 of its 4 agreed removals backed the story (A18 run 308, A37 run 309). Passed on attribution 2026-09-28: 2 removals in 4 runs (A8 run 307, A16 run 308), both identical across runs, 98.5% of pairs agree; no hand labels, since which article states a specific is read off its text |
| P4 | thread `about_thread` (D6) | every fact the rule drops over production's stored installments is read against both threads' stories: 4 of 5 plainly the other thread's, 1 arguable (2026-09-29) |

P1 and P2 are independent and can go in parallel. P3 needs P2, or the removal has almost no
full-text articles to act on. A failed gate stops that phase and is reported.

Between P2 and P3: Sonnet 5.5 (`claude-sonnet-5-5`, released 2026-09-28, same price as Sonnet 5)
is evaluated for the checker and the writer, and for the stages still on Sonnet 4.6. It needs the
SDK at 0.3.284 or later (0.3.280 does not list the model). P3's gates are measured against the
checker, so the model is chosen before they are set, not after; P1 and P2 make no model calls and
are unaffected.

Measured 2026-09-28 (`docs/proposed/coherence-planted/model-2026-09-28/`): on the planted band the
checker on Sonnet 5.5 keeps recall 8/8, flags story 11's "already disrupting" (the source says
"could") where Sonnet 5 does not, and runs about 3x faster. It ships with P1 and P2 (Sean, 2026-09-28:
"it's an improvement"), so P2's cost check is read against runs 307-310 knowing the checker changed
too; P3's gates are set on Sonnet 5.5.

## 8. Open

1. The PostHog question (N4).
2. R12, a standalone per-claim block: revisit once "What it backs" is live.
3. Whether a summary-only article that backs nothing should also go, once P3's backfill shows how
   often a full read would have kept it.
