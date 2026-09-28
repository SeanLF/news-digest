import { describe, expect, it } from "vitest";
import type { Source } from "./common.js";
import { groupReports } from "./reports.js";

let n = 0;
const src = (name: string, title: string, extra: Partial<Source> = {}): Source => ({
  name,
  original_title: title,
  url: `https://${name.toLowerCase().replaceAll(/\W/g, "")}.example/article-${++n}`,
  bias: "center",
  ...extra,
});
const shape = (sources: Source[]) =>
  groupReports(sources).reports.map((r) => ({ label: r.label, leaning: r.leaning, bucket: r.bucket, members: r.members.map((m) => `${m.origin ? "*" : ""}${m.name}:${m.urls.length}`) }));

describe("groupReports", () => {
  it("makes each outlet's own reporting one report, in its own leaning", () => {
    expect(shape([src("BBC", "Deal signed"), src("Le Monde", "Accord signé", { bias: "lean-left" })])).toEqual([
      { label: "Le Monde", leaning: "lean-left", bucket: "l", members: ["*Le Monde:1"] },
      { label: "BBC", leaning: "center", bucket: "c", members: ["*BBC:1"] },
    ]);
  });

  it("keeps one outlet's several own articles as one report with several links", () => {
    expect(shape([src("FT", "Arrests near base"), src("FT", "Investigators focus on Iran link")])).toEqual([{ label: "FT", leaning: "center", bucket: "c", members: ["*FT:2"] }]);
  });

  it("puts wire-tagged copy under its agency, as a wire report, with the carriers nested", () => {
    const out = shape([
      src("Straits Times", "Police question five men", { bias: "lean-right", wire_agency: "reuters" }),
      src("Al-Monitor", "UK police question five men", { bias: "lean-left", wire_agency: "reuters" }),
      src("Guardian", "Minister hints services knew", { bias: "lean-left" }),
    ]);
    expect(out).toEqual([
      { label: "Guardian", leaning: "lean-left", bucket: "l", members: ["*Guardian:1"] },
      { label: "Reuters", leaning: "wire", bucket: "w", members: ["Straits Times:1", "Al-Monitor:1"] },
    ]);
  });

  it("makes a fetched wire service the origin of its own report, with its own link", () => {
    const out = shape([src("Al-Monitor", "Dozens walk out", { wire_agency: "reuters" }), src("Reuters", "Dozens walk out - Reuters", { wire: true, wire_agency: "reuters" })]);
    expect(out).toEqual([{ label: "Reuters", leaning: "wire", bucket: "w", members: ["*Reuters:1", "Al-Monitor:1"] }]);
  });

  it("joins identical headlines from different outlets, the first listed as origin", () => {
    const out = shape([src("Straits Times", "Wife of Mahathir dies aged 100"), src("Daily Maverick", "Wife of Mahathir dies aged 100", { bias: "lean-left" })]);
    expect(out).toEqual([{ label: "Straits Times", leaning: "center", bucket: "c", members: ["*Straits Times:1", "Daily Maverick:1"] }]);
  });

  it("joins an identical headline to the wire report when any copy of it carries the tag", () => {
    const out = shape([src("Straits Times", "Netanyahu visited Abu Dhabi"), src("Al-Monitor", "Netanyahu visited Abu Dhabi", { wire_agency: "reuters" })]);
    expect(out).toEqual([{ label: "Reuters", leaning: "wire", bucket: "w", members: ["Straits Times:1", "Al-Monitor:1"] }]);
  });

  it("never joins on a similar headline, only an identical one", () => {
    expect(groupReports([src("A", "Police question five men held at airbase"), src("B", "UK police question five men held at airbase")]).reports).toHaveLength(2);
  });

  it("never joins on a generic headline", () => {
    expect(groupReports([src("A", "Live updates"), src("B", "Live updates")]).reports).toHaveLength(2);
    expect(groupReports([src("A", "What we know"), src("B", "What we know")]).reports).toHaveLength(2);
  });

  it("never joins untitled sources", () => {
    expect(groupReports([src("A", ""), src("B", "")]).reports).toHaveLength(2);
  });

  it("lists an outlet under both its own report and the wire it reprints, and counts it once", () => {
    const g = groupReports([src("Straits Times", "Own story"), src("Straits Times", "Wire story", { wire_agency: "afp" })]);
    expect(g.reports.map((r) => r.label)).toEqual(["Straits Times", "AFP"]);
    expect({ reports: g.reports.length, outlets: g.outlets }).toEqual({ reports: 2, outlets: 1 });
  });

  it("drops links a reader cannot open, and a report left with none", () => {
    const g = groupReports([src("A", "One", { url: "javascript:alert(1)" }), src("B", "Two", { url: "https://b.example/" }), src("C", "Three")]);
    expect(g.reports.map((r) => r.label)).toEqual(["C"]);
    expect(g.outlets).toBe(1);
  });

  it("counts reports and distinct outlets", () => {
    const g = groupReports([
      src("Reuters", "X - Reuters", { wire: true, wire_agency: "reuters" }),
      src("Straits Times", "Y", { wire_agency: "reuters" }),
      src("FT", "Z"),
      src("FT", "Z2"),
    ]);
    expect({ reports: g.reports.length, outlets: g.outlets }).toEqual({ reports: 2, outlets: 3 });
  });
});
