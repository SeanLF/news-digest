import { parse } from "csv-parse/sync";
import { SelectionsSchema } from "../contracts/selections.js";
import { ground, type Article, type GroundingReport } from "./grounding.js";
import { shownStories } from "./shown.js";

interface Row {
  article_id: string;
  source_id: string;
  title: string;
  published: string;
  summary: string;
}

export interface RunFiles {
  html: string;
  selections: string;
  csvs: string[];
  fulltext?: string | undefined;
}

export function sourceNamesFrom(catalogue: string): Map<string, string> {
  const list = JSON.parse(catalogue) as { id: string; name: string }[];
  return new Map(list.map((s) => [s.id, s.name]));
}

export function articlesFrom(
  csvs: string[],
  fulltextJson: string | undefined,
  names: ReadonlyMap<string, string>,
): Map<string, Article> {
  const fulltext = fulltextJson ? (JSON.parse(fulltextJson) as Record<string, { text?: string }>) : {};
  const articles = new Map<string, Article>();
  for (const csv of csvs)
    for (const r of parse<Row>(csv, { columns: true, skip_empty_lines: true })) {
      const text = fulltext[r.article_id]?.text;
      articles.set(r.article_id, {
        title: r.title,
        summary: r.summary,
        published: r.published,
        source: `${names.get(r.source_id) ?? ""} ${r.source_id.replaceAll("_", " ")}`,
        ...(text ? { fulltext: text } : {}),
      });
    }
  return articles;
}

export function groundFiles(files: RunFiles, names: ReadonlyMap<string, string>): GroundingReport {
  const selections = SelectionsSchema.parse(JSON.parse(files.selections));
  return ground(shownStories(files.html, selections), articlesFrom(files.csvs, files.fulltext, names));
}
