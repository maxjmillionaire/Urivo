import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AI_ASSISTANT_LABEL, AI_ASSISTANT_NOTICE, disclosesAi } from "./assistant-disclosure";

/*
 * EU AI Act Art. 50(1), in force since 2 August 2026: a person must be told they
 * are interacting with an AI. Penalty for getting it wrong reaches €15m or 3% of
 * worldwide turnover, which is a strange amount of money to owe over a sentence.
 */

describe("the wording is a disclosure, not a brand line", () => {
  it("names AI in both surfaces", () => {
    expect(disclosesAi(AI_ASSISTANT_LABEL)).toBe(true);
    expect(disclosesAi(AI_ASSISTANT_NOTICE)).toBe(true);
  });

  it("does not accept a product name as a disclosure", () => {
    // The exact mistake the Article exists to prevent, and the state this repo
    // shipped in until now: a rail labelled "Ask Urivo" and nothing else.
    expect(disclosesAi("Ask Urivo")).toBe(false);
    expect(disclosesAi("Urivo Store Assistant")).toBe(false);
    expect(disclosesAi("")).toBe(false);
    expect(disclosesAi(null)).toBe(false);
  });

  it("recognises a German disclosure, for when the UI is localised", () => {
    expect(disclosesAi("Du sprichst mit einer KI.")).toBe(true);
    expect(disclosesAi("künstliche Intelligenz")).toBe(true);
  });

  it("does not match 'ai' inside an unrelated word", () => {
    // "available", "chair", "email" — a substring match would call these
    // disclosures and the guard below would then pass on nothing.
    expect(disclosesAi("Available now")).toBe(false);
    expect(disclosesAi("Send an email")).toBe(false);
  });

  it("stays short enough to sit in a rail header without wrapping", () => {
    expect(AI_ASSISTANT_LABEL.length).toBeLessThan(20);
    expect(AI_ASSISTANT_NOTICE.length).toBeLessThan(60);
  });
});

/*
 * Defining the sentence is not the same as showing it. This is the same lesson
 * the storefront learned twice (honest-claims, then ai-disclosure): the rule was
 * right and the surface did not apply it. So the guard reads the component.
 */
const ASK_URIVO = fileURLToPath(
  new URL("../../app/(platform)/dashboard/_shell/ask-urivo.tsx", import.meta.url),
);

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the assistant actually discloses", () => {
  const src = code(ASK_URIVO);

  it("is reading the assistant component (a wrong path would pass everything)", () => {
    expect(src).toContain("Ask Urivo");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("renders the persistent label and the first-exchange notice", () => {
    expect(src).toContain("AI_ASSISTANT_LABEL");
    expect(src).toContain("AI_ASSISTANT_NOTICE");
  });

  it("imports them rather than retyping the wording", () => {
    // A copy of the sentence in the component is a second source of truth, and
    // the two drift the first time someone edits one of them.
    expect(src).toMatch(/from "@\/lib\/ai\/assistant-disclosure"/);
  });
});
