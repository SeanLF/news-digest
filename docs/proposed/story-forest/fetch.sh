#!/usr/bin/env bash
# Pull runs 284-311's clustering, shipped selections, thread links and article CSVs from the local
# clone (bin/db-clone --live first) into inputs/<run>.json, one compact file per run.
set -euo pipefail
cd "$(dirname "$0")/../../.."
out=docs/proposed/story-forest/inputs
mkdir -p "$out"
for run in $(seq "${1:-284}" "${2:-311}"); do
  bin/psql -At -c "select json_build_object(
      'run', $run,
      'date', (select to_char(started_at,'YYYY-MM-DD') from runs where id=$run),
      'clusters', (select content::jsonb from artifacts where run_id=$run and name='clusters.json' and status='current'),
      'tags', (select content::jsonb->'tags' from artifacts where run_id=$run and name='cluster_tags.json' and status='current'),
      'selections', (select content::jsonb from artifacts where run_id=$run and name='selections.json' and status='current'),
      'thread_links', (select content::jsonb->'stories' from artifacts where run_id=$run and name='thread_links.json' and status='current'),
      'articles_csv', (select string_agg(content, E'\n--CSV--\n' order by name) from artifacts where run_id=$run and name like 'articles\_%.csv' escape '\' and status='current'))" > "$out/$run.json"
done
ls "$out" | wc -l
