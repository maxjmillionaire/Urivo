import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConsentBanner } from "./consent-banner";

export const metadata: Metadata = {
  title: "Urivo — The AI Commerce Operating System",
  description:
    "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes. Founder pricing opens 23 July.",
};

export const viewport: Viewport = {
  themeColor: "#F8FAFC",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-canvas font-sans text-ink antialiased">
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}
