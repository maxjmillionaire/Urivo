import Link from "next/link";
import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";

export function LegalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen bg-night text-ivory">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 40% at 50% 0%, rgba(36,50,76,0.4), rgba(11,18,32,0) 55%)" }}
      />
      <div className="relative mx-auto w-full max-w-2xl px-6 py-16">
        <Link href="/" className="inline-flex items-center gap-2.5 text-sm font-medium text-mist transition-colors hover:text-ivory">
          <Image src={logo} alt="Urivo" width={22} height={22} className="rounded-md" /> Urivo
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-ivory">{title}</h1>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-mist [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ivory [&_strong]:font-semibold [&_strong]:text-ivory">
          {children}
        </div>
      </div>
    </main>
  );
}

/** Marker for content the founder / legal counsel must supply before launch. */
export function Placeholder({ note }: { note: string }) {
  return (
    <p className="rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-gold-soft">
      To be completed before launch: {note}
    </p>
  );
}
