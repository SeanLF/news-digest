"""Shared loading for the Story Forest PoC: one run's clusters, tags, shipped stories and articles."""
import csv, io, json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNS = list(range(284, 312))
STOP = set("the and for with from over after amid says said new more into its his her their than that this what will would could about against says over under amid as at by of on in to a an is are be was were has have had not no it".split())


def tokens(s):
    return {t for t in re.findall(r"[a-z0-9]{3,}", (s or "").lower()) if t not in STOP}


def load(run):
    d = json.loads((HERE / "inputs" / f"{run}.json").read_text())
    arts = {}
    for chunk in (d["articles_csv"] or "").split("\n--CSV--\n"):
        for r in csv.DictReader(io.StringIO(chunk)):
            if r.get("article_id"):
                arts[r["article_id"]] = r
    d["articles"] = arts
    stories = []
    for tier in ("must_know", "should_know"):
        for s in d["selections"].get(tier, []):
            stories.append({"tier": tier, "headline": s["headline"], "summary": s.get("summary", ""), "ids": [x["article_id"] for x in s["sources"]]})
    d["stories"] = stories
    return d


def story_key(run, s):
    return f"{run}:{s['headline'][:80]}"
