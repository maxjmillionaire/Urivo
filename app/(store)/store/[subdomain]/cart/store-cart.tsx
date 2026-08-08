"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/commerce/types";

/*
 * Storefront cart — client state persisted per store in localStorage. Stores a
 * lightweight display snapshot (title, price, image); the SERVER re-validates
 * every price at checkout, so this is presentation only and safe to keep client
 * side. All UI here inherits the merchant's design tokens (--accent, --ink,
 * --surface, --radius, --font-b) because it renders inside #uv-store — so the
 * cart looks like the merchant's brand, never Urivo.
 */

export interface CartLine {
  productId: string;
  title: string;
  priceCents: number;
  image: string | null;
  quantity: number;
}

interface CartCtx {
  lines: CartLine[];
  count: number;
  subtotal: number;
  currency: string;
  add: (line: Omit<CartLine, "quantity">, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** False when the merchant has no working payout account yet. */
  canSell: boolean;
}

const Ctx = createContext<CartCtx | null>(null);
const MAX_QTY = 20;

export function useCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart must be used within StoreCartProvider");
  return ctx;
}

export function StoreCartProvider({
  subdomain,
  currency,
  children,
  canSell = true,
}: {
  subdomain: string;
  currency: string;
  children: React.ReactNode;
  canSell?: boolean;
}) {
  const storageKey = `uv-cart:${subdomain}`;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setLines(JSON.parse(raw));
    } catch {
      /* ignore corrupt cart */
    }
    setHydrated(true);
  }, [storageKey]);

  // Persist on change (after hydration, so we never clobber with []).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      /* storage full / blocked */
    }
  }, [lines, hydrated, storageKey]);

  const add = useCallback((line: Omit<CartLine, "quantity">, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === line.productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === line.productId ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + qty) } : l,
        );
      }
      return [...prev, { ...line, quantity: Math.min(MAX_QTY, qty) }];
    });
    setOpen(true);
  }, []);

  const setQty = useCallback((productId: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((l) => l.productId !== productId)
        : prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(MAX_QTY, qty) } : l)),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartCtx>(() => {
    const count = lines.reduce((s, l) => s + l.quantity, 0);
    const subtotal = lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
    return { lines, count, subtotal, currency, add, setQty, remove, clear, open, setOpen, canSell };
  }, [lines, currency, add, setQty, remove, clear, open, canSell]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <CartDrawer subdomain={subdomain} />
    </Ctx.Provider>
  );
}

/* --------------------------------- pieces --------------------------------- */

export function AddToCart({
  product,
  label = "Add to cart",
  className = "uv-btn",
  style,
}: {
  product: { productId: string; title: string; priceCents: number; image: string | null };
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={`Add ${product.title} to cart`}
      onClick={() => {
        add(product);
        setAdded(true);
        setTimeout(() => setAdded(false), 1100);
      }}
    >
      {added ? "Added ✓" : label}
    </button>
  );
}

export function BuyBox({
  product,
}: {
  product: { productId: string; title: string; priceCents: number; image: string | null };
}) {
  const { add } = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
      <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: "var(--btn-radius)" }}>
        <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))} style={stepStyle}>–</button>
        <span style={{ minWidth: "2.5ch", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{qty}</span>
        <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(20, q + 1))} style={stepStyle}>+</button>
      </div>
      <button
        type="button"
        className="uv-btn"
        style={{ flex: 1, minWidth: "12rem" }}
        onClick={() => {
          add(product, qty);
          setAdded(true);
          setTimeout(() => setAdded(false), 1200);
        }}
      >
        {added ? "Added ✓" : "Add to cart"}
      </button>
    </div>
  );
}

const stepStyle: React.CSSProperties = {
  width: "2.6rem",
  height: "2.8rem",
  display: "grid",
  placeItems: "center",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--ink)",
  fontSize: "1.1rem",
};

export function CartButton({ className }: { className?: string }) {
  const { count, setOpen } = useCart();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={className ?? "uv-navlink"}
      aria-label={`Open cart, ${count} item${count === 1 ? "" : "s"}`}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: ".45rem", background: "none", border: "none", cursor: "pointer", font: "inherit", color: "inherit" }}
    >
      <span>Cart</span>
      <span
        aria-hidden
        style={{
          minWidth: "1.35em",
          height: "1.35em",
          padding: "0 .4em",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "999px",
          fontSize: ".7em",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          background: count > 0 ? "var(--accent)" : "transparent",
          color: count > 0 ? "var(--accent-ink)" : "var(--muted)",
          border: count > 0 ? "none" : "1px solid var(--line)",
          transition: "background .2s ease, color .2s ease",
        }}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * The visit beacon's anonymous session id, if this browser has one.
 *
 * Read, never written: the beacon owns it. This is what joins a sale back to
 * the ad that produced the click — no cookie, no new tracking, and it dies
 * with the tab.
 */

