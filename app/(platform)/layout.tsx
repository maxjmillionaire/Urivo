import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ConsentBanner } from "./consent-banner";
import { Toaster } from "./_ui/toast";

/*
 * Layout for Urivo's OWN product surfaces (marketing, auth, dashboard). The
 * <html>/<body> come from the neutral root layout; this wrapper applies the
 * Urivo theme (fonts, dark canvas, chrome) to a container div so generated
 * merchant storefronts under (store) inherit none of it — no Urivo theme, no
 * Urivo consent banner.
 */
const APP_URL = process.env.APP_URL ?? "https://urivo.ai";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Urivo — The AI Commerce Operating System",
    template: "%s — Urivo",
  },
  description:
    "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes. Founder pricing opens 23 July.",
  applicationName: "Urivo",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Urivo",
    title: "Urivo — The AI Commerce Operating System",
    description:
      "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Urivo — The AI Commerce Operating System",
    description:
      "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B1220",
};

export default function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`${GeistSans.variable} ${GeistMono.variable} min-h-screen bg-night font-sans text-ivory antialiased`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ivory focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-gold/50"
      >
        Skip to content
      </a>
      {children}
      <ConsentBanner />
      <Toaster />
    </div>
  );
}
