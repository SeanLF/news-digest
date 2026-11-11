import type { Selections } from "../contracts/selections.js";

export interface Plant {
  storyIndex: number;
  field: "headline" | "summary" | "why_it_matters";
  kind: "wrong-number" | "absent-specific";
  original: string;
  planted: string;
  marker: string;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const NUMBER = /\d[\d,]*/;
const FIELDS = ["headline", "summary", "why_it_matters"] as const;

export function plantDefects(draft: Selections, seed: number, n: number): { draft: Selections; plants: Plant[] } {
  const next = rng(seed);
  const out: Selections = structuredClone(draft);
  const plants: Plant[] = [];
  const cells = out.must_know.length * FIELDS.length;
  if (n > cells) throw new Error(`asked for ${n} plants but the draft has ${cells} must_know fields`);
  while (plants.length < n) {
    const i = Math.floor(next() * out.must_know.length);
    const story = out.must_know[i];
    if (!story) continue;
    const field = FIELDS[Math.floor(next() * FIELDS.length)]!;
    if (plants.some((p) => p.storyIndex === i && p.field === field)) continue;
    const original = story[field];
    const m = NUMBER.exec(original);
    let planted: string;
    let kind: Plant["kind"];
    let marker: string;
    if (m) {
      marker = String(Number(m[0].replaceAll(",", "")) * 2 + 1);
      planted = original.replace(NUMBER, marker);
      kind = "wrong-number";
    } else {
      marker = "Geneva";
      planted = `${original} The measure was announced in ${marker}.`;
      kind = "absent-specific";
    }
    story[field] = planted;
    plants.push({ storyIndex: i, field, kind, original, planted, marker });
  }
  return { draft: out, plants };
}
