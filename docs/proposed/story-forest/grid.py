"""Choose (delta, n, mu, match, titles) on runs 284-297; report the choice on 298-311.
Objective, fixed before running: same-event pairs merged minus every merge of a labelled
non-duplicate (SAME_SITUATION or UNRELATED), ties to more sidebars."""
import itertools, json
from common import HERE, RUNS
from sf import replay, score

labels = json.loads((HERE / "labels.json").read_text())
tune, held = {r for r in RUNS if r <= 297}, {r for r in RUNS if r >= 298}


def summary(res):
    return {"dup_merged": res[("SAME_EVENT", "merged")], "dup_total": sum(v for (l, _), v in res.items() if l == "SAME_EVENT"),
            "sidebars": res[("SAME_SITUATION", "same_story")], "situation_merged": res[("SAME_SITUATION", "merged")],
            "unrelated_merged": res[("UNRELATED", "merged")], "unrelated_same_story": res[("UNRELATED", "same_story")]}


rows = []
for delta, n, mu, match, titles in itertools.product([0.05, 0.1, 0.15, 0.2, 0.3], [1, 2, 4], [0.05, 0.08, 0.12, 0.2], ["union", "max"], [False, True]):
    _, node_of, merges = replay(RUNS, delta, n, mu, 3, titles, None, match)
    t, _ = score(labels, node_of, tune)
    h, _ = score(labels, node_of, held)
    st, sh = summary(t), summary(h)
    obj = st["dup_merged"] - st["situation_merged"] - st["unrelated_merged"]
    rows.append({"delta": delta, "n": n, "mu": mu, "match": match, "titles": titles, "obj": obj, "tune": st, "held": sh,
                 "merges_tune": sum(1 for m in merges if m[0] in tune), "merges_held": sum(1 for m in merges if m[0] in held)})
rows.sort(key=lambda r: (-r["obj"], -r["tune"]["sidebars"], r["merges_tune"]))
(HERE / "out").mkdir(exist_ok=True)
(HERE / "out" / "grid.json").write_text(json.dumps(rows, indent=1))
for r in rows[:8]:
    print(json.dumps(r))
best_dup = max(rows, key=lambda r: r["tune"]["dup_merged"] + r["held"]["dup_merged"])
print("most duplicates merged anywhere in the grid:", json.dumps(best_dup))
