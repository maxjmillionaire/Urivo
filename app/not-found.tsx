import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        404
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-ink">
        This page does not exist.
      </h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
        The address may be wrong, or the store you are looking for is no longer
        active.
      </p>
      <Link
        href="/"
        className="mt-10 rounded-md bg-brand px-6 py-3 text-sm font-semibold text-white shadow-soft transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-brand-hover"
      >
        Back to Urivo
      </Link>
    </main>
  );
}
