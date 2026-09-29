"""Peak RSS and wall time of one 28-day replay (the chosen configuration), with a 100 MB control."""
import json, resource, sys, time
from common import HERE, RUNS
if sys.argv[1:] == ["control"]:
    blob = bytearray(100 * 1024 * 1024)
from sf import replay
cfg = json.loads((HERE / "out" / "grid.json").read_text())[0]
t = time.perf_counter()
replay(RUNS, cfg["delta"], cfg["n"], cfg["mu"], 3, cfg["titles"], None, cfg["match"])
print(json.dumps({"arm": sys.argv[1:] or ["replay"], "seconds": round(time.perf_counter() - t, 2), "peak_rss_mib": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}))
