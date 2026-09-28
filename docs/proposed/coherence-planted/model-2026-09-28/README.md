# Checker on Sonnet 5.5: planted-defect band (2026-09-28)

The COHERENCE checker, read-loop shape (production's), on planted278 (8 planted fabrications, 24
clean fields), Sonnet 5 against Sonnet 5.5, three reps each. SDK 0.3.284 (`f0f49c7`). Config
`planted-model.yaml`; per-rep results `results.json`. Reproduce: a copy of `digest/agents/` with
`coherence.md` on `claude-sonnet-5-5`, mounted at `/app/agents-s55/`, then
`npx promptfoo@0.123.1 eval -c gate/planted-model.yaml --repeat 3 -j 1 --no-cache` in the worker image.

| Model | Recall | False drops | Which clean fields | Wall s | $ (API-equivalent) |
|---|---|---|---|---|---|
| Sonnet 5 | 8/8, 8/8, 8/8 | 1, 2, 2 | 9 why (3/3), 4 why (2/3) | 194, 260, 271 | 0.80, 0.95, 1.01 |
| Sonnet 5.5 | 8/8, 8/8, 8/8 | 2, 3, 2 | 9 why (3/3), 11 why (3/3), 11 headline (1/3) | 75, 83, 63 | 0.78, 0.82, 0.71 |

Sonnet 5 reproduces the 2026-09-18 band's recurring disagreements (story 9 and story 4
`why_it_matters`, the pending adjudication case). Sonnet 5.5 never flags story 4 and flags story 11
every rep. Its reason: the field says typhoons and heat "are already disrupting" Taiwan Strait
planning where A497 says they "could"; once, that the headline has parliament backing a boost the
government lined up. Both read as real defects the key labels clean, so story 11 joins the
adjudication case. Until it is ruled on, the false-drop difference (2.3 against 1.7 mean, n=3 each,
overlapping at 2) is not evidence against Sonnet 5.5.

Decision (see `docs/2026-09-28-sources-box-design.md` §7): switch the checker to Sonnet 5.5, as its
own deploy after P1 and P2, so P2's cost gate is measured on one model. The writer and the stages
still on Sonnet 4.6 are not evaluated here.

## Re-scored after the key correction (same runs, no new model calls)

The flagged clean fields were checked against their cited text: story 4 "secret meeting", story 9
"Iran-related sanctions pressure", story 11 "already disrupting" and its headline's "parliament
backs" are all unsupported. They move to the key's `found_defects` (evidence per entry); the other
20 clean labels stay un-audited.

| Arm | Recall | False drops (of 20) | Real defects caught (of 4) |
|---|---|---|---|
| Sonnet 5 | 8/8 ×3 | 0, 0, 0 | 1, 2, 2 |
| Sonnet 5.5 | 8/8 ×3 | 0, 0, 0 | 2, 3, 2 |
| Sonnet 5.5, claims | 8/8 ×3 | 0, 0, 0 | 4, 4, 3 |
