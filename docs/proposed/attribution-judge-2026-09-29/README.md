# Can attribution replace the checker's verification? (2026-09-29)

Planted band (planted278, corrected key: 8 planted, 20 clean, 4 found defects), Sonnet 5.5, run
with `judge.ts ARM REP` in the digest-worker image (`/planted` = docs/proposed/coherence-planted,
`/scratch` = a scratch dir with `judge/agents/claim-list.md`). Scorer negative controls pass
(all fields failed: 8/8, 20/20; none failed: 0/8, 0/20). No attribution pair missing in any rep.

- A: the shipped checker (coherence.md with claims).
- B: A's own claims -> the shipped attribute prompt -> verdict in code.
- C: `claim-list.md` (story only, no sources, Sonnet 5.5) -> attribute -> verdict. H: same with Haiku 4.5.
- Verdict "strict": a field fails if any of its claims has no verified `states`. "strict+differs"
  also fails on any `differs`. "lenient" (fail only with no states and no differs) is worst in every arm.

| Arm | Recall /8 | False drops /20 | Found /4 | $ per rep | s |
|---|---|---|---|---|---|
| A checker | 8, 8, 8 | 0, 0, 0 | 3, 4, 4 | 0.74, 0.90, 0.86 | 88-128 |
| B strict | 7, 8, 7 | 0, 0, 0 | 1, 2, 1 | checker + 0.64-0.75 | +60-92 |
| B strict+differs | 8, 8, 8 | 0, 0, 1 | 1, 2, 1 | same | |
| C strict | 7, 8, 7 | 5, 8, 7 | 4, 4, 2 | 1.33-1.40 | 153-157 |
| H strict (1 rep) | 6 | 4 | 2 | 1.14 | 155 |

Misses, from the quotes:
- 0 headline "Nepal-Bhutan rescue": attribution says `states`, quoting "Nepal and China have paused
  rescue efforts". The prompt's "states at least one of the claim's specifics" lets the true half
  carry the wrong entity. Atomic ("Rescue is Nepal-Bhutan", C) comes back `differs`.
- 13 summary "most data centre projects": `states`, quoting "about 20 percent of data center
  projects". The quote is real; its meaning is not the claim's. Code cannot check that. (Checked
  2026-09-29: in B-2 and B-3 that claim is `differs`, correctly; the `states` is not in the saved
  outputs, and B-1 saved no quotes for it. The story-0 case is confirmed in B-3.)
- C's false drops are mostly the lister putting analysis into why_it_matters claims ("ruling creates
  a precedent"), unsupported by construction. Two look real and are un-audited clean labels: 7
  summary "simultaneously" (ministry Thursday, appointment announced Friday, A36/A37); 9 headline
  "September" (sources say "next month").

Answer: no. Attribution is lenient where the checker is adversarial (partial matches,
quantifiers), and it is not cheaper: B costs the checker plus ~$0.7, C ~1.6x the checker (one
specific per claim triples the pairs). Keep the checker as the judge; attribution stays for display
and removal, where leniency errs toward keeping an article.

## A stricter attribution prompt does not fix the wrong-entity credit (2026-09-29)

`attribute-v3.md`: "differs" whenever any name, place, figure, date or quantifier in the claim is
different, checked before answering "states". Arm B, same claims, 3 reps: recall 7, 8, 7 (unchanged),
false drops 1, 0, 1 (from 0), and "Nepal-Bhutan rescue" is still `states` on "Nepal and China have
paused rescue efforts" in reps 1 and 3. On runs 307-310 it changes nothing that matters: the same
two removals, the five checked cases unchanged. Not shipped. Only one-specific claims (arm C) fixed
it, at C's false drops and cost. The checker judges first (8/8 here), so a wrong-entity claim reaches
"What it backs" only when the checker also missed it.
