import { AppSidebar, type NavKey } from "./app-sidebar";
import { AppRail, type RailStore } from "./app-rail";

/*
 * The stable product frame: fixed left nav, fixed right companion rail, a
 * scrolling core in between. Every app screen lives inside this shell so the
 * whole product reads as one connected surface.
 */
export function AppShell({
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
      <AppSidebar active={active} email={email} avatarUrl={avatarUrl} />
      <div className="relative pl-[240px] lg:pr-[340px]">
        <div className="u-enter mx-auto max-w-4xl px-8 py-9">{children}</div>
      </div>
      <AppRail store={store} />
    </div>
  );
}
