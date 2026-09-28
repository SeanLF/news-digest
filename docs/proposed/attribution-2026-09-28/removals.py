import json, sys, os
S = sys.argv[1]
REPS = sys.argv[2].split(",") if len(sys.argv) > 2 else ["1", "2"]
TR = "\n[truncated]"
out = []
for run in ["307", "308", "309", "310"]:
    d = f"{S}/backfill/{run}"
    draft = json.load(open(f"{d}/draft_selections.json"))
    ft = json.load(open(f"{d}/article_fulltext.json"))
    reps = [json.load(open(f"{d}/rep{i}.json"))["results"] for i in REPS]
    def read(a):
        t = (ft.get(a) or {}).get("text")
        return "summary" if not t else "truncated" if t.endswith(TR) else "full"
    for tier in ("must_know", "should_know"):
        for st in draft[tier]:
            ids = [s["article_id"] for s in st["sources"]]
            key = sorted(set(ids))
            per = []
            for res in reps:
                m = [r for r in res if sorted(set(r["article_ids"])) == key] or [r for r in res if r["headline"].strip() == st["headline"].strip()]
                claims = [c for r in m for c in r.get("claims", [])]
                if tier == "should_know": claims = [c for c in claims if c["field"] != "why_it_matters"]
                backed = {a for c in claims for a in c["supported_by"]}
                if not claims or not (backed & set(ids)): per.append(None); continue
                per.append({a for a in ids if read(a) == "full" and a not in backed})
            out.append({"run": run, "tier": tier, "headline": st["headline"], "n": len(ids),
                        "full": sum(read(a) == "full" for a in ids),
                        "r1": sorted(per[0]) if per[0] is not None else None,
                        "r2": sorted(per[1]) if per[1] is not None else None})

cand = both = only = cited = full = 0
for o in out:
    cited += o["n"]; full += o["full"]
    a, b = set(o["r1"] or []), set(o["r2"] or [])
    cand += len(a | b); both += len(a & b); only += len(a ^ b)
    if a or b: print(o["run"], o["tier"][:4], o["headline"][:60], "| both:", sorted(a & b), "one:", sorted(a ^ b))
skipped = [(o["run"], o["headline"][:50]) for o in out if o["r1"] is None or o["r2"] is None]
print(f"\nstories {len(out)}, cited {cited}, read in full {full}")
print(f"removal candidates {cand}: both reps {both}, one rep only {only}")
print("guard skipped (no claims or nothing backed):", skipped)
