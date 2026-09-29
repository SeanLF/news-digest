#!/bin/sh
# Every measurement, each in a fresh amd64 container under the prod Python worker's 384 MB cap.
# usage: run.sh <models-dir>   (from the repo root, after models.sh and a docker build of ./Dockerfile)
set -eu
D=$(cd "$(dirname "$0")" && pwd); M=$1
RUNS="304 305 306 307 308 309 310 311"
dr() { docker run --rm --platform linux/amd64 --memory=384m --memory-swap=384m -v "$D:/poc" -v "$M:/models" mlattach-poc:amd64 python /poc/embed.py "$@"; }
[ -s "$M/static/table256_fp16.npy" ] || docker run --rm --platform linux/amd64 -v "$D:/poc" -v "$M:/models" mlattach-poc:amd64 python /poc/embed.py prep /models /poc/inputs /poc/out
# Under the 384 MB cap: the control, and each arm that fits. The exit code is kept, not piped away:
# MiniLM and the fp32 static table are killed at 384 MB (137), so they are re-run at 1 GB for accuracy.
: > "$D/out/resources.jsonl"
for arm in control static256 minilm minilm_lean static1024; do
  set +e; out=$(dr $arm /models /poc/inputs /poc/out $RUNS 2>&1); rc=$?; set -e
  if [ $rc = 0 ]; then echo "$out" | tail -1 >> "$D/out/resources.jsonl"
  else echo "{\"arm\": \"$arm\", \"cap_mib\": 384, \"exit\": $rc}" >> "$D/out/resources.jsonl"
    docker run --rm --platform linux/amd64 --memory=1g --memory-swap=1g -v "$D:/poc" -v "$M:/models" mlattach-poc:amd64 python /poc/embed.py $arm /models /poc/inputs /poc/out $RUNS | tail -1 | sed 's/^{/{"cap_mib": 1024, /' >> "$D/out/resources.jsonl"
  fi
done
cat "$D/out/resources.jsonl"

# The attach step on every run, for each arm that embedded all runs. 311fix is run 311 re-joined with
# the new-prompt tags for 80 articles (rejoin_fix.mjs); its articles, so its vectors, are 311's.
for arm in static256 minilm; do
  cp "$D/out/${arm}_311.npy" "$D/out/${arm}_311fix.npy"; cp "$D/out/${arm}_311.ids.json" "$D/out/${arm}_311fix.ids.json"
  for run in $RUNS 311fix; do
    docker run --rm --platform linux/amd64 -v "$D:/poc" mlattach-poc:amd64 python /poc/attach.py $arm /poc/inputs /poc/out $run >> "$D/out/attach_summary.jsonl"
  done
done
