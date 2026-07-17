import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";
import {
  IconHome,
  IconStore,
  IconEvolution,
  IconMail,
  IconCard,
  IconSettings,
  IconHelp,
} from "./icons";

/*
 * Left navigation rail — stable furniture across the whole product.
 * Icon + label, gold indicator on the active row, quiet everything else.
 */

export type NavKey = "home" | "stores" | "evolution" | "emails" | "billing" | "settings";

const NAV: { key: NavKey; label: string; href: string; Icon: typeof IconHome }[] = [
  { key: "home", label: "Home", href: "/dashboard", Icon: IconHome },
  { key: "stores", label: "Stores", href: "/dashboard#stores", Icon: IconStore },
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
  return (
    <aside className="u-glass fixed inset-y-0 left-0 z-30 flex w-[240px] flex-col border-r border-hair">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <Image src={logo} alt="Urivo" width={34} height={34} className="rounded-[10px] u-float" />
        <span className="text-[17px] font-semibold tracking-tight text-ivory">Urivo</span>
      </div>

      {/* Primary nav */}
      <nav className="mt-1 flex-1 space-y-1 px-3">
        {NAV.map(({ key, label, href, Icon }) => {
          const on = key === active;
          return (
            <Link
              key={key}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors duration-200 ${
                on
                  ? "bg-white/[0.05] font-medium text-ivory u-float"
                  : "text-mist hover:bg-white/[0.035] hover:text-ivory"
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
        })}
      </nav>

      {/* Secondary */}
      <div className="space-y-0.5 px-3 pb-3">
        <Link
          href="/support"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-mist transition-colors hover:bg-white/[0.04] hover:text-ivory"
        >
          <IconHelp /> Support
        </Link>
        <Link
          href="/dashboard/settings"
          aria-current={active === "settings" ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
            active === "settings"
              ? "bg-panel-2 font-medium text-ivory"
              : "text-mist hover:bg-white/[0.04] hover:text-ivory"
          }`}
        >
          <IconSettings /> Settings
        </Link>
      </div>

      {/* User */}
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
  );
}
