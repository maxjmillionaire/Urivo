/*
 * Client analytics gate (spec 6.9, DSGVO). Events only fire after the user
 * has granted consent AND a PostHog key is configured. Until PostHog is
 * wired, track() is a safe no-op — call sites (spec 6.3 §29 events) don't
 * change when the provider is added.
 */

const CONSENT_KEY = "urivo_consent";

export function getConsent(): "granted" | "denied" | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

export function setConsent(value: "granted" | "denied") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, value);
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (getConsent() !== "granted") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  // PostHog wiring goes here once posthog-js is installed:
  //   posthog.capture(event, properties)
  void event;
  void properties;
}
