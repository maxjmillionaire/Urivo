"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Merchant store management (screens-v1 §6): product CRUD table with an
 * add/edit modal, plus a theme editor slide-over. Optimistic where safe,
 * with rollback on failure.
 */

type Product = {
  id: string;
  title: string;
  description: string;
  priceEUR: number;
  inventoryCount: number;
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

export function StoreManager({
  storeId,
  initialProducts,
  initialTheme,
}: {
  storeId: string;
  initialProducts: Product[];
  initialTheme: Theme;
}) {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveProduct(form: Omit<Product, "id">, id?: string) {
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
    };
    setProducts((prev) =>
      id ? prev.map((p) => (p.id === id ? saved : p)) : [...prev, saved],
    );
    setEditing(null);
    router.refresh();
  }

  async function deleteProduct(id: string) {
    if (!confirm("Remove this product?")) return;
    const snapshot = products;
    setProducts((prev) => prev.filter((p) => p.id !== id)); // optimistic
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setProducts(snapshot); // rollback
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
        <p
          role="alert"
          className="mt-8 rounded-md border border-error/20 bg-error/5 px-4 py-3 text-sm text-error"
        >
          {error}
        </p>
      )}

      {/* Design */}
      <section className="mt-10 flex items-center justify-between rounded-lg border border-line bg-surface p-6 shadow-soft">
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            {[theme.background, theme.structure, theme.accent].map((c) => (
              <span
                key={c}
                className="h-8 w-8 rounded-full border border-line"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div>
            <p className="text-sm font-medium text-ink">{theme.storeName}</p>
            <p className="text-xs text-muted">
              {theme.tagline || "No tagline"} · {theme.isActive ? "Live" : "Paused"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setThemeOpen(true)}
          className="rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
        >
          Edit design
        </button>
      </section>

      {/* Products */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">Products</h2>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover"
          >
            + Add product
          </button>
        </div>

        {products.length === 0 ? (
          <p className="mt-6 rounded-lg border border-line bg-surface p-10 text-center text-sm text-muted shadow-soft">
            No products yet. Add your first one.
          </p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                  <th className="px-6 py-4">Product</th>
                  <th className="px-6 py-4">Price</th>
                  <th className="px-6 py-4">Stock</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {products.map((p) => (
                  <tr key={p.id} className="align-top transition-colors hover:bg-surface-muted">
                    <td className="px-6 py-4">
                      <p className="font-medium text-ink">{p.title}</p>
                      <p className="mt-1 max-w-md text-xs text-muted">
                        {p.description}
                      </p>
                    </td>
                    <td className="px-6 py-4 font-mono text-ink">
                      €{p.priceEUR.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 font-mono text-muted">{p.inventoryCount}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="text-sm font-semibold text-brand hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteProduct(p.id)}
                        className="ml-4 text-sm font-semibold text-error/80 hover:text-error"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}
      {themeOpen && (
        <ThemeEditor theme={theme} onClose={() => setThemeOpen(false)} onSave={saveTheme} />
      )}
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
  onSave: (form: Omit<Product, "id">, id?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.priceEUR) : "");
  const [stock, setStock] = useState(product ? String(product.inventoryCount) : "100");
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
      },
      product?.id,
    );
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 shadow-lift">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-semibold tracking-tight text-ink">
            {product ? "Edit product" : "New product"}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Title">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              maxLength={400}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`${inputClass} resize-none`}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (€)">
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Stock">
              <input
                type="number"
                min="0"
                step="1"
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover disabled:translate-y-0 disabled:opacity-60"
          >
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
}: {
  theme: Theme;
  onClose: () => void;
  onSave: (next: Theme) => Promise<void>;
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
          className="h-10 w-12 cursor-pointer rounded border border-line bg-transparent"
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
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col border-l border-line bg-surface p-8 shadow-lift">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-semibold tracking-tight text-ink">Edit design</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="mt-6 flex-1 space-y-4 overflow-y-auto">
          <Field label="Store name">
            <input
              type="text"
              value={draft.storeName}
              onChange={(e) => setDraft({ ...draft, storeName: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Tagline">
            <textarea
              rows={2}
              maxLength={120}
              value={draft.tagline}
              onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
              className={`${inputClass} resize-none`}
            />
          </Field>
          {swatch("background", "Background")}
          {swatch("structure", "Text / structure")}
          {swatch("accent", "Accent")}
          <label className="flex items-center gap-3 pt-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            Store is live
          </label>
        </form>
        <button
          type="button"
          onClick={submit}
          disabled={busy || invalid}
          className="mt-6 w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover disabled:translate-y-0 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/15";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
