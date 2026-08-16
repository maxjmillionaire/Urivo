"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LOGO_POSITIONS, type StoreLogo, type LogoPosition } from "@/lib/storefront/design-system";
import { gpsrFormFrom, gpsrFormOf, type GpsrForm } from "@/lib/commerce/gpsr";
import { BrandNameStudio } from "./brand-name-studio";

/*
 * Merchant store management (screens-v1 §6): product CRUD table with an
 * add/edit modal, plus a theme editor slide-over. Optimistic where safe,
 * with rollback on failure. Dark Midnight theme.
 */

type Product = {
  id: string;
  title: string;
  description: string;
  priceEUR: number;
  inventoryCount: number;
  imageUrl: string | null;
  showLogo: boolean;
} & GpsrForm;

/*
 * GPSR Art. 19 (migration 0050) — the manufacturer block, the EU responsible
 * person, the product identifier and any warnings, which an EU listing has to
 * show before the sale. Empty string means "not supplied"; the API stores that
 * as NULL so there is one representation of missing across the stack. The shape
 * and the column mapping live in lib/commerce/gpsr.ts alongside the rule.
 */
const GPSR_FIELDS: [keyof GpsrForm, string, string][] = [
  ["manufacturerName", "Manufacturer", "Registered name or trademark"],
  ["manufacturerAddress", "Manufacturer address", "Street, postcode, city, country"],
  ["manufacturerEmail", "Manufacturer contact", "Email or web address"],
  ["euResponsibleName", "EU responsible person", "Required if the manufacturer is outside the EU"],
  ["euResponsibleAddress", "EU responsible address", "Street, postcode, city, country"],
  ["euResponsibleEmail", "EU responsible contact", "Email or web address"],
  ["productIdentifier", "Product identifier", "Type, batch or serial number"],
  ["safetyWarnings", "Safety information", "Warnings a buyer must read first"],
];

const EMPTY_GPSR: GpsrForm = gpsrFormFrom(null);

const POSITION_LABELS: Record<LogoPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  center: "Center",
};

type Theme = {
  storeName: string;
  tagline: string;
  background: string;
  structure: string;
  accent: string;
  isActive: boolean;
};

const HEX = /^#[0-9a-fA-F]{6}$/;

const inputClass =
  "w-full rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20";

