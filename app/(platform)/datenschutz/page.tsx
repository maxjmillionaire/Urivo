import type { Metadata } from "next";
import { LegalShell, Placeholder } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Privacy Policy — Urivo" };

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This policy explains how personal data is processed under the GDPR when you
        use Urivo.
      </p>

      <h2>Controller</h2>
      <Placeholder note="Name and contact details of the controller (see Legal Notice)" />

      <h2>Data we process</h2>
      <p>
        Urivo processes account and usage data to provide the service: your email
        address and authentication (Supabase), store and product data, billing data
        (Stripe), and technical logs. Ideas you enter are sent to Anthropic (Claude)
        to generate your store.
      </p>

      <h2>Processors</h2>
      <p>
        Supabase (auth, database), Anthropic (AI generation), Stripe (payments),
        Resend (email), Railway (hosting), Cloudflare (CDN/DNS), PostHog and Sentry
        (analytics and error monitoring).
      </p>
      <Placeholder note="Confirm data processing agreements (DPAs) and document server locations / third-country transfers" />

      <h2>Your rights</h2>
      <p>
        You have the right to access, rectification, erasure, restriction, data
        portability and objection. You can delete your account and all associated
        data yourself from Settings.
      </p>

      <h2>Cookies &amp; analytics</h2>
      <p>
        Necessary cookies are used to keep you signed in. Analytics (PostHog) only
        run after you consent.
      </p>
      <Placeholder note="Add legal bases, retention periods and the contact of the competent data protection authority" />
    </LegalShell>
  );
}
