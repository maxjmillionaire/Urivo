import { supabaseServer } from "@/lib/supabase/server";
import { canAskUrivo, entitledPlanKey } from "@/lib/plans";
import { getCreditBalance } from "@/lib/credits";
import { AppSidebar } from "./app-sidebar";
import { AppRail, type RailStore } from "./app-rail";
import { MobileRail } from "./mobile-rail";
import { NotificationBell } from "./notification-bell";
import { FeedbackButton } from "./feedback-button";
import { getNotifications, unreadCount } from "@/lib/notifications/service";
import type { Account } from "./account-menu";

/*
 * The stable product frame: fixed left nav, fixed right companion rail, a
 * scrolling core in between. Every app screen lives inside this shell so the
 * whole product reads as one connected surface.
 *
 * Rendered ONCE, by dashboard/layout.tsx — and that is the point.
 *
 * Each page used to render its own AppShell. Next keeps a layout mounted across
 * navigations between its children but re-renders a page completely, so with the
 * shell inside the page, every move between dashboard screens tore the whole
 * frame down: the sidebar was removed from the DOM and replaced, and
 * dashboard/loading.tsx (the full shell skeleton) filled the gap. Measured with
 * 250ms of database latency, a click from Home to Billing showed 21 shimmer bars
 * and zero navigation labels — the entire application blinked out and back.
 *
 * Now the shell is the layout: the sidebar, the rail and the account menu are
 * the same DOM nodes from one screen to the next, and only the content region
 * suspends. The active nav row is read from the URL inside AppSidebar, so no
 * page has to declare where it sits in the navigation.
 *
 * The shell also resolves the signed-in account itself (name, plan, avatar) so
 * the profile menu is consistent everywhere without each route threading it in.
 */
export async function AppShell({
  store,
  children,
}: {
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
    email: user?.email ?? null,
    plan: "free",
    avatarUrl: metaAvatar ?? null,
  };

  let credits = 0;
  let notifs: Awaited<ReturnType<typeof getNotifications>> = [];
  let unread = 0;

  if (user) {
    const [{ data: profile }, balance, notifList, unreadN] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, plan, subscription_status, comped_until")
        .eq("id", user.id)
        .single(),
      getCreditBalance(user.id).catch(() => 0),
      getNotifications(user.id).catch(() => []),
      unreadCount(user.id).catch(() => 0),
    ]);
    account = {
      name: profile?.full_name ?? metaName ?? null,
      email: profile?.email ?? user.email ?? null,
      plan: entitledPlanKey(profile),
      avatarUrl: metaAvatar ?? null,
    };
    credits = balance;
    notifs = notifList;
    unread = unreadN;
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
      <AppSidebar account={account} />
      <div className="relative lg:pl-[240px] lg:pr-[340px]">
        <div className="pointer-events-none absolute right-5 top-4 z-30 sm:right-8 lg:top-3">
          <div className="pointer-events-auto">
            <NotificationBell items={notifs} unread={unread} />
          </div>
        </div>
        <main id="main" className="mx-auto max-w-4xl px-5 pb-12 pt-20 sm:px-8 lg:pt-9">
          {children}
        </main>
      </div>
      <AppRail store={store} canAsk={canAskUrivo(account.plan)} credits={credits} plan={account.plan} />
      <MobileRail store={store} canAsk={canAskUrivo(account.plan)} credits={credits} plan={account.plan} />
      {/* Every screen, because the screen someone gets stuck on is the one worth hearing about. */}
      <FeedbackButton storeId={store?.id ?? null} />
    </div>
  );
}
