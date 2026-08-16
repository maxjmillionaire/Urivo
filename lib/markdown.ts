/*
 * A deliberately small markdown parser for assistant replies.
 *
 * Ask Urivo's answers used to render through `whitespace-pre-wrap`, so a
 * structured reply — headings, bullets, a bolded recommendation — reached the
 * founder as literal `**` and `-` characters. Any modern assistant renders its
 * own formatting; showing the raw syntax makes the product look unfinished at
 * the exact moment the answer is at its most useful.
 *
 * This parses a SUBSET on purpose: paragraphs, ATX headings, unordered and
 * ordered lists, fenced code, rules, and inline bold / italic / code / links.
 * That is the whole vocabulary the assistant is asked to write in. It is not a
 * CommonMark implementation and does not try to be — no tables, no nesting, no
 * reference links, no HTML passthrough.
 *
 * It returns a token tree, never a string of HTML, so the renderer builds React
 * elements and there is no `dangerouslySetInnerHTML` anywhere in the path. An
 * unclosed `**` or a stray `<script>` is text, structurally.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Present only for http(s) and mailto links; anything else stays plain text. */
  href?: string;
}

export type Block =
  | { kind: "p"; spans: Span[] }
  | { kind: "h"; level: 1 | 2 | 3; spans: Span[] }
  | { kind: "ul"; items: Span[][] }
  | { kind: "ol"; items: Span[][]; start: number }
  | { kind: "code"; text: string; lang?: string }
  | { kind: "hr" };

/** Only schemes that cannot execute script. `javascript:` must never survive. */
function safeHref(raw: string): string | undefined {
  const url = raw.trim();
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(url) ? url : undefined;
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/;

/**
 * Split one line into styled spans. Emphasis does not nest — the first matching
 * marker wins and its contents are literal, which is what keeps this honest
 * about being a subset rather than silently mis-parsing.
 */
export function parseInline(line: string): Span[] {
  const spans: Span[] = [];
  let rest = line;

  while (rest.length > 0) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) {
      spans.push({ text: rest });
      break;
    }
    if (m.index > 0) spans.push({ text: rest.slice(0, m.index) });
    const token = m[0];

    if (token.startsWith("`")) {
      spans.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      spans.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      // A link we will not follow degrades to its label, never to a dead anchor.
      spans.push(href ? { text: label, href } : { text: label });
    } else {
      spans.push({ text: token.slice(1, -1), italic: true });
    }
    rest = rest.slice(m.index + token.length);
  }

  return spans.filter((s) => s.text.length > 0);
}

const H = /^(#{1,3})\s+(.*)$/;
const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HR = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s{0,3}```(\w*)\s*$/;

/** Parse a markdown document into renderable blocks. Never throws. */
export function parseMarkdown(source: string): Block[] {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "p", spans: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i++;
      // An unterminated fence runs to the end of the document rather than
      // swallowing the rest as a broken paragraph — this matters while the
      // reply is still streaming and the closing fence has not arrived.
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", text: body.join("\n"), lang: fence[1] || undefined });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      blocks.push({ kind: "hr" });
      continue;
    }

    const heading = H.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "h",
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2].trim()),
      });
      continue;
    }

    const bullet = UL.exec(line);
    if (bullet) {
      flushParagraph();
      const items: Span[][] = [parseInline(bullet[1])];
      while (i + 1 < lines.length) {
        const next = UL.exec(lines[i + 1]);
        if (!next) break;
        items.push(parseInline(next[1]));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    const numbered = OL.exec(line);
    if (numbered) {
      flushParagraph();
      const items: Span[][] = [parseInline(numbered[2])];
      while (i + 1 < lines.length) {
        const next = OL.exec(lines[i + 1]);
        if (!next) break;
        items.push(parseInline(next[2]));
        i++;
      }
      blocks.push({ kind: "ol", items, start: Number(numbered[1]) || 1 });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}
