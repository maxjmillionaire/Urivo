"use client";

import { useState } from "react";

/*
 * The storefront newsletter form.
 *
 * Both newsletter layouts rendered an input and a Subscribe button that did
 * absolutely nothing — no request, no confirmation, no error. A control that
 * looks live and isn't costs more trust than no control at all, and this one
 * sits on the second most-clicked element of a storefront.
 *
 * Styled entirely from the store's own design tokens, so it belongs to the
 * merchant's brand rather than to Urivo. Success is terminal on purpose: the
 * form is replaced by the confirmation, because leaving an empty input beside
 * "you're on the list" invites a second submission that reads as a failure.
 */

type State = "idle" | "sending" | "done" | "error";

export function NewsletterForm({ subdomain, source }: { subdomain: string; source?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value || state === "sending") return;

    // Caught here so a typo never costs a round trip; the server and the
    // database both re-validate regardless.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setState("error");
      setMessage("That doesn't look quite right — check the address?");
      return;
    }

    setState("sending");
    setMessage("");
    try {
      const res = await fetch(`/api/store/${subdomain}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setState("error");
        setMessage(data?.message || "We couldn't save that just now. Please try again.");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMessage("We couldn't reach the list. Please try again.");
    }
  }

  if (state === "done") {
    return (
      <p
        role="status"
        className="uv-h"
        style={{ marginTop: "1.8rem", fontSize: "1rem", color: "var(--accent)" }}
      >
        You&apos;re on the list. Thank you.
      </p>
    );
  }

  return (
    <form onSubmit={submit} noValidate style={{ marginTop: "1.8rem" }}>
      <div style={{ display: "flex", gap: ".6rem", justifyContent: "center", flexWrap: "wrap" }}>
        <label htmlFor={`uv-news-${subdomain}`} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          Email address
        </label>
        <input
          id={`uv-news-${subdomain}`}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") setState("idle");
          }}
          disabled={state === "sending"}
          placeholder="you@email.com"
          aria-invalid={state === "error"}
          style={{
            padding: ".9rem 1.1rem",
            minWidth: "260px",
            borderRadius: "var(--btn-radius)",
            border: `var(--border-w) solid ${state === "error" ? "var(--accent)" : "var(--line)"}`,
            background: "var(--bg)",
            color: "var(--ink)",
            fontFamily: "var(--font-b)",
            opacity: state === "sending" ? 0.65 : 1,
          }}
        />
        <button type="submit" className="uv-btn" disabled={state === "sending"} style={{ opacity: state === "sending" ? 0.7 : 1 }}>
          {state === "sending" ? "Joining…" : "Subscribe"}
        </button>
      </div>
      {state === "error" && message && (
        <p role="alert" style={{ marginTop: ".8rem", fontSize: ".84rem", color: "var(--accent)" }}>
          {message}
        </p>
      )}
    </form>
  );
}
