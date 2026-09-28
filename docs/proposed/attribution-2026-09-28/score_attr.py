import json, sys, collections
S, TAG = sys.argv[1], sys.argv[2]
known = {("307","A8"):"backs (partly)",("307","A93"):"backs",("308","A18"):"backs",("308","A16"):"no specific",("309","A37"):"backs+contradicts"}
cells = []
for run in ["307","308","309","310"]:
    for st in json.load(open(f"{S}/backfill/{run}/attr-{TAG}-rep1.json")):
        for c in st["cells"]: cells.append({**c, "run": run, "headline": st["headline"]})
n = len(cells); miss = sum(c["verdict"]=="MISSING" for c in cells)
v = collections.Counter(c["verdict"] for c in cells)
quoted = [c for c in cells if c["verdict"] in ("states","contradicts")]
qok = sum(bool(c["quoteOk"]) for c in quoted)
if miss > n * 0.02: sys.exit(f"{TAG}: {miss}/{n} cells MISSING: harness broken, not scoring")
print(f"{TAG}: cells {n}, missing {miss}, verdicts {dict(v)}, quotes verbatim {qok}/{len(quoted)}")
# agreement with checker on 'states'
both = sum(c["checker"] and c["verdict"]=="states" for c in cells)
chk_only = [c for c in cells if c["checker"] and c["verdict"]!="states"]
attr_only = [c for c in cells if not c["checker"] and c["verdict"]=="states" and c["quoteOk"]]
print(f"checker supported_by & attr states: {both}; checker only: {len(chk_only)}; attr only (verbatim quote): {len(attr_only)}")
print("by read depth, attr-only:", collections.Counter(c["read"] for c in attr_only))
# article-level: which fully-read articles back nothing under attr
arts = collections.defaultdict(list)
for c in cells: arts[(c["run"], c["headline"], c["article"], c["read"])].append(c)
nothing = [k for k, cs in arts.items() if k[3]=="full" and not any(c["verdict"] in ("states","contradicts") and c["quoteOk"] for c in cs)]
print("fully-read articles with no verbatim-backed verdict:", [(k[0],k[2],k[1][:40]) for k in nothing])
for (run, a), label in known.items():
    cs = [c for c in cells if c["run"]==run and c["article"]==a]
    print(f"  {run} {a} [{label}]:", [(c["verdict"], c["claim"][:35], (c.get("quote") or "")[:60], c["quoteOk"]) for c in cs if c["verdict"]!="silent"])
contra = [c for c in cells if c["verdict"]=="contradicts" and c["quoteOk"]]
print(f"\ncontradicts with verbatim quote: {len(contra)}")
for c in contra: print("  ", c["run"], c["article"], "|", c["claim"][:50], "|", c["quote"][:90])
