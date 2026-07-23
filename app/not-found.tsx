import Link from "next/link";
import Image from "next/image";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import logo from "@/assets/brand/urivo-logo.png";

/*
 * Global 404 for any URL that matches no route in either group. Rendered under
 * the neutral root layout, so it returns a correct 404 status (unlike a catch-
 * all page, which resolves as a 200 match). Applies the Urivo theme locally on
 * its own container, keeping the root layout neutral for storefronts.
 */
export const metadata = { title: "Page not found — Urivo" };

export default function NotFound() {
  return (
    <main
      className={`${GeistSans.variable} ${GeistMono.variable} relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-night px-6 text-center font-sans text-ivory antialiased`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(55% 40% at 50% 20%, rgba(232,205,128,0.08), rgba(11,18,32,0) 55%)" }}
      />
      <Image src={logo} alt="Urivo" width={56} height={56} className="relative rounded-[16px] u-float" />
      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-mist">404</p>
      <h1 className="relative mt-4 text-4xl font-semibold tracking-tight text-ivory">This page does not exist.</h1>
      <p className="relative mt-4 max-w-md text-sm leading-relaxed text-mist">
        The address may be wrong, or the page you are looking for has moved.
      </p>
      <Link href="/" className="u-gold u-lift relative mt-10 rounded-xl px-6 py-3 text-sm font-semibold">
        Back to Urivo
      </Link>
    </main>
  );
}
