import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
        404
      </p>
      <h1 className="mt-4 font-serif text-4xl font-normal tracking-tight text-ivory-100">
        This page does not exist.
      </h1>
      <p className="mt-4 max-w-md text-sm font-light leading-relaxed text-ivory-100/60">
        The address may be wrong, or the store you are looking for is no longer
        active.
      </p>
      <Link
        href="/"
        className="mt-10 rounded-lg bg-gold-500 px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne"
      >
        Back to Urivo
      </Link>
    </main>
  );
}
