"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";
import {
  IconHome,
  IconStore,
  IconResearch,
  IconMegaphone,
  IconEvolution,
  IconCard,
  IconSettings,
  IconHelp,
  IconMenu,
  IconClose,
} from "./icons";
import { AccountMenu, type Account } from "./account-menu";

/*
 * Left navigation — stable furniture across the product. Fixed on desktop;
 * on mobile it collapses behind a top bar and slides in as a drawer.
 */

export type NavKey = "home" | "research" | "stores" | "ads" | "evolution" | "billing" | "settings";

const NAV: { key: NavKey; label: string; href: string; Icon: typeof IconHome; hint?: string }[] = [
  { key: "home", label: "Home", href: "/dashboard", Icon: IconHome },
  { key: "research", label: "Research", href: "/dashboard/research", Icon: IconResearch, hint: "Find winning products and read the market" },
  { key: "stores", label: "Stores", href: "/dashboard#stores", Icon: IconStore },
  { key: "ads", label: "Ad Studio", href: "/dashboard/ads", Icon: IconMegaphone, hint: "Generate ad strategy and creative" },
  { key: "evolution", label: "Evolution Lab", href: "/dashboard/evolution", Icon: IconEvolution, hint: "Urivo generates a hundred storefronts and evolves the best one" },
  { key: "billing", label: "Billing", href: "/dashboard/billing", Icon: IconCard },
];

/*
 * Which nav row is current, read from the URL.
 *
 * It used to be a prop, which meant every page had to declare where it lived in
 * the navigation — and, more importantly, that the shell had to be rendered by
 * the page. Reading it here is what lets the shell move up into the layout and
 * simply stay put while pages come and go.
 */
function navKeyFor(pathname: string): NavKey | null {
  if (pathname === "/dashboard") return "home";
  if (pathname.startsWith("/dashboard/stores")) return "stores";
  if (pathname.startsWith("/dashboard/research")) return "research";
  if (pathname.startsWith("/dashboard/ads")) return "ads";
  if (pathname.startsWith("/dashboard/evolution")) return "evolution";
  if (pathname.startsWith("/dashboard/billing")) return "billing";
  if (pathname.startsWith("/dashboard/settings")) return "settings";
  return null;
}

export function AppSidebar({ account }: { account: Account }) {
  const pathname = usePathname();
  const active = navKeyFor(pathname ?? "");
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // A navigation closes the mobile drawer — otherwise the menu stays open on
  // top of the page it just took you to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /*
   * Lock body scroll while the drawer is open; close on Escape.
   *
   * Identical to the companion rail and the cart drawer — this was the one
   * overlay in the product without either, so on a phone the page scrolled
   * underneath the open navigation and Escape did nothing. Same pattern, same
   * cleanup, so the three drawers behave the same way.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const row = (key: NavKey | "support", label: string, href: string, Icon: typeof IconHome, hint?: string) => {
    const on = key === active;
    return (
      <Link
        key={key}
        href={href}
        onClick={close}
        title={hint}
        aria-current={on ? "page" : undefined}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors duration-200 ${
          on ? "bg-white/[0.05] font-medium text-ivory u-float" : "text-mist hover:bg-white/[0.035] hover:text-ivory"
        }`}
      >
        {on && (
          <span
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
            style={{ backgroundImage: "var(--grad-gold)" }}
          />
        )}
        <Icon className={on ? "text-gold" : "text-mist transition-colors group-hover:text-ivory"} />
        {label}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile top bar */}
      <div className="u-glass fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-hair px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2.5">
          <Image src={logo} alt="Urivo" width={26} height={26} className="rounded-lg" />
          <span className="text-[15px] font-semibold tracking-tight text-ivory">Urivo</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg border border-hair bg-panel p-2 text-ivory"
        >
          <IconMenu width={18} height={18} />
        </button>
      </div>

      {/* Drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-night/70 backdrop-blur-sm lg:hidden"
          onClick={close}
          aria-hidden
        />
      )}

      {/* Sidebar / drawer */}
      <aside
        className={`u-glass fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-hair transition-transform duration-300 ease-(--ease-urivo) lg:z-30 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 pb-6 pt-6">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="Urivo" width={34} height={34} className="rounded-[10px] u-float" />
            <span className="text-[17px] font-semibold tracking-tight text-ivory">Urivo</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="text-mist hover:text-ivory lg:hidden"
          >
            <IconClose width={18} height={18} />
          </button>
        </div>

        <nav className="mt-1 flex-1 space-y-1 px-3">
          {NAV.map(({ key, label, href, Icon, hint }) => row(key, label, href, Icon, hint))}
        </nav>

        <div className="space-y-0.5 px-3 pb-3">
          <a
            href="mailto:urivosupport@gmail.com"
            onClick={close}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] text-mist transition-colors hover:bg-white/[0.035] hover:text-ivory"
          >
            <IconHelp /> Support
          </a>
          {row("settings", "Settings", "/dashboard/settings", IconSettings)}
        </div>

        <AccountMenu account={account} />
      </aside>
    </>
  );
}
