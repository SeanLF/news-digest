"""A reading sheet for labelling: each candidate pair with both stories' summaries and cited articles."""
import json
from common import HERE, load

cands = json.loads((HERE / "candidates.json").read_text())
cache = {}
lines = []
for n, c in enumerate(cands):
    d = cache.setdefault(c["run"], load(c["run"]))
    lines.append(f"### P{n} run {c['run']} ({c['why']})")
    for k in ("i", "j"):
        s = d["stories"][c[k]]
        lines.append(f"[{k}] {s['tier']}: {s['headline']}\n    {s['summary'][:420]}")
        for a in s["ids"][:6]:
            r = d["articles"].get(a, {})
            lines.append(f"      - {r.get('source_id','?')}: {r.get('title','?')[:110]}")
    lines.append("")
(HERE / "sheet.txt").write_text("\n".join(lines))
print(len(cands))
