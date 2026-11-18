import { describe, expect, it } from "vitest";
import { Corpus, ground, namesIn, numbersIn, plantsFlagged, type Article } from "./grounding.js";

const supported = (source: string, specificText: string, digest: string) => {
  const s = [...numbersIn(digest), ...namesIn(digest)].find((x) => x.text === specificText);
  if (!s)
    throw new Error(`no specific ${specificText} in ${JSON.stringify([...numbersIn(digest), ...namesIn(digest)])}`);
  return new Corpus([source]).supports(s);
};

describe("number specifics", () => {
  it("reads currency with a scale as one value, so €21bn is not €10bn and €10 billion is €10bn", () => {
    expect(supported("talks over €10 billion in cuts", "€10bn", "argued over €10bn in cuts")).toBe(true);
    expect(supported("talks over €10 billion in cuts", "€21bn", "argued over €21bn in cuts")).toBe(false);
  });

  it("reads 5.5 per cent and 5.5% as the same percentage, and about 4% is not 5.5%", () => {
    expect(supported("the Nasdaq fell 5.5 per cent", "5.5%", "the Nasdaq slid 5.5%")).toBe(true);
    expect(supported("the Nasdaq fell 5.5 per cent", "4%", "the Nasdaq slid about 4%")).toBe(false);
  });

  it("lets an approximate figure stand within a tenth of the cited one, and not beyond", () => {
    expect(supported("they evacuated 195 civilians", "200 civilians", "nearly 200 civilians fled")).toBe(true);
    expect(supported("they evacuated 167 civilians", "200 civilians", "nearly 200 civilians fled")).toBe(false);
  });

  it("matches a duration written in words against digits and back, by its unit", () => {
    expect(supported("the first talks in 9 months", "nine months", "first talks in more than nine months")).toBe(true);
    expect(supported("talks since February; 9 people hurt", "nine months", "first talks in nine months")).toBe(false);
  });

  it("does not take a round or small count as supported by the same digits in a sentence about something else", () => {
    expect(supported("The town is 200 km away. Then 167 civilians left.", "200 civilians", "200 civilians left")).toBe(
      false,
    );
  });

  it("takes a distinctive number as supported wherever it appears, whatever noun follows", () => {
    expect(supported("167 people were evacuated", "167", "167 civilians were evacuated")).toBe(true);
  });

  it("reads a hyphenated duration and a rise in percentage points", () => {
    expect(supported("they met for about three hours", "three hour", "a three-hour session")).toBe(true);
    expect(supported("raised rates by 0.25 to 1.25 percent", "0.25", "raised rates by 0.25 percentage points")).toBe(
      true,
    );
  });

  it("reads a thousands separator and a decimal comma", () => {
    expect(supported("some 12,500 troops", "12500", "12500 troops")).toBe(true);
    expect(supported("ein Minus von 5,5 Prozent", "5.5%", "a 5.5% fall")).toBe(true);
  });
});

describe("date specifics", () => {
  it("reads Nov. 3, November 3 and 3 November as one date, and Nov. 7 as another", () => {
    expect(supported("before the 3 November vote", "Nov. 3", "before the Nov. 3 vote")).toBe(true);
    expect(supported("before the November 3 vote", "Nov. 7", "before the Nov. 7 vote")).toBe(false);
  });

  it("reads a range of days and a German or Spanish date", () => {
    expect(supported("Der Europäische Rat am 17. und 18. Dezember", "Dec. 17", "the Dec. 17 summit")).toBe(true);
    expect(supported("desde el 24 de febrero de 2022", "Feb. 24", "since Feb. 24, 2022")).toBe(true);
  });
});

