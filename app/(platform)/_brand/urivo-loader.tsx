import Image from "next/image";
import logo from "@/assets/brand/urivo-logo.png";

/*
 * The Urivo loading experience — a branded moment, never a spinner.
 * The gold mark breathes inside an orbiting aura; the wordmark rises; a slim
 * gold shimmer tracks progress. Sets the tone before the app appears.
 */
export function UrivoLoader({
  label = "Preparing your workspace",
  fullscreen = true,
}: {
  label?: string;
  fullscreen?: boolean;
}) {
  return (
    <div
      className={`${fullscreen ? "fixed inset-0 z-[100]" : "flex min-h-[60vh] w-full"} flex flex-col items-center justify-center bg-night`}
    >
      {/* ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 42%, rgba(232,205,128,0.10), rgba(11,18,32,0) 60%)",
        }}
      />

      <div className="relative flex h-24 w-24 items-center justify-center">
        {/* orbiting gold ring */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-[24px]"
          style={{
            background:
              "conic-gradient(from 0deg, rgba(232,205,128,0) 0deg, rgba(232,205,128,0) 210deg, rgba(248,236,192,0.95) 330deg, rgba(232,205,128,0) 360deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
            animation: "urivo-orbit 1.5s linear infinite",
          }}
        />
        {/* mark */}
        <span
          className="relative flex h-[72px] w-[72px] items-center justify-center"
          style={{ animation: "urivo-mark-breathe 2.4s ease-in-out infinite" }}
        >
          <Image src={logo} alt="Urivo" width={72} height={72} priority className="rounded-[18px]" />
        </span>
      </div>

      <p
        className="relative mt-8 text-sm font-semibold uppercase tracking-[0.42em] text-ivory"
        style={{ animation: "urivo-fade-up 700ms var(--ease-urivo) 120ms both", paddingLeft: "0.42em" }}
      >
        Urivo
      </p>

      <div className="relative mt-5 h-px w-44 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full w-1/3 rounded-full"
          style={{
            backgroundImage: "linear-gradient(90deg, transparent, #f2dd9c, transparent)",
            animation: "urivo-loadbar 1.4s var(--ease-urivo) infinite",
          }}
        />
      </div>

      {label && (
        <p
          className="relative mt-4 text-xs text-mist"
          style={{ animation: "urivo-fade-up 700ms var(--ease-urivo) 260ms both" }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
