#!/bin/sh
# Fetch the archived inputs for runs $@ (read-only, bin/ops) into inputs/<run>/.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
for run in "$@"; do
  d="$here/inputs/$run"; mkdir -p "$d"
  for name in $(bin/ops artifacts "$run" | grep -oE '"name":"(cluster_tags\.json|clusters\.json|articles_[0-9]+\.csv)","status":"current"' | cut -d'"' -f4); do
    bin/ops artifact "$run" "$name" > "$d/$name"
  done
  echo "$run: $(ls "$d" | tr '\n' ' ')"
done
