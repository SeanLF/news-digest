// 311 with the new-prompt tags for the 80 re-extracted articles: re-join to inputs/311fix/clusters.json.
import { readFileSync, writeFileSync } from "node:fs";
import { joinTags } from "/app/digest/dist/cluster/join.js";
const tags = JSON.parse(readFileSync("/m/inputs/311fix/cluster_tags.json", "utf8")).tags;
const ids = JSON.parse(readFileSync("/m/inputs/311/clusters.json", "utf8")).clusters.flatMap((c) => c.article_ids).toSorted((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const clusters = joinTags(ids, tags);
writeFileSync("/m/inputs/311fix/clusters.json", JSON.stringify({ clusters }, null, 2));
const where = (a) => clusters.findIndex((c) => c.article_ids.includes(a));
console.log("clusters", clusters.length, "A89 with A529:", where("A89") === where("A529"));
