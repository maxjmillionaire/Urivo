import { supabaseServer } from "@/lib/supabase/server";
import { canAskUrivo } from "@/lib/plans";
import { AppSidebar, type NavKey } from "./app-sidebar";
import { AppRail, type RailStore } from "./app-rail";
import { MobileRail } from "./mobile-rail";
import type { Account } from "./account-menu";

/*
 * The stable product frame: fixed left nav, fixed right companion rail, a
 * scrolling core in between. Every app screen lives inside this shell so the
 * whole product reads as one connected surface.
 *
 * The shell resolves the signed-in account itself (name, plan, avatar) so the
 * profile menu is consistent on every page without each route threading it in.
 */
export async function AppShell({
  active,
  email,
  avatarUrl,
  store,
  children,
}: {
  active: NavKey;
  email?: string | null;
  avatarUrl?: string | null;
  store: RailStore | null;
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = (meta.full_name ?? meta.name) as string | undefined;
  const metaAvatar = (meta.avatar_url ?? meta.picture) as string | undefined;

  let account: Account = {
    name: metaName ?? null,
    email: email ?? user?.email ?? null,
    plan: "free",
    avatarUrl: avatarUrl ?? metaAvatar ?? null,
  };

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, plan")
      .eq("id", user.id)
      .single();
    account = {
      name: profile?.full_name ?? metaName ?? null,
      email: profile?.email ?? email ?? user.email ?? null,
      plan: profile?.plan ?? "free",
      avatarUrl: avatarUrl ?? metaAvatar ?? null,
    };
  }

  return (
    <div className="relative min-h-screen bg-night text-ivory">
      {/* ambient depth */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(90% 60% at 22% 0%, rgba(36,50,76,0.45), rgba(11,18,32,0) 60%), radial-gradient(70% 50% at 100% 100%, rgba(232,205,128,0.05), rgba(11,18,32,0) 55%)",
        }}
      />
      <AppSidebar active={active} account={account} />
      <div className="relative lg:pl-[240px] lg:pr-[340px]">
        <main id="main" className="u-enter mx-auto max-w-4xl px-5 pb-12 pt-20 sm:px-8 lg:pt-9">
          {children}
        </main>
      </div>
      <AppRail store={store} canAsk={canAskUrivo(account.plan)} />
      <MobileRail store={store} canAsk={canAskUrivo(account.plan)} />
    </div>
  );
}
