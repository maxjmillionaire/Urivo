"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";
import {
  IconHome,
  IconStore,
  IconResearch,
  IconMegaphone,
  IconEvolution,
  IconMail,
  IconCard,
  IconSettings,
  IconHelp,
  IconMenu,
  IconClose,
} from "./icons";

/*
 * Left navigation — stable furniture across the product. Fixed on desktop;
 * on mobile it collapses behind a top bar and slides in as a drawer.
 */

export type NavKey = "home" | "research" | "stores" | "ads" | "evolution" | "emails" | "billing" | "settings";

const NAV: { key: NavKey; label: string; href: string; Icon: typeof IconHome }[] = [
  { key: "home", label: "Home", href: "/dashboard", Icon: IconHome },
  { key: "research", label: "Research", href: "/dashboard/research", Icon: IconResearch },
  { key: "stores", label: "Stores", href: "/dashboard#stores", Icon: IconStore },
  { key: "ads", label: "Ad Studio", href: "/dashboard/ads", Icon: IconMegaphone },
  { key: "evolution", label: "Evolution Lab", href: "/dashboard/evolution", Icon: IconEvolution },
  { key: "emails", label: "Emails", href: "/dashboard/emails", Icon: IconMail },
  { key: "billing", label: "Billing", href: "/dashboard/billing", Icon: IconCard },
];

export function AppSidebar({
  active,
  email,
  avatarUrl,
}: {
  active: NavKey;
  email?: string | null;
  avatarUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const row = (key: NavKey | "support", label: string, href: string, Icon: typeof IconHome) => {
    const on = key === active;
    return (
      <Link
        key={key}
        href={href}
        onClick={close}
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
          {NAV.map(({ key, label, href, Icon }) => row(key, label, href, Icon))}
        </nav>

        <div className="space-y-0.5 px-3 pb-3">
          <Link
            href="/support"
            onClick={close}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] text-mist transition-colors hover:bg-white/[0.035] hover:text-ivory"
          >
            <IconHelp /> Support
          </Link>
          {row("settings", "Settings", "/dashboard/settings", IconSettings)}
        </div>

        <div className="flex items-center gap-3 border-t border-hair px-4 py-4">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navymark text-xs font-semibold text-gold-soft">
              {(email ?? "U").slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-xs text-mist">{email ?? "you@urivo.ai"}</span>
        </div>
      </aside>
    </>
  );
}
