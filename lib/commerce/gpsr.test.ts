import { describe, it, expect } from "vitest";
import { missingGpsrFields, isGpsrComplete, gpsrEntries } from "./gpsr";

const complete = {
  manufacturer_name: "Hallmark Werkzeug GmbH",
  manufacturer_address: "Industriestraße 4, 42651 Solingen, Germany",
  manufacturer_email: "sicherheit@hallmark-werkzeug.de",
  eu_responsible_name: "Hallmark Werkzeug GmbH",
  eu_responsible_address: "Industriestraße 4, 42651 Solingen, Germany",
  eu_responsible_email: "sicherheit@hallmark-werkzeug.de",
  product_identifier: "HW-CH12-2026",
  safety_warnings: "Sharp edge. Keep out of reach of children under 14.",
};

describe("what a complete listing needs", () => {
  it("accepts a listing carrying everything", () => {
    expect(isGpsrComplete(complete)).toBe(true);
    expect(missingGpsrFields(complete)).toEqual([]);
  });

  it("names every missing field on an empty product", () => {
    const missing = missingGpsrFields({});
    expect(missing).toContain("Manufacturer");
    expect(missing).toContain("Manufacturer address");
    expect(missing).toContain("Manufacturer contact");
    expect(missing).toContain("Product identifier");
  });

  it("treats blank and whitespace as missing", () => {
    expect(isGpsrComplete({ ...complete, manufacturer_name: "   " })).toBe(false);
    expect(isGpsrComplete({ ...complete, product_identifier: "" })).toBe(false);
    expect(isGpsrComplete({ ...complete, manufacturer_address: null })).toBe(false);
  });

  it("does not demand a safety warning", () => {
    // Plenty of products carry none. Requiring one teaches merchants to write
    // filler into a field a regulator reads.
    expect(isGpsrComplete({ ...complete, safety_warnings: null })).toBe(true);
  });
});

describe("the EU responsible person is conditional, not assumed", () => {
  it("is not raised before a manufacturer is named", () => {
    // Nothing is known yet; asking about the responsible person first would be
    // asking a question the merchant cannot answer.
    const missing = missingGpsrFields({});
    expect(missing.some((m) => m.startsWith("EU responsible person"))).toBe(false);
  });

  it("is raised once a manufacturer exists but no responsible person does", () => {
    const missing = missingGpsrFields({ ...complete, eu_responsible_name: null, eu_responsible_address: null });
    expect(missing.some((m) => m.startsWith("EU responsible person"))).toBe(true);
  });

  it("is phrased as a condition, because Urivo cannot know where the maker sits", () => {
    const entry = missingGpsrFields({ ...complete, eu_responsible_name: null }).find((m) =>
      m.startsWith("EU responsible person"),
    );
    expect(entry).toContain("if the manufacturer is outside the EU");
  });
});

describe("what the storefront renders", () => {
  it("renders nothing at all for a product with no information", () => {
    // A heading over a blank is worse than no heading.
    expect(gpsrEntries({})).toEqual([]);
    expect(gpsrEntries({ manufacturer_name: "  " })).toEqual([]);
  });

  it("shows only the fields that exist", () => {
    const entries = gpsrEntries({ manufacturer_name: "Acme", product_identifier: "A-1" });
    expect(entries.map((e) => e.label)).toEqual(["Manufacturer", "Product identifier"]);
  });

  it("joins the manufacturer block into one readable line", () => {
    const entries = gpsrEntries(complete);
    const manufacturer = entries.find((e) => e.label === "Manufacturer")!;
    expect(manufacturer.value).toBe(
      "Hallmark Werkzeug GmbH · Industriestraße 4, 42651 Solingen, Germany · sicherheit@hallmark-werkzeug.de",
    );
  });

  it("carries the warning text through unaltered", () => {
    const warning = gpsrEntries(complete).find((e) => e.label === "Safety information")!;
    expect(warning.value).toBe("Sharp edge. Keep out of reach of children under 14.");
  });

  it("invents nothing — every rendered value came from the input", () => {
    const entries = gpsrEntries(complete);
    const source = JSON.stringify(complete);
    for (const e of entries) {
      for (const part of e.value.split(" · ")) expect(source).toContain(part);
    }
  });
});
