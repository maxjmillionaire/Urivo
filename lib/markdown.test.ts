import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline, type Block } from "./markdown";

/*
 * Assistant replies arrive as markdown and are rendered token by token while
 * still streaming, so this parser sees a lot of HALF-WRITTEN input: an open
 * `**`, a fence with no close, a list mid-item. None of that may throw, and
 * none of it may turn user- or model-supplied text into markup.
 */

const text = (b: Block) =>
  b.kind === "p" || b.kind === "h"
    ? b.spans.map((s) => s.text).join("")
    : b.kind === "code"
      ? b.text
      : "";

describe("parseInline", () => {
  it("reads bold, italic and code", () => {
    expect(parseInline("plain **bold** _italic_ `code`")).toEqual([
      { text: "plain " },
      { text: "bold", bold: true },
      { text: " " },
      { text: "italic", italic: true },
      { text: " " },
      { text: "code", code: true },
    ]);
  });

  it("treats an unclosed marker as literal text", () => {
    // This is the streaming case: the closing ** has not arrived yet.
    expect(parseInline("your **biggest problem")).toEqual([{ text: "your **biggest problem" }]);
  });

  it("keeps http and mailto links", () => {
    expect(parseInline("[docs](https://urivo.ai/docs)")).toEqual([
      { text: "docs", href: "https://urivo.ai/docs" },
    ]);
  });

  it("never emits an href for a scheme it will not follow", () => {
    // The label survives as plain text; the URL does not become an anchor. The
    // parser reads the URL up to the first ")", so a URL containing parens can
    // leave a literal fragment behind — cosmetic, and it is still only text.
    for (const src of [
      "[click](javascript:alert(1))",
      "[click](data:text/html;base64,PHNjcmlwdD4=)",
      "[click](vbscript:msgbox)",
      "[click](/relative/path)",
    ]) {
      const spans = parseInline(src);
      expect(spans.every((s) => s.href === undefined)).toBe(true);
      expect(spans.map((s) => s.text).join("")).toContain("click");
    }
  });

  it("does not treat angle brackets as markup", () => {
    // The parser returns spans, never HTML — so this is inert by construction.
    const spans = parseInline("<script>alert(1)</script>");
    expect(spans.map((s) => s.text).join("")).toBe("<script>alert(1)</script>");
    expect(spans.every((s) => !s.href)).toBe(true);
  });

  it("drops empty spans rather than emitting blank nodes", () => {
    expect(parseInline("**bold**")).toEqual([{ text: "bold", bold: true }]);
  });
});

describe("parseMarkdown", () => {
  it("joins wrapped lines into one paragraph and splits on a blank line", () => {
    const blocks = parseMarkdown("one\ntwo\n\nthree");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "p"]);
    expect(text(blocks[0])).toBe("one two");
    expect(text(blocks[1])).toBe("three");
  });

  it("reads headings up to level three", () => {
    const blocks = parseMarkdown("# One\n## Two\n### Three\n#### Four");
    expect(blocks.filter((b) => b.kind === "h")).toHaveLength(3);
    // Level four is not in the subset, so it stays a paragraph rather than
    // rendering a stray hash.
    expect(text(blocks[3])).toBe("#### Four");
  });

  it("groups consecutive bullets into one list", () => {
    const blocks = parseMarkdown("- first\n- second\n- third");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("ul");
    if (blocks[0].kind === "ul") expect(blocks[0].items).toHaveLength(3);
  });

  it("keeps an ordered list's starting number", () => {
    const blocks = parseMarkdown("3. third\n4. fourth");
    expect(blocks[0].kind).toBe("ol");
    if (blocks[0].kind === "ol") {
      expect(blocks[0].start).toBe(3);
      expect(blocks[0].items).toHaveLength(2);
    }
  });

  it("reads a fenced code block with its language", () => {
    const blocks = parseMarkdown("```ts\nconst a = 1;\n```");
    expect(blocks[0].kind).toBe("code");
    if (blocks[0].kind === "code") {
      expect(blocks[0].lang).toBe("ts");
      expect(blocks[0].text).toBe("const a = 1;");
    }
  });

  it("closes an unterminated fence at the end of the document", () => {
    // Mid-stream: the closing fence has not been written yet.
    const blocks = parseMarkdown("Here:\n```\nstill typing");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "code"]);
    expect(text(blocks[1])).toBe("still typing");
  });

  it("reads a horizontal rule", () => {
    expect(parseMarkdown("a\n\n---\n\nb").map((b) => b.kind)).toEqual(["p", "hr", "p"]);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });

  it("survives every prefix of a realistic reply", () => {
    // The rail re-parses on every chunk, so each partial string must be safe.
    const reply = [
      "### What I'd fix first",
      "",
      "You've had **214 visitors** and no orders. That is a *conversion* problem.",
      "",
      "1. Rewrite the hero — it names the brand, not the promise",
      "2. Connect Stripe (`Settings → Payments`)",
      "",
      "---",
      "",
      "See [the guide](https://urivo.ai/guide).",
    ].join("\n");
    for (let i = 0; i <= reply.length; i++) {
      expect(() => parseMarkdown(reply.slice(0, i))).not.toThrow();
    }
    const full = parseMarkdown(reply);
    expect(full.map((b) => b.kind)).toEqual(["h", "p", "ol", "hr", "p"]);
  });

  it("does not throw on hostile or malformed input", () => {
    for (const src of ["```".repeat(50), "*".repeat(500), "- ".repeat(200), "#".repeat(10), "[](", "\u0000"]) {
      expect(() => parseMarkdown(src)).not.toThrow();
    }
  });
});
