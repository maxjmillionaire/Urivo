import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { PasswordForm, DeleteAccount } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", user.id)
    .single();

  const isEmailUser = user.app_metadata?.provider === "email";

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <div className="mb-10">
        <Link
          href="/dashboard"
          className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50 transition-colors hover:text-ivory-100"
        >
          ← Workspace
        </Link>
      </div>

      <header className="border-b border-ivory-100/10 pb-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
          Account
        </p>
        <h1 className="mt-3 font-serif text-4xl font-normal tracking-tight text-ivory-100">
          Settings
        </h1>
      </header>

      <section className="mt-10">
        <h2 className="font-serif text-xl text-ivory-100">Profile</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between border-b border-ivory-100/5 pb-3">
            <dt className="font-light text-ivory-100/50">Name</dt>
            <dd className="text-ivory-100/90">{profile?.full_name ?? "—"}</dd>
          </div>
          <div className="flex justify-between border-b border-ivory-100/5 pb-3">
            <dt className="font-light text-ivory-100/50">Email</dt>
            <dd className="text-ivory-100/90">{profile?.email ?? user.email}</dd>
          </div>
        </dl>
      </section>

      {isEmailUser && (
        <section className="mt-12">
          <h2 className="font-serif text-xl text-ivory-100">Password</h2>
          <div className="mt-4">
            <PasswordForm />
          </div>
        </section>
      )}

      <section className="mt-12 rounded-2xl border border-danger-dark/20 bg-danger-dark/[0.04] p-6">
        <h2 className="font-serif text-xl text-danger-dark">Delete account</h2>
        <div className="mt-4">
          <DeleteAccount />
        </div>
      </section>
    </main>
  );
}
