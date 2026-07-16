import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: balance }] = await Promise.all([
    supabase.from("profiles").select("email, full_name, plan").eq("id", user.id).single(),
    supabase.rpc("credit_balance", { p_user_id: user.id }),
  ]);

  const planLabel =
    profile?.plan === "core" ? "Core" : profile?.plan === "pro" ? "Pro" : "Free";

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <header className="flex flex-col gap-6 border-b border-ivory-100/10 pb-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
            Merchant workspace
          </p>
          <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100">
            Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}
          </h1>
          <p className="mt-2 text-sm font-light text-ivory-100/60">
            {profile?.email ?? user.email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-ivory-100/15 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors duration-200 hover:border-ivory-100/30 hover:text-ivory-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-10 grid gap-6 sm:grid-cols-2">
        <div className="rounded-2xl border border-gold-500/20 bg-forest-950 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Credits
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-gold-300">
            {typeof balance === "number" ? balance : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-ivory-100/10 bg-ivory-100/5 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
            Plan
          </p>
          <p className="mt-3 font-serif text-4xl font-light text-ivory-100">
            {planLabel}
          </p>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-ivory-100/10 bg-ivory-100/5 p-10 text-center">
        <h2 className="font-serif text-2xl font-normal text-ivory-100">
          Your first store is one sentence away.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm font-light leading-relaxed text-ivory-100/60">
          The AI store generator arrives here next — describe your business and
          Urivo builds the brand, the catalog and the storefront.
        </p>
      </section>
    </main>
  );
}
