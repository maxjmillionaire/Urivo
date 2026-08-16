import { ImageResponse } from "next/og";

/*
 * Branded Open Graph card for Urivo's marketing surfaces — the link preview
 * people see when the site is shared. Rendered on the Midnight canvas with the
 * gold accent, so a shared link looks as premium as the product.
 */
export const alt = "Urivo — The AI Commerce Operating System";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0B1220",
          backgroundImage:
            "radial-gradient(60% 60% at 15% 0%, rgba(52,70,110,0.45), transparent 60%), radial-gradient(50% 50% at 100% 100%, rgba(236,206,126,0.14), transparent 55%)",
          color: "#F4F1E8",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(180deg, #f0d79a, #CFA14A)",
              color: "#0B1220",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            U
          </div>
          <span style={{ fontSize: 30, letterSpacing: "0.28em", textTransform: "uppercase", color: "#98a2b6" }}>
            Urivo
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "44px" }}>
          <span style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: "900px" }}>
            The AI Commerce Operating System
          </span>
          <span style={{ fontSize: 32, color: "#b9c0ce", marginTop: "28px", maxWidth: "860px", lineHeight: 1.4 }}>
            Research the market. Build the brand. Launch a complete store — with AI, in minutes.
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
