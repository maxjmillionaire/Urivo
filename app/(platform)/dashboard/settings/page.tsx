import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "../_shell/app-shell";
import { loadRailStore } from "../_shell/rail-data";
import { PasswordForm, DeleteAccount } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, rail] = await Promise.all([
    supabase.from("profiles").select("email, full_name").eq("id", user.id).single(),
    loadRailStore(user.id),
  ]);

  const isEmailUser = user.app_metadata?.provider === "email";

  return (
    <AppShell active="settings" email={profile?.email ?? user.email ?? null} store={rail}>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Account</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Settings</h1>
      </header>

      <section className="u-float mt-7 rounded-2xl border border-hair bg-panel/70 p-6">
        <h2 className="text-lg font-semibold text-ivory">Profile</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between border-b border-hair pb-3">
            <dt className="text-mist">Name</dt>
            <dd className="font-medium text-ivory">{profile?.full_name ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mist">Email</dt>
            <dd className="font-medium text-ivory">{profile?.email ?? user.email}</dd>
          </div>
        </dl>
      </section>

      {isEmailUser && (
        <section className="u-float mt-6 rounded-2xl border border-hair bg-panel/70 p-6">
          <h2 className="text-lg font-semibold text-ivory">Password</h2>
          <div className="mt-4">
            <PasswordForm />
          </div>
        </section>
      )}

      <section className="u-float mt-6 rounded-2xl border border-alert/25 bg-alert/[0.04] p-6">
        <h2 className="text-lg font-semibold text-alert">Delete account</h2>
        <div className="mt-4">
          <DeleteAccount />
        </div>
      </section>
    </AppShell>
  );
}
