import { describe, it, expect } from "vitest";
import { toGoogleRsaCsv, toMetaBulkCsv, csvCell, metaCta, type ExportableCreative } from "./ad-export";

/*
 * The export is the difference between a plan and a running campaign. It also
 * lands in an account that can spend money, so the cases here guard the two
 * ways it could do harm: a file the platform rejects after the merchant has
 * already sat down to import it, and a file that starts spending on arrival.
 */

const ad = (over: Partial<ExportableCreative> = {}): ExportableCreative => ({
  platform: "Meta",
  format: "single image",
  angle: "buy-it-for-life",
  headline: "Built to outlive the trend",
  primaryText: "Solid brass, not plated. One purchase, then never again.",
  cta: "Shop Now",
  trackingUrl: "https://nordwerk.urivo.ai?uc=c1",
  ...over,
});

const parse = (csv: string) =>
  csv
    .replace(/^﻿/, "")
    .trim()
    .split("\r\n")
    .map((line) => line.slice(1, -1).split('","'));

describe("nothing an import can reject", () => {
  it("quotes every cell and escapes quotes inside copy", () => {
    // Ad copy is full of commas and quotes; one unescaped quote shifts every
    // following column and the merchant imports headlines into the URL field.
    expect(csvCell('He said "buy once", then left')).toBe('"He said ""buy once"", then left"');
  });

  it("cuts copy to what the platform accepts, at a word boundary", () => {
    // Meta's title limit is 40. A cut mid-word ("Built to outlive the tre")
    // reads as a bug in the merchant's ad, which is worse than a shorter ad.
    const long = "Built to outlive the trend and everything after it";
    const [, row] = parse(toMetaBulkCsv([ad({ headline: long })], "Nordwerk").csv!);
    const title = row[7];
    expect(title.length).toBeLessThanOrEqual(40);
    expect(long.startsWith(title)).toBe(true);
    // The character right after the cut must be the space it cut on.
    expect(long[title.length]).toBe(" ");
  });

  it("starts with a byte order mark so Excel does not mangle the euro sign", () => {
    // Without it, "€89" imports as "â‚¬89" — in the price of a live ad.
    const csv = toMetaBulkCsv([ad({ primaryText: "Just €89 today" })], "Nordwerk").csv!;
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("€89");
  });

  it("uses CRLF, which is what both importers expect", () => {
    expect(toMetaBulkCsv([ad()], "Nordwerk").csv!).toContain("\r\n");
  });

  it("maps the call to action into Meta's own vocabulary", () => {
    // Meta rejects the upload outright on an unknown CTA string.
    expect(metaCta("Shop Now")).toBe("SHOP_NOW");
    expect(metaCta("buy now")).toBe("SHOP_NOW");
    expect(metaCta("Learn More")).toBe("LEARN_MORE");
  });

  it("falls back to an always-valid call to action rather than failing the file", () => {
    expect(metaCta("Feel the difference")).toBe("LEARN_MORE");
  });
});

describe("an import can never start spending on its own", () => {
  it("brings every Meta campaign, ad set and ad in paused", () => {
    const [header, row] = parse(toMetaBulkCsv([ad()], "Nordwerk").csv!);
    for (const col of ["Campaign Status", "Ad Set Status", "Ad Status"]) {
      expect(row[header.indexOf(col)]).toBe("PAUSED");
    }
  });

  it("brings the Google ad in paused too", () => {
    const google = [
      ad({ platform: "Google", headline: "Chisels sharp off the bench" }),
      ad({ platform: "Google", headline: "The last marking gauge" }),
      ad({ platform: "Google", headline: "Scrapers beat sandpaper", primaryText: "Try both once." }),
    ];
    const [header, row] = parse(toGoogleRsaCsv(google, "Nordwerk").csv!);
    expect(row[header.indexOf("Status")]).toBe("Paused");
    expect(row[header.indexOf("Campaign Status")]).toBe("Paused");
  });

  it("never invents a daily budget", () => {
    /*
     * A number Urivo made up, imported into an account that can spend it, is
     * the one mistake here with a bill attached. The merchant fills this in.
     */
    const [header, row] = parse(toMetaBulkCsv([ad()], "Nordwerk").csv!);
    expect(row[header.indexOf("Ad Set Daily Budget")]).toBe("");
  });
});

