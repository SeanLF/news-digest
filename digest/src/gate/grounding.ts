import { mentions } from "./control.js";
import type { Plant } from "./plant.js";
import type { Field, StoryText } from "./shown.js";

export const FIELDS: readonly Field[] = ["headline", "summary", "why_it_matters"];

export interface Article {
  title: string;
  summary: string;
  source?: string;
  published?: string;
  fulltext?: string;
}

export type Specific =
  | {
      kind: "number";
      text: string;
      value: number;
      percent: boolean;
      approx: boolean;
      tolerance: number;
      strong: boolean;
      context: string[];
    }
  | { kind: "date"; text: string; month: number; day: number }
  | { kind: "name"; text: string; tokens: string[] };

export interface Unsupported {
  story: number;
  field: Field;
  specific: string;
  kind: Specific["kind"];
}

export interface GroundingReport {
  stories: number;
  checked: number;
  unsupported: Unsupported[];
  namesUnchecked: { story: number; names: number }[];
}

const ENGLISH = new Set("the and of to in that is was for on with said by from has have".split(" "));
export const ENGLISH_MIN_SHARE = 0.08;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const DATE_MD = new RegExp(
  String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|and|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?(?!\d|[.,]\d)\b`,
  "g",
);
const FOREIGN_MONTHS = [
  "januar janvier enero",
  "februar fevrier febrero",
  "marz mars marzo",
  "avril abril",
  "mai mayo",
  "juni juin junio",
  "juli juillet julio",
  "aout agosto",
  "septembre septiembre",
  "oktober octobre octubre",
  "novembre noviembre",
  "dezember decembre diciembre",
].map((names) => names.split(" "));
const DATE_DM = new RegExp(
  String.raw`(?<![\d.])(\d{1,2})(?:st|nd|rd|th|\.)?(?:\s*(?:-|and|und|et|y|to)\s*(\d{1,2})(?:st|nd|rd|th|\.)?)?\s+(?:de\s+)?(${MONTH.slice(1, -4)}|${FOREIGN_MONTHS.flat().join("|")}|märz|février|août|décembre)(?![\p{L}])\.?`,
  "giu",
);

const WORD_NUMBERS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};
const SCALES: Record<string, number> = {
  bn: 1e9,
  billion: 1e9,
  mrd: 1e9,
  milliarden: 1e9,
  milliards: 1e9,
  tn: 1e12,
  trillion: 1e12,
  m: 1e6,
  mn: 1e6,
  million: 1e6,
  millionen: 1e6,
  mio: 1e6,
  millions: 1e6,
  k: 1e3,
  thousand: 1e3,
  hundred: 100,
};
const APPROX =
  /(?:about|around|nearly|almost|roughly|some|over|more than|less than|fewer than|under|at least|up to|approximately|close to|just over|just under|estimated|an estimated|upwards of)\s*$/i;
const NUMBER = new RegExp(
  String.raw`(?<![\w.,])(?:(?:US|C|A|HK|NZ)?[$€£¥]\s?)?(\d+(?:\.\d+)?|${Object.keys(WORD_NUMBERS).join("|")})(?:[\s-]?(${Object.keys(SCALES).join("|")})(?![\w]))?(?:\s?(%))?(?![\w]|[.,]\d)`,
  "gi",
);
const NOUN_STOP = new Set(
  "a an the of in on at to for and or but by from with as per than that this those these its their his her our who which is are was were has have had be been more most less fewer new other people's".split(
    " ",
  ),
);

const FUNCTION_WORDS = new Set(
  `the a an in on at to for of and or but by from with as after before while if when where why how what which who whom whose this that these those it its his her their our we they he she i you some most many several both neither either each every all any no not more less few other such since until unless though although because so yet also only just even still however meanwhile instead then there here than about over under between among against during without within across into onto upon per via despite amid amidst nearly almost around roughly once now today yesterday tomorrow later earlier first last next new former ex one two three four five six seven eight nine ten`.split(
    /\s+/,
  ),
);
const TITLES = new Set(
  "president prime minister foreign secretary chancellor king queen prince princess mr mrs ms dr sir general gen senator sen rep chief leader speaker governor mayor chairman chairwoman chair ceo defence defense finance interior federal deputy vice ambassador envoy pm commissioner justice judge pope archbishop lord lady state economy trade health".split(
    " ",
  ),
);
const CONNECTORS = new Set([
  "of",
  "de",
  "del",
  "der",
  "da",
  "di",
  "du",
  "la",
  "le",
  "al",
  "el",
  "bin",
  "van",
  "von",
  "the",
  "for",
  "on",
]);
const ALIASES: string[][] = [
  ["french", "france"],
  ["british", "britain", "uk", "briton", "britons", "england", "english"],
  ["dutch", "netherlands", "holland"],
  ["swiss", "switzerland"],
  ["spanish", "spain", "spaniard"],
  ["danish", "denmark", "dane"],
  ["polish", "poland", "pole", "poles"],
  ["finnish", "finland", "finn"],
  ["welsh", "wales"],
  ["irish", "ireland"],
  ["greek", "greece"],
  ["thai", "thailand"],
  ["filipino", "philippines", "philippine"],
  ["us", "usa", "american", "america", "americans", "washington"],
  ["eu", "european"],
  ["un", "united nations"],
  ["emirati", "uae", "emirates"],
  ["turkish", "turkey", "turkiye", "turk", "turks"],
  ["kiev", "kyiv"],
  ["gaza", "gazan", "gazans"],
  ["ai", "artificial intelligence", "intelligence artificielle", "inteligencia artificial", "kunstliche intelligenz"],
  ["monday", "montag", "lundi", "lunes"],
  ["tuesday", "dienstag", "mardi", "martes"],
  ["wednesday", "mittwoch", "mercredi", "miercoles"],
  ["thursday", "donnerstag", "jeudi", "jueves"],
  ["friday", "freitag", "vendredi", "viernes"],
  ["saturday", "samstag", "samedi", "sabado"],
  ["sunday", "sonntag", "dimanche", "domingo"],
];
const ORDINALS: Record<string, number> = {
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};
const DEMONYM = /(?:ian|ean|ese|ish|an|i)$/;

const fold = (s: string): string => s.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase();

const NUMBER_HYPHEN = new RegExp(
  String.raw`(?<=(?<![\p{L}\p{N}])(?:\d+|${Object.keys(WORD_NUMBERS).join("|")}))-(?=\p{L})`,
  "giu",
);

export function normalise(text: string): string {
  return text
    .replaceAll(/[‘’ʼ]/g, "'")
    .replaceAll(/[“”„]/g, '"')
    .replaceAll(/[–—]/g, " - ")
    .replaceAll(/ | /g, " ")
    .replaceAll(/percentage[ -]points?/gi, "points")
    .replaceAll(/\s?(?:per ?cent|percent|prozent|pourcent|por ciento)\b/gi, "%")
    .replaceAll(/(?<![\p{L}\p{N}])((?:\p{Lu}\.){2,})/gu, (m) => m.replaceAll(".", ""))
    .replaceAll(/(?<=\d),(?=\d{3}(?!\d))/g, "")
    .replaceAll(
      /(?<![\d.])(\d{1,3})((?:\.\d{3})+)(?![\d.,]\d|\d)/g,
      (_, a: string, b: string) => a + b.replaceAll(".", ""),
    )
    .replaceAll(/(?<=\d),(?=\d{1,2}(?!\d))/g, ".")
    .replaceAll(NUMBER_HYPHEN, " ");
}

function decimals(s: string): number {
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

function root(word: string): string {
  return stem(word).slice(0, 6);
}

function stem(word: string): string {
  const w = fold(word);
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

function context(after: string): string[] {
  const clause = after.slice(0, after.search(/[.,;:!?()"]|$/));
  return clause
    .split(/\s+/)
    .map((w) =>
      fold(w)
        .replace(/[^\p{L}'-]+/gu, "")
        .replace(/'s$/, ""),
    )
    .filter((w) => w && !NOUN_STOP.has(w) && !FUNCTION_WORDS.has(w))
    .slice(0, 3)
    .flatMap((w) => [w, ...w.split("-").filter(Boolean)])
    .map(root);
}

interface Found {
  value: number;
  percent: boolean;
  context: ReadonlySet<string>;
}

function sentenceWords(sentence: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(sentence).split(/[^\p{L}'-]+/u)) {
    const clean = w.replace(/'s$/, "").replaceAll("'", "");
    if (!clean) continue;
    out.add(root(clean));
    for (const part of clean.split("-")) if (part) out.add(root(part));
  }
  return out;
}

function maskDates(text: string, onDate: (month: number, day: number, raw: string) => void): string {
  const replace = (m: string, monthName: string | undefined, day: string | undefined, other?: string): string => {
    const name = fold(monthName ?? "");
    const foreign = FOREIGN_MONTHS.findIndex((names) => names.includes(name));
    const mi = foreign >= 0 ? foreign : MONTHS.indexOf(name.slice(0, 3));
    const d = Number(day);
    if (mi >= 0 && d >= 1 && d <= 31) onDate(mi + 1, d, m);
    const d2 = Number(other);
    if (mi >= 0 && d2 >= 1 && d2 <= 31) onDate(mi + 1, d2, m);
    return " ".repeat(m.length);
  };
  return text
    .replaceAll(DATE_MD, (m, mon: string, day: string, other?: string) => replace(m, mon, day, other))
    .replaceAll(DATE_DM, (m, day: string, other: string | undefined, mon: string) => replace(m, mon, day, other));
}

function isStrong(
  value: number,
  raw: string,
  percent: boolean,
  scale: number,
  isWord: boolean,
  currency: boolean,
): boolean {
  if (isWord) return false;
  if (percent || currency || scale >= 1e3 || decimals(raw) > 0) return true;
  if (value < 13) return false;
  return value % 10 !== 0 || value > 1000;
}

export function numbersIn(text: string): Specific[] {
  const out: Specific[] = [];
  const masked = maskDates(normalise(text), (month, day, raw) =>
    out.push({ kind: "date", text: raw.trim(), month, day }),
  );
  for (const m of masked.matchAll(NUMBER)) {
    const raw = m[1]!;
    const isWord = !/\d/.test(raw);
    const scale = m[2] ? SCALES[m[2].toLowerCase()]! : 1;
    const label = /([\p{Lu}][\p{L}&]*)\s$/u.exec(masked.slice(Math.max(0, m.index - 30), m.index));
    if (label && !/^[$€£¥]/.test(m[0]) && !MONTHS.includes(fold(label[1]!).slice(0, 3))) continue;
    const base = isWord ? WORD_NUMBERS[raw.toLowerCase()]! : Number(raw);
    const value = base * scale;
    const percent = m[3] !== undefined && !/^\s*points?\b/i.test(masked.slice(m.index + m[0].length));
    const before = masked.slice(Math.max(0, m.index - 20), m.index);
    const approx = APPROX.test(before);
    const unit = isWord ? 1 : 10 ** -decimals(raw);
    const tolerance = approx ? Math.max(value * 0.1, (unit * scale) / 2) : (unit * scale) / 2;
    const after = masked.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const strong = isStrong(value, raw, percent, scale, isWord, /[$€£¥]/.test(m[0]));
    const words = strong ? [] : context(after);
    out.push({
      kind: "number",
      text: words.length ? phrase(m[0], after, words[0]!) : m[0].trim(),
      value,
      percent,
      approx,
      tolerance,
      strong,
      context: words,
    });
  }
  return out;
}

function phrase(num: string, after: string, noun: string): string {
  const words: string[] = [];
  for (const w of after.split(/\s+/).filter(Boolean).slice(0, 3)) {
    words.push(w.replace(/[^\p{L}\p{N}'-]+$/u, ""));
    if (
      root(
        fold(w)
          .replace(/[^\p{L}'-]+/gu, "")
          .replace(/'s$/, ""),
      ) === noun
    )
      break;
  }
  return `${num.trim()} ${words.join(" ")}`.trim();
}

const NAME_TOKEN = /(?:\p{Lu}\.){2,}|\p{Lu}[\p{L}\p{M}'-]*/uy;

export function namesIn(text: string, common: ReadonlySet<string> = new Set()): Specific[] {
  const out: Specific[] = [];
  const t = maskDates(normalise(text), () => undefined);
  const words = [...t.matchAll(/(?:\p{Lu}\.){2,}|[\p{L}\p{M}][\p{L}\p{M}'-]*|[^\s\p{L}\p{M}]+/gu)];
  let run: { raw: string; initial: boolean }[] = [];
  let pendingConnectors: string[] = [];
  const flush = () => {
    const first = run[0];
    if (first && (FUNCTION_WORDS.has(fold(first.raw)) || (first.initial && common.has(fold(first.raw))))) run.shift();
    while (run[0] && CONNECTORS.has(fold(run[0].raw))) run.shift();
    const tokens = run.map((r) => r.raw);
    if (tokens.length) {
      const content = tokens.filter((w) => !TITLES.has(fold(w)) && !CONNECTORS.has(fold(w)));
      if (content.length) out.push({ kind: "name", text: tokens.join(" "), tokens: content });
    }
    run = [];
    pendingConnectors = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]![0];
    const idx = words[i]!.index;
    NAME_TOKEN.lastIndex = 0;
    const isCap = /^\p{Lu}/u.test(w) && NAME_TOKEN.test(w);
    if (isCap) {
      const prev = t.slice(0, idx).trimEnd();
      const initial = prev === "" || /[.!?:;"(]$/.test(prev) || /(?:^|\s)-$/.test(prev);
      const clean = w.replace(/'s?$/, "");
      if (run.length && pendingConnectors.length)
        run.push(...pendingConnectors.map((c) => ({ raw: c, initial: false })));
      pendingConnectors = [];
      run.push({ raw: clean, initial: initial && run.length === 0 });
      if (clean !== w) flush();
      continue;
    }
    if (run.length && CONNECTORS.has(w) && pendingConnectors.length < 2) {
      pendingConnectors.push(w);
      continue;
    }
    flush();
  }
  flush();
  return out;
}

export function specificsIn(text: string, common: ReadonlySet<string> = new Set()): Specific[] {
  return [...numbersIn(text), ...namesIn(text, common)];
}

export class Corpus {
  readonly text: string;
  private readonly words = new Set<string>();
  private readonly prefixes = new Set<string>();
  private readonly initials = new Set<string>();
  private readonly numbers: Found[] = [];
  private readonly dates = new Set<string>();

  readonly english: boolean;

  constructor(parts: string[]) {
    this.text = normalise(parts.join("\n"));
    const folded = fold(this.text);
    let tokens = 0;
    let english = 0;
    for (const w of folded.split(/[^\p{L}\p{N}]+/u)) {
      if (!w) continue;
      if (/\p{L}/u.test(w)) tokens++;
      if (ENGLISH.has(w)) english++;
      this.words.add(w);
      for (let k = 4; k <= Math.min(w.length, 14); k++) this.prefixes.add(w.slice(0, k));
    }
    this.english = tokens > 0 && english / tokens >= ENGLISH_MIN_SHARE;
    for (const run of this.text.matchAll(/(?:\p{Lu}[\p{L}'-]*(?:\s+(?:of|the|and|for|de)\s+|\s+)?){2,}/gu)) {
      const caps = run[0]
        .split(/\s+/)
        .filter((w) => /^\p{Lu}/u.test(w))
        .map((w) => w[0]!.toLowerCase())
        .join("");
      for (let a = 0; a < caps.length; a++)
        for (let b = a + 2; b <= caps.length; b++) this.initials.add(caps.slice(a, b));
    }
    const masked = maskDates(this.text, (month, day) => this.dates.add(`${month}-${day}`));
    const ordinal = new RegExp(String.raw`\b(${Object.keys(ORDINALS).join("|")})\b`, "gi");
    for (const sentence of masked.split(/(?<=[.!?])\s+|\n+/)) {
      const words = sentenceWords(sentence);
      for (const m of sentence.matchAll(NUMBER)) {
        const raw = m[1]!;
        const isWord = !/\d/.test(raw);
        const scale = m[2] ? SCALES[m[2].toLowerCase()]! : 1;
        const value = (isWord ? WORD_NUMBERS[raw.toLowerCase()]! : Number(raw)) * scale;
        this.numbers.push({ value, percent: m[3] !== undefined, context: words });
      }
      for (const m of sentence.matchAll(ordinal))
        this.numbers.push({ value: ORDINALS[m[1]!.toLowerCase()]!, percent: false, context: words });
    }
  }

  private hasToken(token: string): boolean {
    const raw = token.replaceAll(".", "");
    const t = fold(raw).replace(/'s?$/, "");
    if (this.words.has(t)) return true;
    const parts = t.split(/[-']/).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => this.words.has(p))) return true;
    if (this.words.has(t.replaceAll(/[-']/g, ""))) return true;
    if (/^\p{Lu}{2,6}$/u.test(raw) && this.initials.has(t)) return true;
    const group = ALIASES.find((g) => g.includes(t) || g.includes(stem(t)));
    if (group?.some((a) => (a.includes(" ") ? fold(this.text).includes(a) : this.words.has(a)))) return true;
    const s = stem(t);
    if (this.words.has(s)) return true;
    if (s.length >= 5 && s.length <= 14 && this.prefixes.has(s)) return true;
    if (s.endsWith("n") && s.length >= 6 && this.prefixes.has(s.slice(0, -1).slice(0, 14))) return true;
    const base = s.replace(DEMONYM, "");
    return base.length >= 4 && base !== s && this.prefixes.has(base.slice(0, 14));
  }

  supports(s: Specific): boolean {
    if (mentions(this.text, s.text)) return true;
    if (s.kind === "date") return this.dates.has(`${s.month}-${s.day}`);
    if (s.kind === "name") {
      const found = s.tokens.filter((t) => this.hasToken(t));
      if (found.length === s.tokens.length) return true;
      if (this.hasToken(s.tokens.at(-1)!) && found.length * 2 >= s.tokens.length) return true;
      const initials = s.tokens.map((t) => fold(t)[0]).join("");
      return s.tokens.length >= 2 && this.words.has(initials);
    }
    const close = this.numbers.filter(
      (n) => Math.abs(n.value - s.value) <= s.tolerance + 1e-9 && (!s.percent || n.percent),
    );
    if (!close.length) return false;
    if (s.strong || !s.context.length) return true;
    return close.some((n) => s.context.some((w) => n.context.has(w)));
  }
}

export function vocabulary(articles: ReadonlyMap<string, Article>): Set<string> {
  const common = new Set<string>();
  for (const a of articles.values())
    for (const part of [a.title, a.summary, a.fulltext ?? ""])
      for (const m of part.matchAll(/(?<![\p{L}\p{N}'-])\p{Ll}[\p{L}'-]*/gu)) common.add(fold(m[0]));
  return common;
}

export function corpusFor(ids: string[], articles: ReadonlyMap<string, Article>): Corpus {
  return new Corpus(
    ids.flatMap((id) => {
      const a = articles.get(id);
      return a ? [a.source ?? "", a.published ?? "", a.title, a.summary, a.fulltext ?? ""] : [];
    }),
  );
}

export function ground(stories: StoryText[], articles: ReadonlyMap<string, Article>): GroundingReport {
  const unsupported: Unsupported[] = [];
  const namesUnchecked: GroundingReport["namesUnchecked"] = [];
  let checked = 0;
  const common = vocabulary(articles);
  for (const story of stories) {
    const corpus = corpusFor(story.sources, articles);
    for (const field of FIELDS) {
      const text = story.fields[field];
      if (!text) continue;
      const seen = new Set<string>();
      for (const s of specificsIn(text, common)) {
        if (seen.has(s.text)) continue;
        seen.add(s.text);
        if (s.kind === "name" && !corpus.english) {
          const row = namesUnchecked.find((r) => r.story === story.index);
          if (row) row.names++;
          else namesUnchecked.push({ story: story.index, names: 1 });
          continue;
        }
        checked++;
        if (!corpus.supports(s)) unsupported.push({ story: story.index, field, specific: s.text, kind: s.kind });
      }
    }
  }
  return { stories: stories.length, checked, unsupported, namesUnchecked };
}

export function plantsFlagged(
  plants: Plant[],
  flags: Unsupported[],
): { caught: number; total: number; missed: Plant[] } {
  const missed = plants.filter(
    (p) => !flags.some((f) => f.story === p.storyIndex && f.field === p.field && mentions(f.specific, p.marker)),
  );
  return { caught: plants.length - missed.length, total: plants.length, missed };
}
