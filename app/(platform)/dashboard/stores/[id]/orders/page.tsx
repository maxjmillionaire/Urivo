import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../../../_shell/app-shell";
import { loadRailStore } from "../../../_shell/rail-data";
import { listStoreOrders } from "@/lib/commerce/orders";
import { formatMoney } from "@/lib/commerce/types";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  paid: "border-live/30 bg-live/10 text-live",
  fulfilled: "border-gold/30 bg-gold/[0.08] text-gold-soft",
  pending: "border-hair-strong bg-white/[0.04] text-mist",
  cancelled: "border-alert/25 bg-alert/5 text-alert",
  refunded: "border-alert/25 bg-alert/5 text-alert",
};

export default async function StoreOrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: store } = await supabase
    .from("stores")
    .select("id, user_id, store_name, subdomain, stripe_charges_enabled")
    .eq("id", id)
    .maybeSingle();
  if (!store || store.user_id !== user.id) notFound();

  const [{ data: profile }, rail, orders] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", user.id).single(),
    loadRailStore(user.id),
    listStoreOrders(supabase, id),
  ]);

  const payoutsReady = (store as { stripe_charges_enabled?: boolean }).stripe_charges_enabled ?? false;
  const revenue = orders.filter((o) => o.status === "paid" || o.status === "fulfilled").reduce((s, o) => s + o.amountTotal, 0);

  return (
    <AppShell active="stores" email={profile?.email ?? user.email ?? null} store={rail}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">{store.store_name}</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Orders</h1>
        </div>
        <Link href={`/dashboard/stores/${id}`} className="u-lift rounded-lg border border-hair bg-panel px-4 py-2 text-xs font-medium text-ivory transition-colors hover:border-hair-strong">
          Back to store
        </Link>
      </header>

      {/* Payout readiness */}
      {!payoutsReady && (
        <div className="u-float mt-6 rounded-2xl border border-gold/25 bg-gold/[0.06] p-5">
          <p className="text-sm font-medium text-gold-soft">Payouts aren&apos;t connected yet</p>
          <p className="mt-1.5 text-xs leading-relaxed text-mist">
            Your storefront shows products, but it can only take real orders once you connect a Stripe account to receive
            payouts. Connecting takes a couple of minutes — set it up from Billing when Stripe goes live.
          </p>
        </div>
      )}

      {/* Summary */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Revenue</p>
          <p className="mt-2 text-[26px] font-semibold tabular-nums u-gold-text">{formatMoney(revenue)}</p>
          <p className="mt-1 text-[11px] text-mist-dim">paid &amp; fulfilled</p>
        </div>
        <div className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Orders</p>
          <p className="mt-2 text-[26px] font-semibold tabular-nums text-ivory">{orders.length}</p>
          <p className="mt-1 text-[11px] text-mist-dim">all time</p>
        </div>
        <div className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Items sold</p>
          <p className="mt-2 text-[26px] font-semibold tabular-nums text-ivory">{orders.reduce((s, o) => s + o.itemCount, 0)}</p>
          <p className="mt-1 text-[11px] text-mist-dim">across all orders</p>
        </div>
      </section>

      {/* Orders table / empty */}
      <section className="mt-8">
        {orders.length === 0 ? (
          <div className="u-float rounded-2xl border border-dashed border-hair-strong bg-panel/40 p-12 text-center">
            <p className="text-sm text-ivory">No orders yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-mist">
              When a customer completes checkout on your storefront, the order — customer, items and total — appears here in
              real time.
            </p>
          </div>
        ) : (
          <div className="u-float overflow-x-auto rounded-2xl border border-hair bg-panel/70">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hair bg-white/[0.02] text-[11px] font-semibold uppercase tracking-[0.1em] text-mist">
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Items</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {orders.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-6 py-4">
                      <span className="block text-ivory">{o.customerName || "—"}</span>
                      <span className="block text-[11px] text-mist-dim">{o.customerEmail || ""}</span>
                    </td>
                    <td className="px-6 py-4 tabular-nums text-mist">{o.itemCount}</td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLE[o.status] ?? STATUS_STYLE.pending}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-mist">{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-right font-mono tabular-nums text-ivory">{formatMoney(o.amountTotal, o.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
