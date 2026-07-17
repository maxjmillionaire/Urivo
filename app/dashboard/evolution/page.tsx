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
          className="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          ← Workspace
        </Link>
      </div>

      <header>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Evolution Lab
          </p>
        </div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Watch intelligence evolve your store.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          Urivo doesn&apos;t generate one store — it generates a hundred, scores every
          one, and lets them evolve across generations until only the
          highest-performing storefront remains.
        </p>
      </header>

      <EvolutionLab />
    </main>
  );
}
