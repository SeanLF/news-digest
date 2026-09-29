"""Embed every article of each run with one model; report time and peak memory.

usage: python embed.py <arm> <models-dir> <inputs-dir> <out-dir> <run>...
arms: minilm (ONNX int8), minilm_lean (same, memory-lean session options), static1024 (fp32 table), static256 (256-d fp16 table, derived by prep_static),
      control (allocates 200 MB and embeds nothing: the memory instrument must see it)
Peak memory is the container cgroup's memory.peak (what --memory caps) and this process's ru_maxrss.
"""

import csv
import glob
import html
import json
import os
import re
import resource
import sys
import time

import numpy as np
from tokenizers import Tokenizer

SUMMARY_CAP = 300  # digest/src/activities/cluster.ts
URL = re.compile(r"https?://\S+")


def text(row):
    clean = lambda s: URL.sub("", html.unescape(s or "").replace("\n", " ").replace("\t", " ")).strip()
    return f"{clean(row['title'])}. {clean(row['summary'])[:SUMMARY_CAP]}"


def articles(run_dir):
    rows = []
    for f in sorted(glob.glob(f"{run_dir}/articles_*.csv")):
        with open(f, newline="") as fh:
            rows += [r for r in csv.DictReader(fh) if r.get("article_id")]
    return rows


def peak():
    try:
        cg = int(open("/sys/fs/cgroup/memory.peak").read()) / 2**20
    except OSError:
        cg = float("nan")
    return cg, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


class MiniLM:
    def __init__(self, d, lean=False):
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.intra_op_num_threads = 2  # the box has 2 vCPUs
        if lean:  # the memory-lean settings: no graph rewrite, no arena
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
            so.enable_cpu_mem_arena = False
            so.enable_mem_pattern = False
        self.batch = 8 if lean else 32
        self.s = ort.InferenceSession(f"{d}/minilm/model_qint8_avx512.onnx", so, providers=["CPUExecutionProvider"])
        self.tok = Tokenizer.from_file(f"{d}/minilm/tokenizer.json")
        self.tok.enable_truncation(128)
        self.tok.enable_padding()
        self.inputs = {i.name for i in self.s.get_inputs()}

    def __call__(self, texts):
        batch = self.batch
        out = []
        for i in range(0, len(texts), batch):
            enc = self.tok.encode_batch(texts[i : i + batch])
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feed = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.inputs:
                feed["token_type_ids"] = np.zeros_like(ids)
            h = self.s.run(None, feed)[0]
            m = mask[..., None].astype(np.float32)
            out.append((h * m).sum(1) / np.clip(m.sum(1), 1e-9, None))
        return np.concatenate(out)


def read_safetensors(path):
    with open(path, "rb") as fh:
        n = int.from_bytes(fh.read(8), "little")
        header = json.loads(fh.read(n))
        (name, meta), = [(k, v) for k, v in header.items() if k != "__metadata__"]
        assert meta["dtype"] == "F32", meta["dtype"]
        a, b = meta["data_offsets"]
        fh.seek(8 + n + a)
        return np.frombuffer(fh.read(b - a), dtype=np.float32).reshape(meta["shape"])


class Static:
    def __init__(self, d, dims):
        self.tok = Tokenizer.from_file(f"{d}/static/tokenizer.json")
        self.tok.no_padding()
        self.tok.no_truncation()
        if dims == 256:
            self.table = np.load(f"{d}/static/table256_fp16.npy", mmap_mode="r")
        else:
            self.table = read_safetensors(f"{d}/static/model.safetensors")

    def __call__(self, texts):
        out = np.zeros((len(texts), self.table.shape[1]), dtype=np.float32)
        for i, e in enumerate(self.tok.encode_batch(texts)):
            if e.ids:
                out[i] = np.asarray(self.table[e.ids], dtype=np.float32).mean(0)
        return out


def prep_static(d):
    """The table that would ship: the first 256 Matryoshka dims, fp16."""
    t = read_safetensors(f"{d}/static/model.safetensors")
    np.save(f"{d}/static/table256_fp16.npy", np.ascontiguousarray(t[:, :256]).astype(np.float16))
    print("table", t.shape, "->", (t.shape[0], 256), "fp16", os.path.getsize(f"{d}/static/table256_fp16.npy") / 2**20, "MiB")


def main():
    arm, models, data, out, *runs = sys.argv[1:]
    if arm == "prep":
        return prep_static(models)
    t0 = time.perf_counter()
    base = peak()
    if arm == "control":
        blob = np.ones(200 * 2**20 // 8)  # 200 MiB, touched
        cg, rss = peak()
        print(json.dumps({"arm": arm, "baseline_rss_mib": round(base[1], 1), "cgroup_peak_mib": round(cg, 1), "rss_mib": round(rss, 1), "blob_mib": blob.nbytes / 2**20}))
        return
    model = MiniLM(models, lean=arm == "minilm_lean") if arm.startswith("minilm") else Static(models, 256 if arm == "static256" else 1024)
    load_s = time.perf_counter() - t0
    n = 0
    t1 = time.perf_counter()
    for run in runs:
        rows = articles(f"{data}/{run}")
        v = model([text(r) for r in rows])
        v /= np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-9, None)
        np.save(f"{out}/{arm}_{run}.npy", v.astype(np.float32))
        with open(f"{out}/{arm}_{run}.ids.json", "w") as fh:
            json.dump([r["article_id"] for r in rows], fh)
        n += len(rows)
    embed_s = time.perf_counter() - t1
    cg, rss = peak()
    print(json.dumps({"arm": arm, "articles": n, "runs": len(runs), "load_s": round(load_s, 2), "ms_per_article": round(1000 * embed_s / n, 2), "cgroup_peak_mib": round(cg, 1), "rss_mib": round(rss, 1), "baseline_rss_mib": round(base[1], 1)}))


if __name__ == "__main__":
    main()
