import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-night px-6 text-center text-ivory">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(55% 40% at 50% 20%, rgba(232,205,128,0.08), rgba(11,18,32,0) 55%)" }}
      />
      <Image src={logo} alt="Urivo" width={56} height={56} className="relative rounded-[16px] u-float" />
      <p className="relative mt-8 text-xs font-semibold uppercase tracking-[0.3em] text-mist">404</p>
      <h1 className="relative mt-4 text-4xl font-semibold tracking-tight text-ivory">This page does not exist.</h1>
      <p className="relative mt-4 max-w-md text-sm leading-relaxed text-mist">
        The address may be wrong, or the store you are looking for is no longer active.
      </p>
      <Link href="/" className="u-gold u-lift relative mt-10 rounded-xl px-6 py-3 text-sm font-semibold">
        Back to Urivo
      </Link>
    </main>
  );
}
