# Pre-registration, 2026-10-08 ~00:20Z, before any run
C. CLUSTER-EXTRACT Haiku 5.5 (deployed) vs Sonnet 5.5, runs 311-319: two Haiku reps and one Sonnet rep a
   day, each scored against prod's clusters (keeps = share of prod's co-clustered pairs kept; adds = pairs
   prod lacks, as a share of prod's). Rule: Haiku stays if its mean keeps >= Sonnet's mean keeps - 0.03
   AND its mean adds <= Sonnet's mean adds + 0.05. Otherwise cluster-extract goes back to Sonnet.
   Lost batches are reported per arm; a day where the Sonnet rep lost a batch is reported both ways.
