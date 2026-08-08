import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ProfileForm, EmailForm, NotificationsForm, PasswordForm, DeleteAccount } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }] = await Promise.all([
    supabase.from("profiles").select("email, full_name, marketing_opt_in").eq("id", user.id).single(),
  ]);

  const isEmailUser = user.app_metadata?.provider === "email";
  const currentEmail = profile?.email ?? user.email ?? "";
  const marketingOptIn = (profile as { marketing_opt_in?: boolean } | null)?.marketing_opt_in ?? true;

  return (
    <>
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Account</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ivory">Settings</h1>
      </header>

      <section className="u-float mt-7 rounded-2xl border border-hair bg-panel/70 p-6">
        <h2 className="text-lg font-semibold text-ivory">Profile</h2>
        <div className="mt-4">
          <ProfileForm initialName={profile?.full_name ?? ""} />
        </div>
      </section>

      <section className="u-float mt-6 rounded-2xl border border-hair bg-panel/70 p-6">
        <h2 className="text-lg font-semibold text-ivory">Email address</h2>
        <div className="mt-4">
          <EmailForm currentEmail={currentEmail} />
        </div>
      </section>

      <section className="u-float mt-6 rounded-2xl border border-hair bg-panel/70 p-6">
        <h2 className="text-lg font-semibold text-ivory">Notifications</h2>
        <div className="mt-4">
          <NotificationsForm initialOptIn={marketingOptIn} />
        </div>
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
    </>
  );
}
