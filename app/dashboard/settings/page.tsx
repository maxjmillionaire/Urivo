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
          className="text-sm font-medium text-muted transition-colors hover:text-ink"
        >
          ← Workspace
        </Link>
      </div>

      <header className="border-b border-line pb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Account
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
      </header>

      <section className="mt-10 rounded-lg border border-line bg-surface p-6 shadow-soft">
        <h2 className="text-xl font-semibold text-ink">Profile</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between border-b border-line pb-3">
            <dt className="text-muted">Name</dt>
            <dd className="font-medium text-ink">{profile?.full_name ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Email</dt>
            <dd className="font-medium text-ink">{profile?.email ?? user.email}</dd>
          </div>
        </dl>
      </section>

      {isEmailUser && (
        <section className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-soft">
          <h2 className="text-xl font-semibold text-ink">Password</h2>
          <div className="mt-4">
            <PasswordForm />
          </div>
        </section>
      )}

      <section className="mt-8 rounded-lg border border-error/20 bg-error/[0.03] p-6">
        <h2 className="text-xl font-semibold text-error">Delete account</h2>
        <div className="mt-4">
          <DeleteAccount />
        </div>
      </section>
    </main>
  );
}
