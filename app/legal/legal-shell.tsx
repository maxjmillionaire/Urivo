import Link from "next/link";

export function LegalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/50 transition-colors hover:text-ivory-100"
      >
        ← Urivo
      </Link>
      <h1 className="mt-8 font-serif text-4xl font-normal tracking-tight text-ivory-100">
        {title}
      </h1>
      <div className="mt-8 space-y-5 text-sm font-light leading-relaxed text-ivory-100/70 [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:text-ivory-100 [&_strong]:text-ivory-100">
        {children}
      </div>
    </main>
  );
}

/** Marker for content the founder / legal counsel must supply before launch. */
export function Placeholder({ note }: { note: string }) {
  return (
    <p className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-gold-300">
      To be completed before launch: {note}
    </p>
  );
}
