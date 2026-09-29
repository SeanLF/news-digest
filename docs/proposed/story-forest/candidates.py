"""Step 1: the candidate pairs of shipped stories to label, before any mechanism exists.
Same proposed thread (thread_links.json), the named tag-overlap finds, and the top 3 pairs per run
by entity Jaccard + primary_event token Jaccard over the stories' cited articles."""
import itertools, json
from common import HERE, RUNS, load, tokens

# Pairs named in the 2026-09-29 session's tag-overlap screen, kept whatever this screen ranks them.
NAMED = {311: [("Zelensky says North Korea", "Zelensky says Russia")]}
out = []
for run in RUNS:
    d = load(run)
    st, tags = d["stories"], d["tags"]
    tl = {s["label"]: s for s in (d["thread_links"] or [])}
    # thread_links.stories are in shipped order, indexed like the stories
    tls = d["thread_links"] or []
    scored = []
    for (i, a), (j, b) in itertools.combinations(enumerate(st), 2):
        ea = {e.lower() for x in a["ids"] for e in tags.get(x, {}).get("entities", [])}
        eb = {e.lower() for x in b["ids"] for e in tags.get(x, {}).get("entities", [])}
        pa = set().union(*[tokens(tags.get(x, {}).get("primary_event", "")) for x in a["ids"]]) | tokens(a["headline"])
        pb = set().union(*[tokens(tags.get(x, {}).get("primary_event", "")) for x in b["ids"]]) | tokens(b["headline"])
        s = len(ea & eb) / max(1, len(ea | eb)) + len(pa & pb) / max(1, len(pa | pb))
        same_thread = i < len(tls) and j < len(tls) and tls[i].get("proposed_thread") is not None and tls[i].get("proposed_thread") == tls[j].get("proposed_thread")
        scored.append((round(s, 3), i, j, same_thread))
    picked = {(i, j): why for s, i, j, t in scored if t for why in ["same_thread"]}
    for s, i, j, t in sorted(scored, reverse=True)[:3]:
        picked.setdefault((i, j), f"overlap_top3:{s}")
    for na, nb in NAMED.get(run, []):
        for i, a in enumerate(st):
            for j, b in enumerate(st):
                if i < j and na in a["headline"] and nb in b["headline"]:
                    picked.setdefault((i, j), "named")
    for (i, j), why in sorted(picked.items()):
        a, b = st[i], st[j]
        out.append({"run": run, "i": i, "j": j, "why": why, "a": a["headline"], "b": b["headline"]})
(HERE / "candidates.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
print(len(out), "candidate pairs over", len(RUNS), "runs")