describe("name specifics", () => {
  it("skips a sentence's capitalised function word, and a common word the day's articles write in lower case, but keeps a sentence-initial name", () => {
    expect(
      namesIn("The talks resumed. Officials said Iran left Doha. Iran", new Set(["officials"])).map((n) => n.text),
    ).toEqual(["Iran", "Doha", "Iran"]);
  });

  it("keeps a name with its connector as one specific and checks it without the title", () => {
    const [n] = namesIn("Talks in the Strait of Hormuz went on.", new Set(["talks"]));
    expect(n?.text).toBe("Strait of Hormuz");
    expect(
      supported(
        "Prime minister Bart De Wever resigned",
        "Prime Minister Bart De Wever",
        "Prime Minister Bart De Wever quit",
      ),
    ).toBe(true);
  });

  it("matches a demonym to its country and an acronym to its initials", () => {
    expect(supported("Iran said", "Iranian", "an Iranian official")).toBe(true);
    expect(supported("France said", "French", "a French court")).toBe(true);
    expect(supported("the International Atomic Energy Agency said", "IAEA", "the IAEA said")).toBe(true);
  });

  it("takes an outlet named in full as the cited outlet's initials", () => {
    expect(
      supported("WSJ World: Saudi economy shrinks", "Wall Street Journal", "the Wall Street Journal reported"),
    ).toBe(true);
  });

  it("lets a person's first name stand when the cited text has the surname, but not a surname it lacks", () => {
    expect(
      supported(
        "Netanyahu's office said",
        "Prime Minister Benjamin Netanyahu",
        "Prime Minister Benjamin Netanyahu said",
      ),
    ).toBe(true);
    expect(
      supported("the Social Democrats' leader", "Magdalena Andersson", "clearing the way for Magdalena Andersson"),
    ).toBe(false);
  });

  it("flags a place no cited article names", () => {
    expect(supported("talks in Doha", "Geneva", "The measure was announced in Geneva.")).toBe(false);
  });
});

describe("ground", () => {
  const articles = new Map<string, Article>([
    ["A1", { title: "Nasdaq enters correction", summary: "The index fell 5.5% from its peak", source: "Reuters" }],
    ["A2", { title: "Nasdaq down about 4%", summary: "uncited" }],
  ]);
  it("checks each story against its own cited articles only, and names the story, field and specific", () => {
    const report = ground(
      [
        {
          index: 0,
          fields: { headline: "Nasdaq in correction", summary: "The Nasdaq slid about 4%, Reuters said." },
          sources: ["A1"],
        },
        { index: 1, fields: { headline: "Nasdaq down 5.5%", summary: "Down on the day." }, sources: ["A2"] },
      ],
      articles,
    );
    expect(report.unsupported).toEqual([
      { story: 0, field: "summary", specific: "4%", kind: "number" },
      { story: 1, field: "headline", specific: "5.5%", kind: "number" },
    ]);
    expect(report.stories).toBe(2);
  });

  it("leaves names unchecked, and says so, where the cited text is not English, and still checks its numbers", () => {
    const german = new Map<string, Article>([
      [
        "A1",
        {
          title: "Mehr als 300.000 Menschen auf der Flucht",
          summary: "Die Lage in Tais ist dramatisch, sagt die Uno.",
        },
      ],
    ]);
    const report = ground(
      [
        {
          index: 0,
          fields: { summary: "More than 300,000 people fled Taizz, the UN said on Sunday; 40 died." },
          sources: ["A1"],
        },
      ],
      german,
    );
    expect(report.unsupported).toEqual([{ story: 0, field: "summary", specific: "40 died", kind: "number" }]);
    expect(report.namesUnchecked).toEqual([{ story: 0, names: 3 }]);
  });

  it("counts a plant as caught when a flag on its story and field names its marker", () => {
    const flags = [{ story: 2, field: "summary" as const, specific: "€21bn", kind: "number" as const }];
    const plant = {
      storyIndex: 2,
      field: "summary" as const,
      kind: "wrong-number" as const,
      original: "",
      planted: "",
      marker: "21",
    };
    expect(plantsFlagged([plant, { ...plant, storyIndex: 1 }], flags).caught).toBe(1);
  });
});
