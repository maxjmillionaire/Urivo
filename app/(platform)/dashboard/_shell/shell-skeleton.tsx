import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";

/*
 * In-shell loading state — the frame stays, content shimmers in. Never a bare
 * spinner; the product feels present while data resolves.
 */
const bar = (w: string, h = "h-3") => <div className={`u-skel rounded-md ${h} ${w}`} />;

export function ShellSkeleton() {
  return (
    <div className="relative min-h-screen bg-night text-ivory">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(90% 60% at 22% 0%, rgba(36,50,76,0.4), rgba(11,18,32,0) 60%)" }}
      />

      {/* Sidebar */}
      <aside className="u-glass fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-hair lg:flex">
        <div className="flex items-center gap-3 px-5 pb-6 pt-6">
          <Image src={logo} alt="" width={34} height={34} className="rounded-[10px] opacity-90" />
          <span className="text-[17px] font-semibold tracking-tight text-ivory">Urivo</span>
        </div>
        <div className="mt-1 space-y-2 px-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5">
              <div className="u-skel h-4 w-4 rounded" />
              {bar(i === 0 ? "w-16" : "w-24")}
            </div>
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="relative lg:pl-[240px] lg:pr-[340px]">
        <div className="mx-auto max-w-4xl px-5 pb-12 pt-20 sm:px-8 lg:pt-9">
          <div className="flex items-center justify-between">
            <div className="space-y-2.5">{bar("w-52", "h-6")}{bar("w-40")}</div>
            <div className="u-skel h-9 w-32 rounded-lg" />
          </div>
          <div className="u-skel mt-7 h-24 rounded-2xl" />
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_264px]">
            <div className="u-skel h-56 rounded-2xl" />
            <div className="u-skel h-56 rounded-2xl" />
          </div>
          <div className="u-skel mt-8 h-40 rounded-2xl" />
        </div>
      </div>

      {/* Rail */}
      <aside className="u-glass fixed inset-y-0 right-0 z-20 hidden w-[340px] flex-col gap-4 border-l border-hair p-5 lg:flex">
        <div className="u-skel h-4 w-28 rounded" />
        <div className="u-skel h-64 rounded-xl" />
        <div className="grid grid-cols-2 gap-2">
          <div className="u-skel h-9 rounded-lg" />
          <div className="u-skel h-9 rounded-lg" />
        </div>
      </aside>
    </div>
  );
}
