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
        {/* -my-2 py-2: the only way back from a legal page, sized for a thumb
            without moving the header. */}
        <Link
          href="/"
          className="-my-2 inline-flex items-center gap-2.5 py-2 text-sm font-medium text-mist transition-colors hover:text-ivory"
        >
          <Image src={logo} alt="Urivo" width={22} height={22} className="rounded-md" /> Urivo
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-ivory">{title}</h1>
        <div className="mt-8 space-y-5 text-sm leading-relaxed text-mist [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ivory [&_strong]:font-semibold [&_strong]:text-ivory [&_a]:text-gold-soft [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-gold">
          {children}
        </div>
      </div>
    </main>
  );
}
