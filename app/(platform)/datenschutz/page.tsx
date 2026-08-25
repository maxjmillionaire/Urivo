import type { Metadata } from "next";
import { LegalShell } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Privacy Policy — Urivo" };

/*
 * PUBLIC, FINAL privacy copy only — no internal notes ever render here.
 *
 * Every statement is grounded in the actual application:
 *   - controller = the verified Impressum details;
 *   - processors listed are the ones actually wired in production code
 *     (Supabase, Anthropic, the active image provider, Stripe, Resend, Railway,
 *     Cloudflare, Sentry). AutoDS is NOT listed — it is dormant, unreachable
 *     scaffolding, not a live processor. PostHog analytics is consent-gated and
 *     currently inactive (lib/analytics.ts track() is a no-op), so it is
 *     described as optional rather than asserted as active;
 *   - retention reflects real rules: click/attribution data 90 days
 *     (migrations 0039/0044), account data until self-service deletion
 *     (/api/account cascade), statutory retention for billing records;
 *   - legal bases and the competent supervisory authority (Baden-Württemberg,
 *     from the controller's seat) are derived from verified facts.
 *
 * Outstanding items are tracked OUTSIDE this file (launch-readiness notes):
 * executing signed DPAs with each processor and confirming their regions;
 * confirming the active image provider; the PostHog activation decision. None
 * of these require asserting anything unverified on this page.
 */
export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This policy explains how personal data is processed under the EU General Data
        Protection Regulation (GDPR) when you use Urivo. It applies to Urivo&rsquo;s own
        application; a merchant who runs a storefront generated with Urivo is the
        controller for the personal data of their own customers.
      </p>

      <h2>Controller</h2>
      <p>
        buildwithmb
        <br />
        Max-Joel Basner
        <br />
        Mörikestraße 79, 73092 Heiningen, Germany
        <br />
        Email: <a href="mailto:urivosupport@gmail.com">urivosupport@gmail.com</a>
        <br />
        Phone: <a href="tel:+4915679817171">+49 15679 817171</a>
      </p>

      <h2>What data we process, and on what legal basis</h2>
      <p>
        <strong>Account &amp; authentication data</strong> (email, password hash,
        display name, sign-in state) — to create and secure your account and provide
        the service. Legal basis: performance of the contract, Art. 6(1)(b) GDPR.
      </p>
      <p>
        <strong>Store, product and brand data</strong> you create or generate, and{" "}
        <strong>the ideas and business descriptions you enter</strong> — to generate and
        manage your storefronts. Legal basis: Art. 6(1)(b) GDPR.
      </p>
      <p>
        <strong>Your customers&rsquo; order and checkout data</strong> collected through
        your storefront — processed on your behalf so you can sell. Legal basis:
        Art. 6(1)(b) GDPR (and, between you and your customers, your own basis as their
        controller).
      </p>
      <p>
        <strong>Billing metadata</strong> (subscription status, plan, payment
        confirmations; card data is handled solely by Stripe, never by us) — to operate
        subscriptions. Legal basis: Art. 6(1)(b) GDPR, and Art. 6(1)(c) GDPR for
        retaining invoice records to meet statutory tax and accounting obligations.
      </p>
      <p>
        <strong>Technical logs, security and error data, and traffic-attribution
        data</strong> — to keep the service reliable and secure and to attribute sales
        to the campaigns that produced them. Legal basis: our legitimate interests in a
        secure, functioning, measurable service, Art. 6(1)(f) GDPR.
      </p>
      <p>
        <strong>Feedback and support messages</strong> you send us — to answer and
        improve the product. Legal basis: Art. 6(1)(f) GDPR.
      </p>
      <p>
        <strong>Analytics and marketing emails</strong> — only with your consent, which
        you can withdraw at any time. Legal basis: Art. 6(1)(a) GDPR (and § 25 TDDDG for
        any non-essential storage on your device).
      </p>

      <h2>Processors and recipients</h2>
      <p>
        We use the following service providers, each under a data-processing agreement,
        and share with each only the data needed for its purpose:
      </p>
      <p>
        <strong>Supabase</strong> — authentication and database (your account, store and
        product data).
        <br />
        <strong>Anthropic</strong> — AI generation; the ideas and business descriptions
        you enter are sent to generate your store text.
        <br />
        <strong>Higgsfield / Google (Gemini)</strong> — AI product-image generation;
        whichever provider is configured receives the product and brand context needed
        to render images.
        <br />
        <strong>Stripe</strong> — payment processing for subscriptions and for your
        storefront checkout; Stripe handles card data as its own controller.
        <br />
        <strong>Resend</strong> — transactional and (with consent) marketing email
        delivery; receives the recipient address and message.
        <br />
        <strong>Railway</strong> — application hosting.
        <br />
        <strong>Cloudflare</strong> — content delivery, DNS and custom-domain routing.
        <br />
        <strong>Sentry</strong> — error monitoring; receives technical diagnostic data
        when something fails.
      </p>

      <h2>International transfers</h2>
      <p>
        Some of these providers are based outside the European Economic Area (for
        example in the United States). Where personal data is transferred to a third
        country, the transfer is safeguarded under Chapter V GDPR — by an adequacy
        decision of the European Commission (including the EU–US Data Privacy Framework
        where the provider is certified) or by the European Commission&rsquo;s Standard
        Contractual Clauses. You can request more detail on the safeguards for a specific
        provider using the contact details above.
      </p>

      <h2>How long we keep data</h2>
      <p>
        We keep your account, store, product and order data for as long as your account
        exists. When you delete your account, this data is erased. Billing and invoice
        records are kept for as long as statutory tax and commercial-law retention
        obligations require (in Germany, generally up to ten years). Traffic-attribution
        (click) data is kept for up to 90 days. All other data — including technical
        logs, error diagnostics and support messages — is kept only for as long as
        necessary for the purpose for which it was collected, and then deleted.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access, rectification, erasure, restriction, data
        portability and objection, and the right to withdraw consent at any time with
        effect for the future. You can delete your account and all associated data
        yourself at any time from Settings. To exercise any right, contact us using the
        details above.
      </p>

      <h2>Right to lodge a complaint</h2>
      <p>
        You have the right to lodge a complaint with a supervisory authority. The
        authority competent for us is the State Commissioner for Data Protection and
        Freedom of Information Baden-Württemberg (Der Landesbeauftragte für den
        Datenschutz und die Informationsfreiheit Baden-Württemberg), Lautenschlagerstraße
        20, 70173 Stuttgart, Germany.
      </p>

      <h2>Cookies &amp; analytics</h2>
      <p>
        We use necessary cookies to keep you signed in (set by our authentication
        provider) and, on generated storefronts, a necessary session cookie
        (&ldquo;urivo_cs&rdquo;) that maintains the shopping cart and attributes a sale to
        the visit that produced it. Your consent choice is stored in your browser&rsquo;s
        local storage, not in a cookie.
      </p>
      <p>
        Analytics is optional and runs only after you choose &ldquo;Accept&rdquo; in our
        consent banner; declining is a single click and sets a &ldquo;denied&rdquo; state
        that we honour, so no analytics is loaded and no analytics cookies are set. When
        enabled, analytics is provided by PostHog. Analytics is not active on Urivo at
        this time; if that changes, this policy and the consent banner will reflect it.
        Necessary cookies do not require consent.
      </p>
    </LegalShell>
  );
}
