import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "./_shell/app-shell";
import { loadRailStore } from "./_shell/rail-data";

/*
 * The dashboard layout — the reason the product frame stops flashing.
 *
 * Next keeps a layout mounted while navigating between its children and
 * re-renders only what changed. Every dashboard page used to render its own
 * AppShell, which put the navigation inside the part that changes: each click
 * tore down the sidebar, the companion rail and the account menu and let
 * loading.tsx paint the whole frame as shimmer before rebuilding it.
 *
 * Rendering the shell here makes the navigation genuinely persistent — the same
 * DOM nodes across every screen — and narrows loading.tsx to the content region
 * it was always meant to cover.
 *
 * The rail preview is loaded once here rather than in each page, which also
 * removes eight duplicate copies of the same query.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Middleware already redirects unauthenticated requests; this is the
  // belt-and-braces check so the shell never renders without an account.
  if (!user) redirect("/login");

  const rail = await loadRailStore(user.id);

  return <AppShell store={rail}>{children}</AppShell>;
}
