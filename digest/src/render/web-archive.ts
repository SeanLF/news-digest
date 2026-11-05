import { defaultTreeAdapter as t, parse, serialize, type DefaultTreeAdapterMap } from "parse5";

type ParentNode = DefaultTreeAdapterMap["parentNode"];
const STRIPPED = new Set(["email-only", "preheader"]);

function strip(parent: ParentNode): void {
  for (const node of t.getChildNodes(parent).slice()) {
    if (t.isCommentNode(node)) {
      if (t.getCommentNodeContent(node).includes("[if mso")) t.detachNode(node);
    } else if (t.isElementNode(node)) {
      const cls =
        t
          .getAttrList(node)
          .find((a) => a.name === "class")
          ?.value.split(/\s+/) ?? [];
      if (cls.some((c) => STRIPPED.has(c))) t.detachNode(node);
      else strip("content" in node ? node.content : node);
    }
  }
}

export function webArchiveHtml(html: string): string {
  const doc = parse(html);
  strip(doc);
  return serialize(doc);
}
