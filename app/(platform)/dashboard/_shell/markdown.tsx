import { Fragment } from "react";
import { parseMarkdown, type Span } from "@/lib/markdown";

/*
 * Renders an assistant reply's markdown as React elements.
 *
 * Elements, never HTML — there is no `dangerouslySetInnerHTML` here, so model
 * output cannot become markup no matter what it contains. The parser is a
 * documented subset (lib/markdown.ts); anything outside it stays as text.
 *
 * Sized for the rail: tight leading, small type, and generous space BETWEEN
 * blocks rather than inside them, so a structured answer stays scannable in a
 * narrow column.
 */

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: React.ReactNode = s.text;
        if (s.code) {
          node = (
            <code className="rounded bg-night px-[0.28em] py-[0.1em] font-mono text-[0.9em] text-gold-soft">
              {s.text}
            </code>
          );
        }
        if (s.bold) node = <strong className="font-semibold text-ivory">{node}</strong>;
        if (s.italic) node = <em className="italic">{node}</em>;
        if (s.href) {
          node = (
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold-soft underline decoration-gold/40 underline-offset-2 hover:decoration-gold"
            >
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const size = b.level === 1 ? "text-[14px]" : b.level === 2 ? "text-[13px]" : "text-[12px]";
            return (
              <p key={i} className={`${size} font-semibold text-ivory ${i > 0 ? "pt-1" : ""}`}>
                <Spans spans={b.spans} />
              </p>
            );
          }
          case "ul":
            return (
              <ul key={i} className="space-y-1.5">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-gold/70" />
                    <span className="min-w-0 flex-1">
                      <Spans spans={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="space-y-1.5">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden className="shrink-0 font-mono text-[11px] text-gold-soft">
                      {b.start + j}.
                    </span>
                    <span className="min-w-0 flex-1">
                      <Spans spans={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-lg border border-hair bg-night px-2.5 py-2 font-mono text-[11px] leading-relaxed text-cloud"
              >
                <code>{b.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} className="border-hair" />;
          default:
            return (
              <p key={i} className="leading-relaxed">
                <Spans spans={b.spans} />
              </p>
            );
        }
      })}
    </div>
  );
}