describe("the tracked link is written in, so it cannot be got wrong", () => {
  it("Meta gets one ad per creative, each individually measurable", () => {
    const csv = toMetaBulkCsv(
      [ad({ trackingUrl: "https://s.urivo.ai?uc=a" }), ad({ trackingUrl: "https://s.urivo.ai?uc=b" })],
      "Nordwerk",
    );
    const rows = parse(csv.csv!).slice(1);
    expect(csv.ads).toBe(2);
    expect(rows.map((r) => r[9])).toEqual(["https://s.urivo.ai?uc=a", "https://s.urivo.ai?uc=b"]);
  });

  it("the Google ad carries a tracked final URL", () => {
    const google = ["one", "two", "three"].map((h, i) =>
      ad({ platform: "Google", headline: `Headline ${h}`, primaryText: `Body ${i}`, trackingUrl: `https://s.urivo.ai?uc=${i}` }),
    );
    const [header, row] = parse(toGoogleRsaCsv(google, "Nordwerk").csv!);
    expect(row[header.indexOf("Final URL")]).toMatch(/\?uc=/);
  });

  it("skips ads that never got a tracking link rather than exporting an untracked one", () => {
    // An exported ad with a bare store URL would look identical and measure nothing.
    const csv = toMetaBulkCsv([ad(), ad({ trackingUrl: "" })], "Nordwerk");
    expect(csv.ads).toBe(1);
  });
});

