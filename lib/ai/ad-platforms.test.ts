import { describe, it, expect } from "vitest";
import {
  PLATFORM_LIMITS,
  enforceLimits,
  findViolations,
  trimToWord,
  renderPlatformLimits,
  type Creative,
} from "./ad-platforms";

/*
 * Platform limits.
 *
 * The failure this guards against is specific and expensive: an ad that reads
 * beautifully in Urivo and is rejected the moment the merchant pastes it into
 * Google Ads. Length was only ever stated in the prompt — structured outputs
 * strip string constraints from the schema — so nothing caught a long headline
 * when the model drifted.
 */

const ad = (over: Partial<Creative> = {}): Creative => ({
  platform: "Google",
  format: "Search RSA",
  angle: "buy once",
  headline: "Short one",
  primaryText: "Short body",
  cta: "Shop Now",
  ...over,
});

describe("the real limits, pinned", () => {
  it("keeps Google at the RSA limits that cause upload rejections", () => {
    // 30 / 90 are Google's hard numbers. If these drift, ads stop uploading.
    expect(PLATFORM_LIMITS.Google.headline).toBe(30);
    expect(PLATFORM_LIMITS.Google.primaryText).toBe(90);
  });

  it("keeps Meta at the point where the reader stops seeing the copy", () => {
    expect(PLATFORM_LIMITS.Meta.primaryText).toBe(125);
  });

  it("states every limit to the model in the system prompt", () => {
    const rendered = renderPlatformLimits();
    for (const [platform, limits] of Object.entries(PLATFORM_LIMITS)) {
      expect(rendered).toContain(platform);
      expect(rendered).toContain(String(limits.headline));
    }
  });
});

describe("violations are found per platform, not globally", () => {
  it("flags a 40-character headline on Google and allows it on Pinterest", () => {
    const headline = "A".repeat(40);
    expect(findViolations([ad({ platform: "Google", headline })])).toHaveLength(1);
    // The same string is fine on Pinterest — one global limit would have been
    // wrong in both directions.
    expect(findViolations([ad({ platform: "Pinterest", headline })])).toHaveLength(0);
  });

  it("reports the field, the length and the limit so the repair can be exact", () => {
    const [v] = findViolations([ad({ platform: "Google", headline: "B".repeat(45) })]);
    expect(v).toMatchObject({ field: "headline", length: 45, limit: 30, platform: "Google" });
  });

  it("finds nothing when everything fits", () => {
    expect(findViolations([ad(), ad({ platform: "Meta", headline: "Fits fine" })])).toEqual([]);
  });

  it("ignores a platform it has no limits for rather than crashing", () => {
    expect(findViolations([ad({ platform: "Snapchat", headline: "C".repeat(200) })])).toEqual([]);
  });
});

describe("trimming cuts words, never through them", () => {
  it("cuts at the last space inside the limit", () => {
    expect(trimToWord("The last marking gauge you will ever buy", 30)).toBe("The last marking gauge you");
  });

  it("never returns more than the limit", () => {
    const long = "supercalifragilistic expialidocious headline copy";
    expect(trimToWord(long, 20).length).toBeLessThanOrEqual(20);
  });

  it("leaves short text untouched", () => {
    expect(trimToWord("Fits", 30)).toBe("Fits");
  });

  it("falls back to a hard cut when one word is longer than the whole limit", () => {
    // No boundary exists; a hard cut beats returning something over the limit.
    expect(trimToWord("Donaudampfschiffahrtsgesellschaft", 10)).toHaveLength(10);
  });

  it("does not leave dangling punctuation at the cut", () => {
    expect(trimToWord("Precision tools, built to last a lifetime", 20)).not.toMatch(/[\s,;:–—-]$/);
  });
});

describe("enforcement fits every ad and says what it changed", () => {
  it("shortens an over-long Google headline and reports it", () => {
    const { creatives, adjusted } = enforceLimits([
      ad({ headline: "The very last marking gauge you will ever need to buy" }),
    ]);
    expect(creatives[0].headline.length).toBeLessThanOrEqual(30);
    // Silent shortening is the trap: the merchant reads one headline in Urivo
    // and pastes a different one into Google.
    expect(adjusted[0]).toMatch(/Google headline shortened/);
  });

  it("leaves a compliant plan completely untouched", () => {
    const input = [ad(), ad({ platform: "Meta", headline: "Buy once, keep forever" })];
    const { creatives, adjusted } = enforceLimits(input);
    expect(creatives).toEqual(input);
    expect(adjusted).toEqual([]);
  });

  it("guarantees the output has no violations left", () => {
    const messy = [
      ad({ platform: "Google", headline: "X".repeat(80), primaryText: "Y".repeat(300) }),
      ad({ platform: "Meta", primaryText: "Z".repeat(400) }),
      ad({ platform: "TikTok", headline: "W".repeat(250) }),
    ];
    const { creatives } = enforceLimits(messy);
    // The whole point: whatever reaches the merchant is uploadable.
    expect(findViolations(creatives)).toEqual([]);
  });
});
