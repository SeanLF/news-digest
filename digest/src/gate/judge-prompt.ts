import { readFileSync } from "node:fs";
import { assertNoUrls, scrubUrls } from "../contracts/ids.js";

const RUBRIC = readFileSync(new URL("../../gate/rubric.md", import.meta.url), "utf8");

export function stripUrls(html: string): string {
  return scrubUrls(html.replace(/\s(href|src|action)=("[^"]*"|'[^']*')/gi, ""));
}

export default function judgePrompt({ vars }: { vars: { digest: string } }): string {
  const prompt = `${RUBRIC}\n\nThe day's article CSVs are in your working directory.\n\n## The digest\n\n${stripUrls(vars.digest)}`;
  assertNoUrls(prompt);
  return prompt;
}
