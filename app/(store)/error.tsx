"use client";

import { useEffect } from "react";

/*
 * Error boundary for generated storefronts. Neutral by design — it must not
 * leak Urivo's brand onto a customer-facing store, and it has no access to the
 * individual store's design system here, so it stays quiet and universal.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
        background: "#faf9f6",
        color: "#1a1a1a",
        fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "24rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>This page is temporarily unavailable</h1>
        <p style={{ marginTop: ".75rem", color: "#666", lineHeight: 1.6, fontSize: ".95rem" }}>
          Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            padding: ".8rem 1.6rem",
            borderRadius: "8px",
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: ".85rem",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
