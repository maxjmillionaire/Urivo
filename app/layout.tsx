import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urivo — The AI Commerce Operating System",
  description:
    "Research markets, build a premium brand, and launch a complete online store — with AI, in minutes. Founder pricing opens 23 July.",
};

export const viewport: Viewport = {
  themeColor: "#0B2416",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-forest-900 font-sans text-ivory-100 antialiased">
        {children}
      </body>
    </html>
  );
}
