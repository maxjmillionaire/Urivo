"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NAME_STYLES, type NameStyle } from "@/lib/naming/styles";

/*
 * Brand Name Studio — the collaborative naming flow. The founder can rename the
 * brand with a LIVE domain check, or explore fresh AI names in a chosen style
 * (Premium / Luxury / Minimal / Modern) and pick one — each shown with a real,
 * ownable domain. Regenerate returns genuinely new options. Honest by design: a
 * domain we can't verify is shown as "check availability", never as available.
 */

interface DomainResult {
  domain: string;
  tld: string;
  status: "available" | "taken" | "unknown";
}
interface DomainReport {
  label: string;
  results: DomainResult[];
  best: DomainResult | null;
}
interface Suggestion {
  name: string;
  rationale: string;
  subdomain: string | null;
  domain: DomainResult | null;
  ownable: boolean;
}

const STYLE_LABEL: Record<NameStyle, string> = {
  premium: "Premium",
  luxury: "Luxury",
  minimal: "Minimal",
  modern: "Modern",
};

export function BrandNameStudio({
  storeId,
  currentName,
  context,
}: {
  storeId: string;
  currentName: string;
  context?: string;
}) {
  const router = useRouter();
  const [savedName, setSavedName] = useState(currentName);
  const [draft, setDraft] = useState(currentName);
  const [savedDomain, setSavedDomain] = useState<DomainReport | null>(null);
  const [draftDomain, setDraftDomain] = useState<DomainReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState<NameStyle>("premium");
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDomain = useCallback(async (name: string): Promise<DomainReport | null> => {
    try {
      const res = await fetch(`/api/brand/domain?name=${encodeURIComponent(name)}`);
      if (!res.ok) return null;
      return (await res.json()) as DomainReport;
    } catch {
      return null;
    }
  }, []);

  // Domain of the saved brand name, on mount.
  useEffect(() => {
    let ok = true;
    fetchDomain(savedName).then((d) => ok && setSavedDomain(d));
    return () => {
      ok = false;
    };
  }, [savedName, fetchDomain]);

  // Live domain check as the founder edits the name (debounced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const name = draft.trim();
    if (name.length < 2 || name === savedName) {
      setDraftDomain(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    timer.current = setTimeout(async () => {
      const d = await fetchDomain(name);
      setDraftDomain(d);
      setChecking(false);
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, savedName, fetchDomain]);

  const saveName = useCallback(
    async (name: string) => {
      const next = name.trim();
      if (next.length < 2 || next === savedName || applying) return;
      setApplying(name);
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/stores/${storeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeName: next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.message || "Could not rename the brand.");
          return;
        }
        setSavedName(next);
        setDraft(next);
        setDraftDomain(null);
        router.refresh();
      } catch {
        setError("Could not rename the brand.");
      } finally {
        setSaving(false);
        setApplying(null);
      }
    },
    [storeId, savedName, applying, router],
  );

  const generate = useCallback(
    async (regen: boolean) => {
      if (generating) return;
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/brand/names", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `${savedName}${context ? ` — ${context}` : ""}`.slice(0, 400),
            style,
            avoid: regen ? seen : [],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.message || "Name ideas hit a snag. Please try again.");
          return;
        }
        const list = (data.suggestions ?? []) as Suggestion[];
        setSuggestions(list);
        setSeen((prev) => [...new Set([...prev, ...list.map((s) => s.name)])].slice(-40));
      } catch {
        setError("Name ideas hit a snag. Please try again.");
      } finally {
        setGenerating(false);
      }
    },
    [generating, savedName, context, style, seen],
  );

  return (
    <section className="u-float mt-5 rounded-2xl border border-hair bg-panel/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Brand name</h2>
        <span className="text-[11px] text-mist-dim">Own it globally</span>
      </div>

      {/* Rename with live domain check */}
      <div className="mt-4">
        <label className="text-[11px] font-medium text-mist">Your brand</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={60}
            className="min-w-0 flex-1 rounded-xl border border-hair bg-night px-4 py-2.5 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20"
            placeholder="Brand name"
          />
          <button
            onClick={() => saveName(draft)}
            disabled={saving || draft.trim().length < 2 || draft.trim() === savedName}
            className="u-gold u-press rounded-xl px-4 py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save name"}
          </button>
        </div>
        <div className="mt-2 min-h-[1.1rem]">
          {draft.trim() === savedName ? (
            <DomainLine report={savedDomain} prefix="" />
          ) : checking ? (
            <span className="text-[11px] text-mist-dim">Checking availability…</span>
          ) : (
            <DomainLine report={draftDomain} prefix="" />
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-[11px] text-alert" role="alert">{error}</p>}

      {/* Explore names in a style */}
      <div className="mt-5 border-t border-hair pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-mist">Explore stronger names</p>
          <div className="flex flex-wrap gap-1.5">
            {NAME_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={`u-press rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  style === s ? "border-gold/50 bg-gold/[0.08] text-gold-soft" : "border-hair bg-panel/60 text-cloud hover:border-hair-strong"
                }`}
              >
                {STYLE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => generate(false)}
            disabled={generating}
            className="u-lift flex-1 rounded-xl border border-gold/25 bg-gold/[0.05] px-4 py-2.5 text-xs font-semibold text-gold-soft hover:border-gold/40 disabled:opacity-50"
          >
            {generating && suggestions.length === 0 ? "Naming…" : `Generate ${STYLE_LABEL[style].toLowerCase()} names`}
          </button>
          {suggestions.length > 0 && (
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="u-press rounded-xl border border-hair bg-panel px-4 py-2.5 text-xs font-semibold text-ivory hover:border-hair-strong disabled:opacity-50"
            >
              {generating ? "…" : "More"}
            </button>
          )}
        </div>

        {suggestions.length > 0 && (
          <ul className="mt-3 space-y-2">
            {suggestions.map((s) => (
              <li
                key={s.name}
                className="u-msg-in flex items-center justify-between gap-3 rounded-xl border border-hair bg-night px-3.5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ivory">{s.name}</p>
                    <DomainBadge domain={s.domain} ownable={s.ownable} />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-mist-dim">{s.rationale}</p>
                </div>
                <button
                  onClick={() => saveName(s.name)}
                  disabled={saving || s.name === savedName}
                  className="u-press shrink-0 rounded-lg border border-hair bg-panel px-3 py-1.5 text-[11px] font-semibold text-gold-soft transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-40"
                >
                  {applying === s.name ? "…" : s.name === savedName ? "Current" : "Use"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* A domain availability badge for a single best-domain result. */
function DomainBadge({ domain, ownable }: { domain: DomainResult | null; ownable: boolean }) {
  if (ownable && domain) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-live/12 px-1.5 py-0.5 text-[10px] font-semibold text-live">
        <span className="h-1.5 w-1.5 rounded-full bg-live" />
        {domain.domain}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-mist-dim">
      check availability
    </span>
  );
}

/* The full domain line under the rename input (.com available · .ai available). */
function DomainLine({ report, prefix }: { report: DomainReport | null; prefix: string }) {
  if (!report || report.results.length === 0) return null;
  const avail = report.results.filter((r) => r.status === "available");
  const comTaken = report.results.find((r) => r.tld === "com" && r.status === "taken");

  if (avail.length > 0) {
    return (
      <span className="text-[11px] text-live">
        {prefix}
        <span className="font-semibold">{avail[0].domain}</span> is available
        {avail.length > 1 && <span className="text-mist-dim"> · +{avail.length - 1} more</span>}
      </span>
    );
  }
  if (comTaken) {
    return <span className="text-[11px] text-mist-dim">.com is taken — try a different name or extension</span>;
  }
  return <span className="text-[11px] text-mist-dim">Couldn&apos;t verify domains — check at your registrar</span>;
}
