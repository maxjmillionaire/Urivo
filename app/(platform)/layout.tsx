import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@/app/globals.css";
import { ConsentBanner } from "./consent-banner";

/*
 * Root layout for Urivo's OWN product surfaces (marketing, auth, dashboard).
 * Generated merchant storefronts live under the separate (store) root layout and
 * deliberately inherit none of this — no Urivo theme, no Urivo consent banner.
 */
export const metadata: Metadata = {
  title: "Urivo — The AI Commerce Operating System",
  description:
    "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes. Founder pricing opens 23 July.",
};

export const viewport: Viewport = {
  themeColor: "#0B1220",
};

export default function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-night font-sans text-ivory antialiased">
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
