import Link from "next/link";

/*
 * Neutral not-found for the storefront root. A missing/inactive store must not
 * show Urivo's branded 404 — it stays quiet and unbranded.
 */
export default function StoreNotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        background: "#0e0e10",
        color: "#f4f4f2",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <p style={{ fontSize: "0.72rem", letterSpacing: "0.24em", textTransform: "uppercase", opacity: 0.5 }}>
        Store unavailable
      </p>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 600 }}>This shop isn&apos;t open</h1>
      <p style={{ opacity: 0.6, maxWidth: "32ch" }}>
        The address may be wrong, or the store isn&apos;t live yet.
      </p>
      <Link href="https://urivo.ai" style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.7, textDecoration: "underline" }}>
        urivo.ai
      </Link>
    </main>
  );
}
