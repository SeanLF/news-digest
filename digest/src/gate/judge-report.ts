import { selfAgreement } from "./band.js";
import { controlResult } from "./control.js";
import type { Plant } from "./plant.js";
import { parseVerdicts, type JudgeVerdict } from "./verdict.js";

type Rep = JudgeVerdict[] | null;
interface PromptfooRow {
  provider: { id: string; label?: string };
  response?: { output?: string };
}

export function repsByJudge(doc: unknown): Map<string, Rep[]> {
  const rows = (doc as { results?: { results?: PromptfooRow[] } } | null)?.results?.results;
  if (!Array.isArray(rows)) throw new Error("not a promptfoo results file (no results.results)");
  const reps = new Map<string, Rep[]>();
  for (const r of rows) {
    const name = r.provider.label ?? r.provider.id;
    let rep: Rep = null;
    try {
      rep = r.response?.output ? parseVerdicts(r.response.output) : null;
    } catch {
      rep = null;
    }
    reps.set(name, [...(reps.get(name) ?? []), rep]);
  }
  return reps;
}

interface PassRate {
  perCriterion: Record<number, number>;
  overall: number;
  mustKnow: number | null;
  briefs: number | null;
}
const rate = ([p, n]: [number, number]) => (n ? p / n : null);
function passRate(reps: JudgeVerdict[][], mustKnow: number): PassRate {
  const by: Record<number, [number, number]> = {};
  const all: [number, number] = [0, 0];
  const mk: [number, number] = [0, 0];
  const br: [number, number] = [0, 0];
  for (const rep of reps)
    for (const v of rep)
      for (const t of [(by[v.criterion] ??= [0, 0]), all, v.story < mustKnow ? mk : br]) {
        t[0] += v.pass ? 1 : 0;
        t[1] += 1;
      }
  return {
    perCriterion: Object.fromEntries(Object.entries(by).map(([k, t]) => [Number(k), rate(t) ?? 0])),
    overall: rate(all) ?? 0,
    mustKnow: rate(mk),
    briefs: rate(br),
  };
}

interface Majority {
  pass: boolean;
  votes: string;
  reason: string;
}
function majorities(reps: JudgeVerdict[][]): Map<string, Majority> {
  const cells = new Map<string, JudgeVerdict[]>();
  for (const rep of reps)
    for (const v of rep) {
      const k = `${v.story}:${v.criterion}`;
      cells.set(k, [...(cells.get(k) ?? []), v]);
    }
  const out = new Map<string, Majority>();
  for (const [k, vs] of cells) {
    const yes = vs.filter((v) => v.pass).length;
    if (yes * 2 === vs.length) continue;
    const pass = yes * 2 > vs.length;
    out.set(k, { pass, votes: `${yes}/${vs.length} pass`, reason: vs.find((v) => v.pass === pass)!.reason });
  }
  return out;
}

export interface JudgeReport {
  judges: Record<
    string,
    {
      reps: number;
      unreadable: number;
      perCriterion: Record<number, number>;
      overall: number;
      passRate: PassRate;
    }
  >;
  disagreements: { story: number; criterion: number; votes: Record<string, string>; reasons: Record<string, string> }[];
  control: Record<string, ReturnType<typeof controlResult>>;
  verdict: "pass" | "fail";
}

export function judgeReport(clean: unknown, planted: unknown, plants: Plant[], mustKnow: number): JudgeReport {
  const cleanReps = repsByJudge(clean);
  const plantedReps = repsByJudge(planted);
  const names = [...cleanReps.keys()];
  const readable = (n: string) => (cleanReps.get(n) ?? []).filter((r): r is JudgeVerdict[] => r !== null);
  const judges: JudgeReport["judges"] = {};
  for (const n of names) {
    const reps = readable(n);
    judges[n] = {
      reps: reps.length,
      unreadable: (cleanReps.get(n)?.length ?? 0) - reps.length,
      ...selfAgreement(reps),
      passRate: passRate(reps, mustKnow),
    };
  }
  const disagreements: JudgeReport["disagreements"] = [];
  const [a, b] = names;
  if (a && b) {
    const ma = majorities(readable(a));
    const mb = majorities(readable(b));
    for (const [k, x] of ma) {
      const y = mb.get(k);
      if (!y || y.pass === x.pass) continue;
      const [story, criterion] = k.split(":").map(Number) as [number, number];
      disagreements.push({
        story,
        criterion,
        votes: { [a]: x.votes, [b]: y.votes },
        reasons: { [a]: x.reason, [b]: y.reason },
      });
    }
    disagreements.sort((p, q) => p.story - q.story || p.criterion - q.criterion);
  }
  const control = Object.fromEntries(names.map((n) => [n, controlResult(plants, plantedReps.get(n) ?? [])]));
  const verdict = names.length >= 2 && Object.values(control).every((c) => c.pass) ? "pass" : "fail";
  return { judges, disagreements, control, verdict };
}
