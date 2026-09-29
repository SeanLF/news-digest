"""Step 2: Story Forest's story/event layer (arXiv:1803.00189 §4) replayed over runs 284-311.

Each run's clusters are that day's candidate events. Processing a day, largest cluster first, an
event joins the story whose recent entity set it overlaps most, if entity Jaccard >= DELTA and it
shares >= N words of primary_event/headline vocabulary with the story (the paper's title check);
else it starts a story. Inside the story it MERGES with a same-day event whose compatibility
(mean of entity Jaccard and event-word Jaccard) >= MU (a duplicate), else it EXTENDS the story (a
sidebar or a continuation). Stories carry across days; a story's matching set is its events of the
last WINDOW days. Deterministic; standard library only.

usage: python sf.py [--delta D --n N --mu M --window W] [--titles] [--shuffle SEED] [--runs A-B] [--json]
"""
import argparse, functools, json, random
from collections import Counter
from common import HERE, RUNS, load, tokens


def jac(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def cluster_features(d, use_titles):
    tags = d["tags"]
    out = []
    for k, c in enumerate(d["clusters"]["clusters"]):
        ids = c["article_ids"]
        ents = {e.lower() for a in ids for e in tags.get(a, {}).get("entities", [])}
        words = set().union(*[tokens(tags.get(a, {}).get("primary_event", "")) for a in ids]) | tokens(c.get("story", ""))
        if use_titles:
            words |= set().union(*[tokens(d["articles"].get(a, {}).get("title", "")) for a in ids])
        out.append({"k": k, "ids": ids, "ents": ents, "words": words})
    return out


def replay(runs, delta, n, mu, window, use_titles=False, shuffle=None, match="union"):
    stories = []  # {"id", "events": [(run, ents, words, node_id)]}
    node_of = {}  # (run, cluster k) -> (story id, node id)
    merges = []   # (run, k_absorbed, k_into)
    rng = random.Random(shuffle)
    by_ent = {}  # entity -> ids of stories holding it; a story sharing no entity has Jaccard 0
    for run in runs:
        feats = [dict(f) for f in _features(run, use_titles)]
        if shuffle is not None:  # negative control: tags permuted across the day's clusters
            perm = [(f["ents"], f["words"]) for f in feats]
            rng.shuffle(perm)
            for f, (e, w) in zip(feats, perm):
                f["ents"], f["words"] = e, w
        for f in sorted(feats, key=lambda f: -len(f["ids"])):
            if not f["ents"] and not f["words"]:
                continue
            best, best_j = None, 0.0
            for sid in {sid for e in f["ents"] for sid in by_ent.get(e, ())}:
                s = stories[sid]
                recent = [ev for ev in s["events"] if ev[0] > run - window]
                if not recent:
                    continue
                if match == "union":  # the paper: the story's keyword set
                    se = set().union(*[ev[1] for ev in recent])
                    sw = set().union(*[ev[2] for ev in recent])
                    j = jac(f["ents"], se)
                else:  # generous variant: the story's closest recent event
                    ev = max(recent, key=lambda ev: jac(f["ents"], ev[1]))
                    se, sw, j = ev[1], ev[2], jac(f["ents"], ev[1])
                if j >= delta and len(f["words"] & sw) >= n and j > best_j:
                    best, best_j = s, j
            if best is None:
                best = {"id": len(stories), "events": []}
                stories.append(best)
            node = None
            for ev in best["events"]:
                if ev[0] == run and (jac(f["ents"], ev[1]) + jac(f["words"], ev[2])) / 2 >= mu:
                    node = ev[3]
                    merges.append((run, f["k"], ev[4]))
                    break
            if node is None:
                node = f"{run}:{f['k']}"
            best["events"].append((run, f["ents"], f["words"], node, f["k"]))
            for e in f["ents"]:
                by_ent.setdefault(e, set()).add(best["id"])
            node_of[(run, f["k"])] = (best["id"], node)
    return stories, node_of, merges


@functools.lru_cache(maxsize=None)
def _features(run, use_titles):
    return tuple(cluster_features(_load(run), use_titles))


@functools.lru_cache(maxsize=None)
def _load(run):
    return load(run)


def story_cluster(d, ids):
    owner = {a: k for k, c in enumerate(d["clusters"]["clusters"]) for a in c["article_ids"]}
    counts = Counter(owner[a] for a in ids if a in owner)
    return counts.most_common(1)[0][0] if counts else None


def score(labels, node_of, runs):
    res = Counter()
    rows = []
    cache = {}
    for L in labels:
        if L["run"] not in runs:
            continue
        d = _load(L["run"])
        ci = story_cluster(d, d["stories"][L["i"]]["ids"])
        cj = story_cluster(d, d["stories"][L["j"]]["ids"])
        a, b = node_of.get((L["run"], ci)), node_of.get((L["run"], cj))
        same_cluster = ci == cj
        merged = same_cluster or (a and b and a[1] == b[1])
        same_story = same_cluster or (a and b and a[0] == b[0])
        res[(L["label"], "merged" if merged else "same_story" if same_story else "apart")] += 1
        rows.append({**{k: L[k] for k in ("pair", "run", "label")}, "merged": bool(merged), "same_story": bool(same_story), "same_cluster": same_cluster})
    return res, rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--delta", type=float, default=0.3)
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--mu", type=float, default=0.5)
    ap.add_argument("--window", type=int, default=3)
    ap.add_argument("--titles", action="store_true")
    ap.add_argument("--shuffle", type=int)
    ap.add_argument("--runs", default="284-311")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--match", choices=["union", "max"], default="union")
    a = ap.parse_args()
    lo, hi = map(int, a.runs.split("-"))
    runs = [r for r in RUNS if lo <= r <= hi]
    labels = json.loads((HERE / "labels.json").read_text())
    stories, node_of, merges = replay(RUNS, a.delta, a.n, a.mu, a.window, a.titles, a.shuffle, a.match)
    res, rows = score(labels, node_of, set(runs))
    sizes = sorted((len({ev[3] for ev in s["events"]}) for s in stories), reverse=True)
    days = sorted((len({ev[0] for ev in s["events"]}) for s in stories), reverse=True)
    out = {
        "params": vars(a),
        "same_event_merged": res[("SAME_EVENT", "merged")],
        "same_event_total": sum(v for (l, _), v in res.items() if l == "SAME_EVENT"),
        "sidebars": res[("SAME_SITUATION", "same_story")],
        "situation_merged": res[("SAME_SITUATION", "merged")],
        "situation_total": sum(v for (l, _), v in res.items() if l == "SAME_SITUATION"),
        "unrelated_merged": res[("UNRELATED", "merged")],
        "unrelated_same_story": res[("UNRELATED", "same_story")],
        "merges_all_clusters": sum(1 for m in merges if m[0] in runs),
        "stories": len(stories),
        "largest_stories_events": sizes[:5],
        "longest_stories_days": days[:5],
    }
    print(json.dumps(out) if a.json else json.dumps(out, indent=1))
    if not a.json:
        for r in rows:
            if r["label"] == "SAME_EVENT" or r["merged"]:
                print(r)