function CartDrawer({ subdomain }: { subdomain: string }) {
  const { lines, count, subtotal, currency, setQty, remove, open, setOpen, canSell } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while open; close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, setOpen]);

  async function checkout() {
    if (checkingOut || lines.length === 0) return;
    setError(null);
    setCheckingOut(true);
    try {
      const res = await fetch(`/api/store/${subdomain}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          // The same anonymous session id the visit beacon uses. It is what
          // lets the sale be joined back to the ad that produced the click —
          // read here rather than stored, so nothing new is tracked.
          }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data?.message || "Checkout isn't available right now.");
    } catch {
      setError("Something interrupted checkout. Please try again.");
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <>
      {/* scrim */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          background: "rgba(0,0,0,.42)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity .35s var(--ease-uv, cubic-bezier(.16,1,.3,1))",
        }}
      />
      {/* panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 81,
          width: "min(420px, 92vw)",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface, #fff)",
          color: "var(--ink)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "-24px 0 60px -30px rgba(0,0,0,.5)",
          transform: open ? "translateX(0)" : "translateX(101%)",
          transition: "transform .42s var(--ease-uv, cubic-bezier(.16,1,.3,1))",
          fontFamily: "var(--font-b)",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.35rem 1.5rem", borderBottom: "1px solid var(--line)" }}>
          <span className="uv-h" style={{ fontSize: "1.1rem" }}>Your cart{count > 0 ? ` · ${count}` : ""}</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close cart" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "1.4rem", lineHeight: 1 }}>×</button>
        </header>

        {lines.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ".7rem", padding: "2rem", textAlign: "center" }}>
            <span aria-hidden style={{ fontSize: "2rem", opacity: 0.5 }}>◍</span>
            <p style={{ fontWeight: 600 }}>Your cart is empty</p>
            <p style={{ color: "var(--muted)", fontSize: ".9rem", maxWidth: "26ch" }}>Add something you love — it&apos;ll show up here.</p>
            <button type="button" onClick={() => setOpen(false)} className="uv-btn" style={{ marginTop: ".6rem" }}>Continue shopping</button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {lines.map((l) => (
                <div key={l.productId} style={{ display: "flex", gap: ".9rem", alignItems: "flex-start" }}>
                  <div style={{ width: 60, height: 72, borderRadius: "calc(var(--radius) * .6)", overflow: "hidden", flexShrink: 0, background: "var(--bg)" }}>
                    {l.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: ".92rem" }}>{l.title}</p>
                    <p style={{ color: "var(--muted)", fontSize: ".82rem", marginTop: ".15rem" }}>{formatMoney(l.priceCents, currency)}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: ".6rem", marginTop: ".55rem" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: "calc(var(--radius) * .5)" }}>
                        <Stepper label="Decrease quantity" onClick={() => setQty(l.productId, l.quantity - 1)}>–</Stepper>
                        <span style={{ minWidth: "2ch", textAlign: "center", fontSize: ".85rem", fontVariantNumeric: "tabular-nums" }}>{l.quantity}</span>
                        <Stepper label="Increase quantity" onClick={() => setQty(l.productId, l.quantity + 1)}>+</Stepper>
                      </div>
                      <button type="button" onClick={() => remove(l.productId)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: ".78rem", textDecoration: "underline", textUnderlineOffset: "3px" }}>Remove</button>
                    </div>
                  </div>
                  <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: ".9rem" }}>{formatMoney(l.priceCents * l.quantity, currency)}</span>
                </div>
              ))}
            </div>

            <footer style={{ borderTop: "1px solid var(--line)", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: ".9rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "var(--muted)", fontSize: ".9rem" }}>Subtotal</span>
                <span className="uv-h" style={{ fontSize: "1.3rem", fontVariantNumeric: "tabular-nums" }}>{formatMoney(subtotal, currency)}</span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: ".76rem" }}>Taxes and shipping calculated at checkout.</p>
              {error && <p role="alert" style={{ color: "#c0392b", fontSize: ".82rem" }}>{error}</p>}
              {/*
                A store that cannot charge shows why, here, instead of firing a
                request that comes back 503 after the shopper has committed.
              */}
              {!canSell ? (
                <div
                  role="status"
                  style={{
                    width: "100%",
                    padding: ".85rem 1rem",
                    borderRadius: "var(--btn-radius)",
                    border: "var(--border-w) solid var(--line)",
                    background: "var(--surface)",
                    textAlign: "center",
                    fontSize: ".82rem",
                    lineHeight: 1.5,
                    color: "var(--muted)",
                  }}
                >
                  <strong style={{ display: "block", color: "var(--ink)", fontSize: ".86rem" }}>
                    Ordering isn&apos;t open yet
                  </strong>
                  This store is finishing its payment setup. Your bag is saved.
                </div>
              ) : (
              <button type="button" className="uv-btn" onClick={checkout} disabled={checkingOut} style={{ width: "100%", opacity: checkingOut ? 0.7 : 1, cursor: checkingOut ? "wait" : "pointer" }}>
                {checkingOut ? "Taking you to checkout…" : "Checkout"}
              </button>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

function Stepper({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ width: "2rem", height: "2rem", display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--ink)", fontSize: "1rem", lineHeight: 1 }}
    >
      {children}
    </button>
  );
}
