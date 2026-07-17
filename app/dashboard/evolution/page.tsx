import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { EvolutionLab } from "./evolution-lab";

export const dynamic = "force-dynamic";

export const metadata = { title: "Evolution Lab — Urivo" };

export default async function EvolutionPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50 transition-colors hover:text-ivory-100"
        >
          ← Workspace
        </Link>
      </div>

      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
          Evolution Lab
        </p>
        <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100 sm:text-5xl">
          Watch intelligence evolve your store.
        </h1>
        <p className="mt-4 max-w-2xl text-sm font-light leading-relaxed text-ivory-100/60">
          Urivo doesn't generate one store — it generates a hundred, scores every
          one, and lets them evolve across generations until only the
          highest-performing storefront remains.
        </p>
      </header>

      <EvolutionLab />
    </main>
  );
}
