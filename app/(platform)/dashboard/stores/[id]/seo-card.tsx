import type { SeoAudit, SeoSeverity } from "@/lib/seo";

/*
 * SEO health for a store — deterministic, computed from the store's real
 * content. Honest by construction: it only reports what's actually on the page.
 */

const DOT: Record<SeoSeverity, string> = {
  pass: "bg-live",
  warn: "bg-gold",
  fail: "bg-alert",
};

function scoreTone(score: number): string {
  if (score >= 85) return "text-live";
  if (score >= 60) return "u-gold-text";
  return "text-alert";
}

export function SeoCard({ audit }: { audit: SeoAudit }) {
  return (
    <section className="u-float mt-8 rounded-2xl border border-hair bg-panel/70 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Search visibility</p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-ivory">SEO health</h2>
          <p className="mt-1 text-xs text-mist-dim">Structured data ships automatically; the rest is your content.</p>
        </div>
        <div className="text-right">
          <p className={`text-3xl font-semibold leading-none tabular-nums ${scoreTone(audit.score)}`}>{audit.score}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-mist-dim">/ 100</p>
        </div>
      </div>

      <ul className="mt-5 divide-y divide-hair">
        {audit.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} />
            <div>
              <p className="text-sm font-medium text-ivory">{c.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-mist">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