export function StoreManager({
  storeId,
  initialProducts,
  initialTheme,
  initialLogo,
  canPublish = true,
}: {
  storeId: string;
  initialProducts: Product[];
  initialTheme: Theme;
  initialLogo: StoreLogo | null;
  canPublish?: boolean;
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenning, setRegenning] = useState<Set<string>>(new Set());
  const [logo, setLogo] = useState<StoreLogo | null>(initialLogo);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function uploadLogo(file: File) {
    setError(null);
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch(`/api/stores/${storeId}/logo`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Could not upload the logo.");
        return;
      }
      setLogo(data.logo);
      router.refresh();
    } catch {
      setError("Could not upload the logo. Please try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function updateLogo(patch: Partial<Pick<StoreLogo, "position" | "sizePct" | "opacity">>) {
    if (!logo) return;
    const next = { ...logo, ...patch };
    setLogo(next); // optimistic
    const res = await fetch(`/api/stores/${storeId}/logo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setLogo(logo);
      setError("Could not save the logo settings.");
    }
  }

  async function removeLogo() {
    if (!confirm("Remove the brand logo from your store?")) return;
    const snapshot = logo;
    setLogo(null);
    const res = await fetch(`/api/stores/${storeId}/logo`, { method: "DELETE" });
    if (!res.ok) {
      setLogo(snapshot);
      setError("Could not remove the logo.");
      return;
    }
    router.refresh();
  }

  async function toggleProductLogo(id: string, showLogo: boolean) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, showLogo } : p))); // optimistic
    const res = await fetch(`/api/products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showLogo }),
    });
    if (!res.ok) {
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, showLogo: !showLogo } : p)));
      setError("Could not update the logo toggle.");
    }
  }

  async function regenImage(id: string) {
    setError(null);
    setRegenning((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/products/${id}/image`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Could not generate an image.");
        return;
      }
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, imageUrl: data.imageUrl } : p)));
      router.refresh();
    } catch {
      setError("Could not generate an image. Please try again.");
    } finally {
      setRegenning((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function saveProduct(form: Omit<Product, "id" | "imageUrl" | "showLogo">, id?: string) {
    setError(null);
    const url = id ? `/api/products/${id}` : `/api/stores/${storeId}/products`;
    const res = await fetch(url, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Could not save the product.");
      return;
    }
    const saved: Product = {
      id: data.product.id,
      title: data.product.title,
      description: data.product.description,
      priceEUR: Number(data.product.price_eur),
      inventoryCount: data.product.inventory_count,
      imageUrl: id ? (products.find((p) => p.id === id)?.imageUrl ?? null) : null,
      showLogo: id ? (products.find((p) => p.id === id)?.showLogo ?? true) : true,
      // From the submitted form rather than the response: the create route does
      // not echo these columns back, and re-reading them is a round trip for
      // values we just sent.
      ...gpsrFormOf(form),
    };
    setProducts((prev) => (id ? prev.map((p) => (p.id === id ? saved : p)) : [...prev, saved]));
    setEditing(null);
    router.refresh();
  }

  async function deleteProduct(id: string) {
    if (!confirm("Remove this product?")) return;
    const snapshot = products;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setProducts(snapshot);
      setError("Could not remove the product.");
      return;
    }
    router.refresh();
  }

  async function saveTheme(next: Theme) {
    setError(null);
    const res = await fetch(`/api/stores/${storeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeName: next.storeName,
        tagline: next.tagline,
        background: next.background,
        structure: next.structure,
        accent: next.accent,
        isActive: next.isActive,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Could not save your changes.");
      return;
    }
    setTheme(next);
    setThemeOpen(false);
    router.refresh();
  }

  return (
    <>
      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
          {error}
        </p>
      )}

      {/* Design */}
      <section className="u-float mt-7 flex items-center justify-between rounded-2xl border border-hair bg-panel/70 p-5">
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {[theme.background, theme.structure, theme.accent].map((c) => (
              <span key={c} className="h-8 w-8 rounded-full border border-hair" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div>
            <p className="text-sm font-medium text-ivory">{theme.storeName}</p>
            <p className="text-xs text-mist-dim">
              {theme.tagline || "No tagline"} · {theme.isActive ? "Live" : canPublish ? "Paused" : "Draft"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setThemeOpen(true)}
          className="u-lift rounded-xl border border-hair bg-panel px-4 py-2.5 text-sm font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2"
        >
          Edit design
        </button>
      </section>

      {/* Brand name + real domain availability */}
      <BrandNameStudio storeId={storeId} currentName={theme.storeName} context={theme.tagline} />

      {/* Brand logo */}
      <section className="u-float mt-5 rounded-2xl border border-hair bg-panel/70 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ivory">Brand logo</p>
            <p className="mt-1 max-w-md text-xs text-mist-dim">
              Overlaid on your product photos, always pixel-perfect. Toggle it per product below.
            </p>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
              e.target.value = "";
            }}
          />
          {logo ? (
            <button
              type="button"
              onClick={removeLogo}
              className="shrink-0 text-sm font-semibold text-alert/80 transition-colors hover:text-alert active:opacity-60"
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={logoBusy}
              className="u-gold u-lift shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
            >
              {logoBusy ? "Uploading…" : "Upload logo"}
            </button>
          )}
        </div>

        {logo && (
          <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr]">
            {/* checkerboard preview */}
            <div
              className="flex h-28 w-28 items-center justify-center rounded-xl border border-hair"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#1a2540 25%,transparent 25%),linear-gradient(-45deg,#1a2540 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a2540 75%),linear-gradient(-45deg,transparent 75%,#1a2540 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                backgroundColor: "#0e1626",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.url} alt="Brand logo" className="max-h-20 max-w-20 object-contain" style={{ opacity: logo.opacity }} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">Position</span>
                <select
                  value={logo.position}
                  onChange={(e) => updateLogo({ position: e.target.value as LogoPosition })}
                  className={inputClass}
                >
                  {LOGO_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>{POSITION_LABELS[pos]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">Size · {logo.sizePct}%</span>
                <input
                  type="range"
                  min={6}
                  max={40}
                  step={1}
                  value={logo.sizePct}
                  onChange={(e) => updateLogo({ sizePct: Number(e.target.value) })}
                  className="mt-3 w-full accent-gold"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">Opacity · {Math.round(logo.opacity * 100)}%</span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={logo.opacity}
                  onChange={(e) => updateLogo({ opacity: Number(e.target.value) })}
                  className="mt-3 w-full accent-gold"
                />
              </label>
            </div>
          </div>
        )}
      </section>

      {/* Products */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-ivory">Products</h2>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="u-gold u-lift rounded-xl px-5 py-2.5 text-sm font-semibold"
          >
            + Add product
          </button>
        </div>

        {products.length === 0 ? (
          <p className="u-float mt-4 rounded-2xl border border-dashed border-hair-strong bg-panel/40 p-10 text-center text-sm text-mist">
            No products yet. Add your first one.
          </p>
        ) : (
          <div className="u-float mt-4 overflow-hidden rounded-2xl border border-hair bg-panel/70">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hair bg-white/[0.02] text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">
                  <th className="px-6 py-4">Image</th>
                  <th className="px-6 py-4">Product</th>
                  <th className="px-6 py-4">Price</th>
                  <th className="px-6 py-4">Stock</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {products.map((p) => {
                  const busy = regenning.has(p.id);
                  return (
                    <tr key={p.id} className="align-top transition-colors hover:bg-white/[0.02]">
                      <td className="px-6 py-4">
                        <div className="group relative h-16 w-16 overflow-hidden rounded-lg border border-hair bg-night">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-mist-dim">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <circle cx="9" cy="9" r="1.6" />
                                <path d="m21 15-5-5L5 21" />
                              </svg>
                            </div>
                          )}
                          {busy && (
                            <div className="absolute inset-0 flex items-center justify-center bg-night/60">
                              <span className="u-skel absolute inset-0" aria-hidden />
                              <span
                                className="relative h-2.5 w-2.5 rounded-full bg-gold"
                                style={{ animation: "urivo-live 1.4s ease-in-out infinite" }}
                                aria-label="Generating"
                              />
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => regenImage(p.id)}
                          disabled={busy}
                          className="mt-2 text-[11px] font-semibold text-gold-soft transition-colors hover:text-gold active:opacity-60 disabled:opacity-50"
                        >
                          {busy ? "Generating…" : p.imageUrl ? "Regenerate" : "Generate"}
                        </button>
                        {logo && (
                          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-mist" title="Overlay the brand logo on this product">
                            <input
                              type="checkbox"
                              checked={p.showLogo}
                              onChange={(e) => toggleProductLogo(p.id, e.target.checked)}
                              className="h-3.5 w-3.5 accent-gold"
                            />
                            Logo
                          </label>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-ivory">{p.title}</p>
                        <p className="mt-1 max-w-md text-xs text-mist-dim">{p.description}</p>
                      </td>
                      <td className="px-6 py-4 font-mono text-ivory">€{p.priceEUR.toFixed(2)}</td>
                      <td className="px-6 py-4 font-mono text-mist">{p.inventoryCount}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="text-sm font-semibold text-gold-soft transition-opacity hover:text-gold active:opacity-60"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProduct(p.id)}
                          className="ml-4 text-sm font-semibold text-alert/80 transition-opacity hover:text-alert active:opacity-60"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <ProductModal product={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={saveProduct} />
      )}
      {themeOpen && <ThemeEditor theme={theme} onClose={() => setThemeOpen(false)} onSave={saveTheme} canPublish={canPublish} />}
    </>
  );
}

function ProductModal({
  product,
  onClose,
  onSave,
}: {
  product: Product | null;
  onClose: () => void;
  onSave: (form: Omit<Product, "id" | "imageUrl" | "showLogo">, id?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.priceEUR) : "");
  const [stock, setStock] = useState(product ? String(product.inventoryCount) : "100");
  const [gpsr, setGpsr] = useState<GpsrForm>(() => ({
    ...EMPTY_GPSR,
    ...Object.fromEntries(GPSR_FIELDS.map(([key]) => [key, product?.[key] ?? ""])),
  }));
  /*
   * Collapsed by default, and opened automatically when the product already
   * carries safety information. The eight fields are legally required for EU
   * sales and irrelevant to a founder mid-flow adding their fourth product —
   * putting them in the main body would bury Price and Stock behind compliance.
   */
  const [showSafety, setShowSafety] = useState(() =>
    GPSR_FIELDS.some(([key]) => (product?.[key] ?? "").trim().length > 0),
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = Number(price);
    const stockNum = Number(stock);
    if (!title.trim() || !(priceNum > 0) || !Number.isInteger(stockNum) || stockNum < 0) return;
    setBusy(true);
    await onSave(
      {
        title: title.trim(),
        description: description.trim(),
        priceEUR: priceNum,
        inventoryCount: stockNum,
        ...gpsrFormOf(gpsr),
      },
      product?.id,
    );
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-6 backdrop-blur-sm">
      <div className="u-float w-full max-w-md rounded-2xl border border-hair bg-panel p-7">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold tracking-tight text-ivory">{product ? "Edit product" : "New product"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-mist hover:text-ivory">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Title">
            <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description">
            <textarea rows={3} maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} resize-none`} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (€)">
              <input type="number" step="0.01" min="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Stock">
              <input type="number" min="0" step="1" required value={stock} onChange={(e) => setStock(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="border-t border-hair pt-4">
            <button
              type="button"
              onClick={() => setShowSafety((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-[13px] font-medium text-ivory">Product &amp; safety information</span>
              <span className="text-[11px] text-mist-dim">{showSafety ? "Hide" : "Add"}</span>
            </button>
            <p className="mt-1 text-[11px] leading-relaxed text-mist-dim">
              Required for EU sales (GPSR). Shown on the product page. Leave blank
              if you don&apos;t have it yet — we will never fill it in for you.
            </p>
            {showSafety && (
              <div className="mt-4 space-y-3">
                {GPSR_FIELDS.map(([key, label, hint]) => (
                  <Field key={key} label={label}>
                    {key === "safetyWarnings" ? (
                      <textarea
                        rows={2}
                        maxLength={2000}
                        placeholder={hint}
                        value={gpsr[key]}
                        onChange={(e) => setGpsr((g) => ({ ...g, [key]: e.target.value }))}
                        className={`${inputClass} resize-none`}
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder={hint}
                        value={gpsr[key]}
                        onChange={(e) => setGpsr((g) => ({ ...g, [key]: e.target.value }))}
                        className={inputClass}
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </div>

          <button type="submit" disabled={busy} className="u-gold u-lift w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60">
            {busy ? "Saving…" : "Save product"}
          </button>
        </form>
      </div>
    </div>
  );
}

function ThemeEditor({
  theme,
  onClose,
  onSave,
  canPublish,
}: {
  theme: Theme;
  onClose: () => void;
  onSave: (next: Theme) => Promise<void>;
  canPublish: boolean;
}) {
  const [draft, setDraft] = useState<Theme>(theme);
  const [busy, setBusy] = useState(false);

  const invalid =
    draft.storeName.trim().length < 2 ||
    ![draft.background, draft.structure, draft.accent].every((c) => HEX.test(c));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    await onSave(draft);
    setBusy(false);
  }

  const swatch = (key: "background" | "structure" | "accent", label: string) => (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className="h-10 w-12 cursor-pointer rounded border border-hair bg-transparent"
        />
        <input
          type="text"
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className={`${inputClass} font-mono uppercase`}
        />
      </div>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-night/70 backdrop-blur-sm">
      <div className="u-float flex h-full w-full max-w-md flex-col border-l border-hair bg-panel p-7">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold tracking-tight text-ivory">Edit design</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-mist hover:text-ivory">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-6 flex-1 space-y-4 overflow-y-auto">
          <Field label="Store name">
            <input type="text" value={draft.storeName} onChange={(e) => setDraft({ ...draft, storeName: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Tagline">
            <textarea rows={2} maxLength={120} value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} className={`${inputClass} resize-none`} />
          </Field>
          {swatch("background", "Background")}
          {swatch("structure", "Text / structure")}
          {swatch("accent", "Accent")}
          {canPublish ? (
            <label className="flex items-center gap-3 pt-2 text-sm text-ivory">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                className="h-4 w-4 accent-gold"
              />
              Store is live
            </label>
          ) : (
            <div className="mt-2 rounded-xl border border-gold/25 bg-gold/[0.05] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Draft</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ivory">
                Publishing to a live urivo.ai address is available on Founder and Pro. You can
                preview and refine your store as much as you like.
              </p>
              <a
                href="/dashboard/billing"
                className="u-gold u-lift mt-3 inline-flex rounded-lg px-4 py-2 text-xs font-semibold"
              >
                Upgrade to publish
              </a>
            </div>
          )}
        </form>
        <button type="button" onClick={submit} disabled={busy || invalid} className="u-gold u-lift mt-6 w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">{label}</label>
      {children}
    </div>
  );
}
