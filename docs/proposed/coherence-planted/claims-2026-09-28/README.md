# Checker with claims: planted-defect band (2026-09-28)

P3's first gate (`docs/2026-09-28-sources-box-design.md` §7): the checker asked to return claims
with their supporting articles must keep the planted band. Sonnet 5.5, read-loop, planted278, three
reps; config `planted-claims.yaml`, per-rep results `results.json`.

| Rep | Recall | False drops | Which clean fields |
|---|---|---|---|
| 1 | 8/8 | 4 | 4 why, 9 why, 11 headline, 11 why |
| 2 | 8/8 | 4 | 4 why, 9 why, 11 headline, 11 why |
| 3 | 8/8 | 3 | 4 why, 9 why, 11 why |

Without the claims instruction (`../model-2026-09-28`): 2, 3, 2. **The gate fails as written**
(false drops at most 3), so the instruction is taken back out of `coherence.md` and nothing ships
it.

Every flagged clean field is in the set awaiting Sean's adjudication (stories 4 and 9 since the
2026-09-18 band; 11 since the model evaluation). No other field appears. The checker's reasons:
story 4 calls Ratcliffe's Moscow contact a "secret meeting", which no cited source says; story 11
says "already disrupting" where A497 says "could". If these are real defects the key mislabels, the
false drops are 0-1 and the gate passes; the instruction goes back in then.
