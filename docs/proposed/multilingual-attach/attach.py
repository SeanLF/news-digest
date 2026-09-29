"""The attach step over a run's archived partition, and its shuffled-vector control.

usage: python attach.py <arm> <inputs-dir> <out-dir> <run> [clusters.json override]
Writes <out>/attach_<arm>_<run>.json: every candidate (cluster of 1-2) with its best max-member
cosine against a cluster of 3+, whether it is cross-language, and the shuffled control's counts.
"""

import csv
import glob
import json
import sys

import numpy as np

LANG = {"le_monde": "fr", "clarin_mundo": "es", "der_spiegel": "de", "jeune_afrique": "fr"}  # every other source is English
TAUS = [round(0.50 + 0.05 * i, 2) for i in range(9)]


def lang(src):
    return LANG.get(src, "en")


def main():
    arm, data, out, run, *override = sys.argv[1:]
    rows = {}
    for f in sorted(glob.glob(f"{data}/{run}/articles_*.csv")):
        with open(f, newline="") as fh:
            rows.update({r["article_id"]: r for r in csv.DictReader(fh) if r.get("article_id")})
    clusters = json.load(open(override[0] if override else f"{data}/{run}/clusters.json"))["clusters"]
    vecs = np.load(f"{out}/{arm}_{run}.npy")
    ids = json.load(open(f"{out}/{arm}_{run}.ids.json"))
    at = {a: i for i, a in enumerate(ids)}

    def attaches(V):
        big = [(k, c) for k, c in enumerate(clusters) if len(c["article_ids"]) >= 3]
        big_ids = [a for _, c in big for a in c["article_ids"] if a in at]
        owner = {a: k for k, c in big for a in c["article_ids"]}
        B = V[[at[a] for a in big_ids]]
        found = []
        for k, c in enumerate(clusters):
            members = [a for a in c["article_ids"] if a in at]
            if not 1 <= len(members) <= 2:
                continue
            sims = V[[at[a] for a in members]] @ B.T  # rows: candidate members, cols: big-cluster articles
            i, j = np.unravel_index(np.argmax(sims), sims.shape)
            src, dst = members[i], big_ids[j]
            cand_langs = {lang(rows[a]["source_id"]) for a in members}
            found.append({
                "candidate": k, "candidate_story": c["story"], "members": members,
                "target": owner[dst], "target_story": clusters[owner[dst]]["story"],
                "via": [src, dst], "cosine": round(float(sims[i, j]), 4),
                "cross_language": any(l != "en" for l in cand_langs) and lang(rows[dst]["source_id"]) not in {lang(rows[src]["source_id"])},
                "titles": [rows[src]["title"], rows[dst]["title"]],
                "sources": [rows[src]["source_id"], rows[dst]["source_id"]],
            })
        return found

    real = attaches(vecs)
    rng = np.random.default_rng(311)
    # The pre-registered control permuted every article's vector; that hands candidates the vectors of
    # big-cluster members, which then find their own cluster-mates (it attaches more than the real
    # vectors). The null that answers "would an unrelated small-cluster article attach" permutes the
    # vectors among candidate articles only.
    cand = [at[a] for c in clusters if 1 <= len(c["article_ids"]) <= 2 for a in c["article_ids"] if a in at]
    within = vecs.copy()
    within[cand] = vecs[rng.permutation(cand)]
    shuffled = attaches(within)
    shuffled_all = attaches(vecs[rng.permutation(len(vecs))])
    count = lambda fs, t, x: sum(1 for f in fs if f["cosine"] >= t and (f["cross_language"] or not x))
    summary = {
        "arm": arm, "run": run, "candidates": len(real),
        "cross_language_candidates": sum(f["cross_language"] for f in real),
        "by_tau": {t: {"cross": count(real, t, True), "any": count(real, t, False), "null_cross": count(shuffled, t, True), "null_any": count(shuffled, t, False), "preregistered_shuffle_any": count(shuffled_all, t, False)} for t in TAUS},
    }
    name = f"{out}/attach_{arm}_{run}{'_' + override[0].split('/')[-1].replace('.json', '') if override else ''}.json"
    json.dump({"summary": summary, "attaches": sorted(real, key=lambda f: -f["cosine"])}, open(name, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
