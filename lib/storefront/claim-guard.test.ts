import { describe, it, expect } from "vitest";
import { parseDesignSystem, isUnsupportedClaim } from "./design-system";

/*
 * The generator's honesty rules, enforced instead of requested.
 *
 * The store-generator prompt tells the model, at length, never to state a
 * shipping threshold, a returns window, a delivery time, a warranty length or
 * an environmental claim. That is good prompting and it is not a guarantee: the
 * model can drift, a model version can change, and a merchant can ask Ask Urivo
 * in plain words for "a line about free delivery". These sentences are
 * regulated commercial terms in the EU and the MERCHANT is bound by them, so
 * the system has to refuse them even when something upstream asks nicely.
 *
 * The fixtures below are written as a model would actually write them — fluent,
 * on-brand, and exactly the kind of thing that reads fine until a regulator or
 * a customer holds the merchant to it.
 */

const base = {
  personality: "Considered, quiet, built to last",
  palette: { background: "#12100E", ink: "#F4F1EA", accent: "#C08A3E" },
  fonts: { headingKey: "archivo", bodyKey: "inter" },
};

describe("a fabricated promise never reaches a merchant's storefront", () => {
  const hallucinated = [
    ["a shipping threshold", { title: "Free shipping over €50", detail: "On every order across the EU." }],
    ["free delivery", { title: "Free delivery, always", detail: "We cover postage on all orders." }],
    ["a returns window", { title: "30-day returns", detail: "Send it back within 30 days, no questions asked." }],
    ["a delivery time", { title: "Next-day dispatch", detail: "Order before 3pm and it is delivered in 2 days." }],
    ["a warranty", { title: "Lifetime warranty", detail: "Covered for as long as you own it." }],
    ["a money-back guarantee", { title: "Money-back guarantee", detail: "Not happy? Full refund." }],
    ["an environmental claim", { title: "Carbon neutral delivery", detail: "Every parcel is offset." }],
    ["a certification", { title: "GOTS certified cotton", detail: "Independently certified organic." }],
    ["invented social proof", { title: "Rated 4.8 by 2,000 customers", detail: "Loved by thousands." }],
  ] as const;

  for (const [label, item] of hallucinated) {
    it(`refuses ${label}`, () => {
      const ds = parseDesignSystem({ ...base, trust: [item] });
      expect(isUnsupportedClaim(item.title, item.detail)).toBe(true);
      // Nothing survived, so the section does not render at all.
      expect(ds.trust).toBeUndefined();
    });
  }

  it("refuses them in highlights too, not just trust", () => {
    const ds = parseDesignSystem({
      ...base,
      highlights: [{ title: "Free worldwide shipping", detail: "Always included." }],
    });
    expect(ds.highlights).toBeUndefined();
  });

  it("keeps the honest promises and drops only the fabricated one", () => {
    const ds = parseDesignSystem({
      ...base,
      trust: [
        { title: "Secure checkout", detail: "Card details are encrypted in transit." },
        { title: "Free shipping over €50", detail: "On every order." }, // the liar
        { title: "Talk to a maker", detail: "Write to us and the person who built it replies." },
        { title: "Packed to survive the post", detail: "Boxed so it arrives in the state it left." },
      ],
    });
    const titles = (ds.trust ?? []).map((t) => t.title);
    expect(titles).toContain("Secure checkout");
    expect(titles).toContain("Talk to a maker");
    expect(titles).not.toContain("Free shipping over €50");
    expect(ds.trust).toHaveLength(3);
  });
});

describe("ordinary brand language is left alone", () => {
  const honest = [
    { title: "Made in small workshops", detail: "We work with two workshops in Portugal." },
    { title: "One bevel angle", detail: "25 degrees, the angle joiners actually use." },
    { title: "Secure checkout", detail: "Encrypted end to end." },
    { title: "Built to be repaired", detail: "Every part can be replaced by hand." },
    { title: "Ships from Berlin", detail: "Dispatched from our own workshop." },
    { title: "Five colourways", detail: "Chosen to sit together on a shelf." },
  ];

  it("passes honest proof points through untouched", () => {
    const ds = parseDesignSystem({ ...base, trust: honest.slice(0, 4), highlights: honest.slice(0, 3) });
    expect(ds.trust).toHaveLength(4);
    expect(ds.highlights).toHaveLength(3);
    for (const p of honest) expect(isUnsupportedClaim(p.title, p.detail)).toBe(false);
  });

  it("does not trip on prices, counts or ordinary numbers", () => {
    for (const p of [
      { title: "From €42", detail: "Three sizes, one price." },
      { title: "2 year project", detail: "It took two years to get the weight right." },
      { title: "Set of 6", detail: "Six glasses, packed together." },
    ]) {
      expect(isUnsupportedClaim(p.title, p.detail)).toBe(false);
    }
  });
});

describe("the statutory returns window is not a fabricated promise", () => {
  it("allows the EU right of withdrawal, in digits or words", () => {
    for (const p of [
      { title: "Fourteen days to return", detail: "Unused, in its box, no argument." },
      { title: "14-day returns", detail: "The statutory withdrawal period." },
    ]) {
      expect(isUnsupportedClaim(p.title, p.detail)).toBe(false);
    }
  });

  it("refuses longer windows, which are voluntary and bind the merchant", () => {
    for (const p of [
      { title: "30-day returns", detail: "A month to change your mind." },
      { title: "Thirty days to decide", detail: "Return it opened and half-used." },
      { title: "Ninety day warranty", detail: "Covered for three months." },
    ]) {
      expect(isUnsupportedClaim(p.title, p.detail)).toBe(true);
    }
  });
});
