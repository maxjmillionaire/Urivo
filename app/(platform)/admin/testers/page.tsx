import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { TesterConsole } from "./console";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Testers · Urivo (internal)",
  robots: { index: false, follow: false },
};

export default async function TestersPage() {
  // Authenticated AND on the admin allow-list. 404 rather than 403 so the route
  // is not discoverable by anyone who is not already an admin.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  return (
    <main className="min-h-screen bg-[#0b1220] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Internal</p>
            <h1 className="mt-1 text-3xl font-semibold">Testers</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/50">
              Granted access writes the real plan onto the account, so every gate, dashboard and
              billing screen behaves exactly as it would for a paying customer — which is the only
              way a test tells you anything. It expires by itself, and it will not touch an account
              that already pays.
            </p>
          </div>
          <div className="text-right text-xs">
            <Link href="/admin/feedback" className="text-amber-300/90 hover:text-amber-200">
              → Feedback inbox
            </Link>
            <br />
            <Link href="/admin/finance" className="text-amber-300/90 hover:text-amber-200">
              → Finance
            </Link>
          </div>
        </header>

        <TesterConsole />
      </div>
    </main>
  );
}
