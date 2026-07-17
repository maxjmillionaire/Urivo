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
        className="text-sm font-medium text-muted transition-colors hover:text-ink"
      >
        ← Urivo
      </Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight text-ink">
        {title}
      </h1>
      <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_strong]:font-semibold [&_strong]:text-ink">
        {children}
      </div>
    </main>
  );
}

/** Marker for content the founder / legal counsel must supply before launch. */
export function Placeholder({ note }: { note: string }) {
  return (
    <p className="rounded-md border border-gold/30 bg-gold-tint px-4 py-3 text-[#8a6d18]">
      To be completed before launch: {note}
    </p>
  );
}
