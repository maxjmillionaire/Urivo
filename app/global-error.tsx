"use client";

import { useEffect } from "react";

/*
 * Global error boundary — the last line of defense. Renders only when the root
 * layout itself throws, so it must ship its own <html>/<body>. Kept minimal and
 * on-brand (Midnight) with no dependencies on app chrome.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to monitoring if wired.
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0B1220",
          color: "#F4F1E8",
          fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "26rem" }}>
          <p style={{ fontSize: ".72rem", letterSpacing: ".24em", textTransform: "uppercase", color: "#ECCE7E" }}>
            Something broke
          </p>
          <h1 style={{ marginTop: ".8rem", fontSize: "1.9rem", fontWeight: 600, letterSpacing: "-.01em" }}>
            We hit an unexpected error
          </h1>
          <p style={{ marginTop: ".9rem", color: "#98a2b6", lineHeight: 1.6, fontSize: ".95rem" }}>
            The issue has been logged. Try again — if it keeps happening, refresh the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.8rem",
              padding: ".85rem 1.8rem",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: ".85rem",
              color: "#0B1220",
              backgroundImage: "linear-gradient(180deg, #f0d79a, #ECCE7E 48%, #CFA14A)",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
