"""Pairwise cluster similarities for the labelled pairs: the range a threshold has to sit in."""
import json
from common import HERE, load
from sf import cluster_features, jac, story_cluster

labels = json.loads((HERE / "labels.json").read_text())
cache = {}
for L in labels:
    if L["label"] == "UNRELATED" and L["why"] != "same_thread":
        continue
    d = cache.setdefault(L["run"], (load(L["run"]),))[0]
    f = cluster_features(d, False)
    ci, cj = story_cluster(d, d["stories"][L["i"]]["ids"]), story_cluster(d, d["stories"][L["j"]]["ids"])
    a, b = f[ci], f[cj]
    print(f'{L["label"]:15} P{L["pair"]:<3} run {L["run"]} ent_j={jac(a["ents"], b["ents"]):.2f} words_j={jac(a["words"], b["words"]):.2f} shared_words={len(a["words"] & b["words"])} sizes={len(a["ids"])},{len(b["ids"])}')
