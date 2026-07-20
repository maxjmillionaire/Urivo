import Link from "next/link";
import { IconGlobe } from "./icons";
import { AskUrivo } from "./ask-urivo";

/*
 * Persistent companion rail — the product's spine. A live preview of the
 * merchant's store sits above an always-present "Ask Urivo" command bar, so
 * the output and the agent are visible on every screen.
 */

export interface RailStore {
  id: string;
  name: string;
  subdomain: string;
  tagline?: string;
  isLive: boolean;
  palette: { background: string; structure: string; accent: string };
  products?: { title: string; priceEUR: number }[];
}

export function AppRail({
  store,
  canAsk = true,
  outOfCredits = false,
  plan,
}: {
  store: RailStore | null;
  canAsk?: boolean;
  outOfCredits?: boolean;
  plan?: string | null;
}) {
  return (
    <aside className="u-glass fixed inset-y-0 right-0 z-20 hidden w-[340px] flex-col border-l border-hair lg:flex">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pb-4 pt-6">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">
            Live preview
          </span>
          {store?.isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-live/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-live">
              <span className="h-1.5 w-1.5 rounded-full bg-live" /> Live
            </span>
          )}
        </div>
        {store && (
          <span className="font-mono text-[10px] text-mist-dim">{store.subdomain}.urivo.ai</span>
        )}
      </div>

      {/* Preview */}
      <div className="px-5">
        {store ? (
          <StorePreview store={store} />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-hair-strong bg-night px-6 text-center">
            <IconGlobe className="text-mist-dim" width={22} height={22} />
            <p className="mt-3 text-sm font-medium text-ivory">No live store yet</p>
            <p className="mt-1 text-xs leading-relaxed text-mist">
              Generate your first store and it will appear here, live.
            </p>
          </div>
        )}

        {/* Contextual actions */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {store ? (
            <>
              <a
                href={`https://${store.subdomain}.urivo.ai`}
                target="_blank"
                rel="noreferrer"
                className="u-lift rounded-lg border border-hair bg-panel px-3 py-2 text-center text-xs font-medium text-ivory transition-colors hover:border-hair-strong hover:bg-panel-2 active:scale-[0.98]"
              >
                View live
              </a>
              <Link
                href={`/dashboard/stores/${store.id}`}
                className="u-gold u-lift rounded-lg px-3 py-2 text-center text-xs font-semibold transition-transform hover:u-glow-gold active:scale-[0.98]"
              >
                Manage
              </Link>
            </>
          ) : (
            <>
              <button disabled className="col-span-2 rounded-lg border border-hair bg-panel px-3 py-2 text-xs font-medium text-mist-dim opacity-60">
                No store to preview yet
              </button>
            </>
          )}
        </div>
      </div>

      {/* Ask Urivo — interactive, grounded conversation + live editing */}
      <AskUrivo hasStore={!!store} storeId={store?.id ?? null} canAsk={canAsk} outOfCredits={outOfCredits} plan={plan} />
    </aside>
  );
}

function StorePreview({ store }: { store: RailStore }) {
  const { palette } = store;
  const products = store.products ?? [];
  return (
    <div className="u-float overflow-hidden rounded-xl border border-hair bg-panel">
      {/* browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-hair/60 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-alert/70" />
        <span className="h-2 w-2 rounded-full bg-gold/70" />
        <span className="h-2 w-2 rounded-full bg-live/70" />
        <span className="ml-2 truncate font-mono text-[9px] text-mist-dim">
          {store.subdomain}.urivo.ai
        </span>
      </div>
      {/* mini storefront */}
      <div className="max-h-[240px] overflow-hidden" style={{ backgroundColor: palette.background }}>
        <div className="px-4 pt-4" style={{ color: palette.structure }}>
          <div className="flex items-center justify-between">
            <span className="text-[7px] font-semibold uppercase tracking-[0.2em] opacity-60">Shop all</span>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.accent }} />
          </div>
          <p className="mt-4 text-[7px] font-semibold uppercase tracking-[0.2em] opacity-50">New collection</p>
          <h4 className="mt-1 text-2xl font-semibold leading-none tracking-tight">{store.name}</h4>
          {store.tagline && (
            <p className="mt-1.5 text-[9px] italic opacity-70">{store.tagline}</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2 pb-4">
            {(products.length ? products.slice(0, 4) : [0, 1, 2, 3]).map((p, i) => (
              <div
                key={i}
                className="rounded-md p-2"
                style={{ backgroundColor: `${palette.structure}12` }}
              >
                <div className="aspect-[4/3] rounded" style={{ backgroundColor: `${palette.structure}18` }} />
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="h-1 w-8 rounded-full" style={{ backgroundColor: `${palette.structure}40` }} />
                  <span className="text-[8px] font-medium" style={{ color: palette.accent }}>
                    {typeof p === "object" ? `€${p.priceEUR}` : "€—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
