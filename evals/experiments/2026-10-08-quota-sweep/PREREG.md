# Pre-registration, 2026-10-08 00:05Z, before any run (weekly quota 4% left, resets 01:00Z)

A. SELECT effort across days (decides deploying f8a291d). Runs 311-319, two reps each of default effort
   (data/agents-select-default = the deployed select.md) and high (repo HEAD). Metrics per arm: mean
   rep-to-rep must-know Jaccard per day (stability); runs with more than 6 must-knows (cap breaches).
   Rule: deploy if high's stability >= default's AND high's cap breaches <= default's.

B. COHERENCE on Haiku 5.5 at effort high (decides whether Haiku can check). Runs 311-319, one rep.
   Rule: viable only if it fails all three known real defects (311 Iraq airline attribution, 313
   Trump-Xi "progress" quote, 318 Hanning "first reported") AND misses vs prod <= 2 (a Sonnet replay's).

Kept here: cluster.yaml (C) and coherence.yaml (B). A's select.yaml is not: its default arm was a select.md
without `effort`, which an override cannot express, and a copied prompt directory would freeze the 10-08 prompts.
