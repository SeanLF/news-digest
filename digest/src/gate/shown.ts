import { defaultTreeAdapter as t, parse, type DefaultTreeAdapterMap } from "parse5";
import type { Selections } from "../contracts/selections.js";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export type Field = "headline" | "summary" | "why_it_matters";

export interface StoryText {
  index: number;
  fields: Partial<Record<Field, string>>;
  sources: string[];
}

const classes = (el: Element): string[] =>
  t
    .getAttrList(el)
    .find((a) => a.name === "class")
    ?.value.split(/\s+/) ?? [];

function elements(node: Node, out: Element[] = []): Element[] {
  if (t.isElementNode(node)) out.push(node);
  if ("childNodes" in node) for (const c of t.getChildNodes(node)) elements(c, out);
  return out;
}

function textOf(node: Node): string {
  if (t.isTextNode(node)) return t.getTextNodeContent(node);
  if (t.isElementNode(node) && t.getTagName(node) === "a" && classes(node).includes("anchor")) return "";
  if (!("childNodes" in node)) return "";
  return t.getChildNodes(node).map(textOf).join("").replaceAll(/\s+/g, " ").trim();
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function shownStories(html: string, selections: Pick<Selections, "must_know" | "should_know">): StoryText[] {
  const chosen = [...selections.must_know, ...selections.should_know];
  const byHeadline = new Map(chosen.map((s, i) => [key(s.headline), i]));
  const articles = elements(parse(html)).filter((e) => t.getTagName(e) === "article");
  return articles.flatMap((article, position) => {
    const inside = elements(article);
    const headline = inside.find((e) => t.getTagName(e) === "h3");
    if (!headline) return [];
    const head = textOf(headline);
    const index = byHeadline.get(key(head)) ?? position;
    const body = inside.find((e) => t.getTagName(e) === "p" && classes(e).some((c) => c === "lede" || c === "summary"));
    const why = inside.find((e) => t.getTagName(e) === "div" && classes(e).includes("why"));
    const whyText = why ? elements(why).find((e) => t.getTagName(e) === "p") : undefined;
    const fields: Partial<Record<Field, string>> = { headline: head };
    if (body) fields.summary = textOf(body);
    if (whyText) fields.why_it_matters = textOf(whyText);
    return [{ index, fields, sources: chosen[index]?.sources.map((s) => s.article_id) ?? [] }];
  });
}
