// Negative control: joinTags over a run's archived tags must reproduce its archived clusters.json.
// usage (worker image): node rejoin.mjs <data-dir> <run>...
import { readFileSync } from "node:fs";
import { joinTags } from "/app/digest/dist/cluster/join.js";
const [dir, ...runs] = process.argv.slice(2);
let bad = 0;
for (const run of runs) {
  const tags = JSON.parse(readFileSync(`${dir}/${run}/cluster_tags.json`, "utf8")).tags;
  const archived = JSON.parse(readFileSync(`${dir}/${run}/clusters.json`, "utf8")).clusters;
  const ids = archived.flatMap((c) => c.article_ids).toSorted((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const same = JSON.stringify(joinTags(ids, tags)) === JSON.stringify(archived);
  if (!same) bad++;
  console.log(run, same ? "identical" : "DIFFERS", archived.length, "clusters");
}
process.exit(bad ? 1 : 0);
