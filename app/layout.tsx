import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ConsentBanner } from "./consent-banner";

export const metadata: Metadata = {
  title: "Urivo — The AI Commerce Operating System",
  description:
    "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes. Founder pricing opens 23 July.",
};

export const viewport: Viewport = {
  themeColor: "#0B1220",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Body stays neutral-light until every page is migrated onto the dark shell,
  // which sets its own bg-night. Flipped to full dark at the end of the rollout.
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-canvas font-sans text-ink antialiased">
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
