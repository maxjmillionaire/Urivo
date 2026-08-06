import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { FeedbackInbox } from "./inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Feedback · Urivo (internal)",
  robots: { index: false, follow: false },
};

export default async function FeedbackPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminEmail(user.email)) notFound();

  return (
    <main className="min-h-screen bg-[#0b1220] px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Internal</p>
            <h1 className="mt-1 text-3xl font-semibold">Feedback</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/50">
              Sent from inside the product, with the screen, the store and the plan already
              attached. The North Star is the share of merchants who reach a first real sale — this
              is the record of where that path breaks.
            </p>
          </div>
          <div className="text-right text-xs">
            <Link href="/admin/testers" className="text-amber-300/90 hover:text-amber-200">
              → Testers
            </Link>
            <br />
            <Link href="/admin/finance" className="text-amber-300/90 hover:text-amber-200">
              → Finance
            </Link>
          </div>
        </header>

        <FeedbackInbox />
      </div>
    </main>
  );
}