describe("Google gets a responsive search ad, because that is what Google runs", () => {
  const googleSet = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      ad({ platform: "Google", headline: `Headline number ${i}`, primaryText: `Description number ${i}`, trackingUrl: `https://s.urivo.ai?uc=${i}` }),
    );

  it("folds every Google headline into ONE ad, not one ad each", () => {
    const result = toGoogleRsaCsv(googleSet(4), "Nordwerk");
    const rows = parse(result.csv!);
    expect(rows.length).toBe(2); // header + a single ad
    expect(result.ads).toBe(1);
    const [header, row] = rows;
    expect(row[header.indexOf("Headline 1")]).toBe("Headline number 0");
    expect(row[header.indexOf("Headline 4")]).toBe("Headline number 3");
    expect(row[header.indexOf("Ad type")]).toBe("Responsive search ad");
  });

  it("refuses to build a file Google would reject", () => {
    // Under three headlines an RSA is invalid. Failing here beats failing in
    // the merchant's browser after they have already opened Ads Editor.
    const result = toGoogleRsaCsv(googleSet(2), "Nordwerk");
    expect(result.csv).toBeNull();
    expect(result.note).toMatch(/at least 3 headlines/i);
  });

  it("fills the headline pool from the rest of the set, which is what makes it usable", () => {
    /*
     * A generated plan typically contains two Google creatives. Without this
     * the export refused to build for nearly every real merchant — the rule
     * was right and the ad was still missing.
     */
    const mixed = [
      ...googleSet(2),
      ad({ platform: "Meta", headline: "Throw out the sandpaper", trackingUrl: "https://s.urivo.ai?uc=m1" }),
      ad({ platform: "Meta", headline: "The last one you will buy", trackingUrl: "https://s.urivo.ai?uc=m2" }),
    ];
    const result = toGoogleRsaCsv(mixed, "Nordwerk");
    expect(result.csv).not.toBeNull();
    const [header, row] = parse(result.csv!);
    expect(row[header.indexOf("Headline 3")]).toBe("Throw out the sandpaper");
    // The merchant is told, rather than finding out in Ads Editor.
    expect(result.note).toMatch(/came from your other ads/i);
  });

  it("puts Google's own copy first, so the platform's voice leads", () => {
    const mixed = [
      ad({ platform: "Meta", headline: "Meta wrote this one", trackingUrl: "https://s.urivo.ai?uc=m1" }),
      ...googleSet(3),
    ];
    const [header, row] = parse(toGoogleRsaCsv(mixed, "Nordwerk").csv!);
    expect(row[header.indexOf("Headline 1")]).toBe("Headline number 0");
  });

  it("never borrows a headline Google would reject for length", () => {
    const mixed = [
      ...googleSet(2),
      ad({ platform: "Meta", headline: "A".repeat(45), trackingUrl: "https://s.urivo.ai?uc=m1" }),
      ad({ platform: "Meta", headline: "Short enough to borrow", trackingUrl: "https://s.urivo.ai?uc=m2" }),
    ];
    const [header, row] = parse(toGoogleRsaCsv(mixed, "Nordwerk").csv!);
    const headlines = header.map((h, i) => (h.startsWith("Headline ") ? row[i] : "")).filter(Boolean);
    expect(headlines).toContain("Short enough to borrow");
    // Trimming a borrowed headline would ship a half-sentence into search results.
    expect(headlines.some((h) => h.startsWith("AAAA"))).toBe(false);
  });

  it("never borrows a description that would have to be cut mid-sentence", () => {
    /*
     * A Meta body runs to 125 characters and Google stops at 90. Squeezing one
     * in leaves "...shaving-sharp out of the" showing in a live search ad.
     * One description fewer is the better trade.
     */
    const mixed = [
      ...googleSet(3),
      ad({
        platform: "Meta",
        headline: "Borrowed headline is fine",
        primaryText: "Cheap chisel gone dull in a week? Ours is cryo-treated steel, shaving-sharp out of the box. Only €89 today.",
        trackingUrl: "https://s.urivo.ai?uc=m1",
      }),
    ];
    const [header, row] = parse(toGoogleRsaCsv(mixed, "Nordwerk").csv!);
    const descriptions = header
      .map((h, i) => (h.startsWith("Description ") ? row[i] : ""))
      .filter((v) => v.length > 0);
    expect(descriptions.some((d) => d.startsWith("Cheap chisel"))).toBe(false);
    // Every description that did make it is a complete piece of copy.
    for (const d of descriptions) expect(d.length).toBeLessThanOrEqual(90);
  });

  it("says that Google reports per ad, not per headline", () => {
    // Google recombines headlines itself; claiming per-headline results would
    // be a promise the platform cannot keep.
    expect(toGoogleRsaCsv(googleSet(3), "Nordwerk").note).toMatch(/as a whole rather than per headline/i);
  });

  it("stops at Google's ceiling of 15 headlines and 4 descriptions", () => {
    const [header, row] = parse(toGoogleRsaCsv(googleSet(20), "Nordwerk").csv!);
    expect(header.filter((h) => h.startsWith("Headline "))).toHaveLength(15);
    expect(row[header.indexOf("Headline 15")]).not.toBe("");
    expect(header.filter((h) => h.startsWith("Description "))).toHaveLength(4);
  });

  it("drops duplicate headlines, which Google rejects as redundant", () => {
    const dupes = [...googleSet(3), ad({ platform: "Google", headline: "Headline number 0", primaryText: "x", trackingUrl: "https://s.urivo.ai?uc=z" })];
    const [header, row] = parse(toGoogleRsaCsv(dupes, "Nordwerk").csv!);
    const headlines = header
      .map((h, i) => (h.startsWith("Headline ") ? row[i] : ""))
      .filter((v) => v.length > 0);
    expect(new Set(headlines).size).toBe(headlines.length);
  });
});

describe("an empty export explains itself", () => {
  it("says why there is no Google file rather than downloading an empty one", () => {
    const result = toGoogleRsaCsv([ad({ platform: "Meta" })], "Nordwerk");
    expect(result.csv).toBeNull();
    expect(result.note).toMatch(/No Google ads/i);
  });

  it("says why there is no Meta file", () => {
    const result = toMetaBulkCsv([ad({ platform: "Google" })], "Nordwerk");
    expect(result.csv).toBeNull();
    expect(result.note).toMatch(/No Meta ads/i);
  });

  it("names the file after the store, so two stores never collide in Downloads", () => {
    expect(toMetaBulkCsv([ad()], "Nordwerk Studio").filename).toBe("nordwerk-studio-meta-ads.csv");
  });
});
