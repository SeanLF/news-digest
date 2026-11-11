import { appendFileSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ledgerLine } from "../gate/ledger.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    eval: { type: "string" },
    config: { type: "string" },
    sha: { type: "string" },
    verdict: { type: "string" },
    note: { type: "string" },
    out: { type: "string", default: "../evals/results/ledger.jsonl" },
  },
});
if (!values.eval || !values.config || !values.sha || !positionals.length) {
  console.error(
    "usage: ledger --eval NAME --config FILE --sha SHA [--verdict V] [--note TEXT] [--out FILE] results.json...",
  );
  process.exit(2);
}
const docs = positionals.map((f): unknown => JSON.parse(readFileSync(f, "utf8")));
const line = ledgerLine(docs, {
  eval: values.eval,
  config: values.config,
  sha: values.sha,
  ...(values.verdict ? { verdict: values.verdict } : {}),
  ...(values.note ? { note: values.note } : {}),
});
appendFileSync(values.out, line);
process.stdout.write(`ledger: ${line}`);
