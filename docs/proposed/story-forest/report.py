"""The chosen configuration in full, its negative control, story sizes, and the thread-first comparison."""
import json
from collections import Counter
from common import HERE, RUNS
from sf import replay, score, _load, story_cluster

labels = json.loads((HERE / "labels.json").read_text())
grid = json.loads((HERE / "out" / "grid.json").read_text())
chosen = grid[0]
perm = max(grid, key=lambda r: r["tune"]["dup_merged"] + r["held"]["dup_merged"])
out = {"chosen": chosen, "most_permissive": perm}
for name, cfg in (("chosen", chosen), ("most_permissive", perm)):
    args = (RUNS, cfg["delta"], cfg["n"], cfg["mu"], 3, cfg["titles"])
    stories, node_of, merges = replay(*args, None, cfg["match"])
    res, rows = score(labels, node_of, set(RUNS))
    out[name + "_merged_pairs"] = [r for r in rows if r["merged"]]
    shuf = Counter()
    for seed in range(5):
        _, n2, _ = replay(*args, seed, cfg["match"])
        r2, _ = score(labels, n2, set(RUNS))
        shuf[seed] = r2[("SAME_EVENT", "merged")]
    out[name + "_shuffled_dup_merged_5_seeds"] = list(shuf.values())
    sizes = sorted(((len({ev[3] for ev in s["events"]}), len({ev[0] for ev in s["events"]}), s["id"]) for s in stories), reverse=True)
    top = []
    for ev_n, days, sid in sizes[:3]:
        s = stories[sid]
        run, k = s["events"][0][0], s["events"][0][4]
        top.append({"events": ev_n, "days": days, "first_label": _load(run)["clusters"]["clusters"][k]["story"]})
    out[name + "_largest_stories"] = top
    # how many of one day's shipped stories share a story tree, at most
    worst = 0
    for run in RUNS:
        d = _load(run)
        sids = Counter(node_of.get((run, story_cluster(d, s["ids"])), (None,))[0] for s in d["stories"])
        sids.pop(None, None)
        worst = max(worst, max(sids.values(), default=0))
    out[name + "_max_shipped_stories_in_one_tree"] = worst
tf = Counter((L["label"], L["why"] == "same_thread") for L in labels)
out["thread_first"] = {f"{l}{' same_thread' if t else ''}": v for (l, t), v in sorted(tf.items())}
(HERE / "out" / "report.json").write_text(json.dumps(out, indent=1))
print(json.dumps({k: v for k, v in out.items() if k not in ("chosen", "most_permissive")}, indent=1))
