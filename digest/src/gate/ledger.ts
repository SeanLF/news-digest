interface PromptfooResults {
  results?: {
    timestamp?: string;
    stats?: { failures?: number; errors?: number };
    results?: { cost?: number }[];
  };
}

export interface LedgerMeta {
  eval: string;
  config: string;
  sha: string;
  verdict?: string;
  note?: string;
}

export function ledgerLine(docs: unknown[], meta: LedgerMeta): string {
  let cost = 0;
  let calls = 0;
  let failed = false;
  let when: string | undefined;
  for (const doc of docs) {
    const r = (doc as PromptfooResults | null)?.results;
    if (!r || !Array.isArray(r.results)) throw new Error("not a promptfoo results file (no results.results)");
    when ??= r.timestamp;
    failed ||= (r.stats?.failures ?? 0) + (r.stats?.errors ?? 0) > 0;
    for (const row of r.results) {
      cost += row.cost ?? 0;
      calls += 1;
    }
  }
  const date = new Date(when ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const line = {
    date,
    sha: meta.sha,
    eval: meta.eval,
    config: meta.config,
    verdict: meta.verdict ?? (failed ? "fail" : "pass"),
    cost_usd: Math.round(cost * 100) / 100,
    calls,
    ...(meta.note ? { note: meta.note } : {}),
  };
  return `${JSON.stringify(line)}\n`;
}
