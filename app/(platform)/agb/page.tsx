import type { Metadata } from "next";
import { LegalShell, Placeholder } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Terms of Service — Urivo" };

export default function Terms() {
  return (
    <LegalShell title="Terms of Service">
      <h2>1. Scope</h2>
      <p>
        These terms govern the use of the Urivo platform, a SaaS application for the
        AI-assisted creation and management of online storefronts.
      </p>

      <h2>2. Services</h2>
      <p>
        Urivo provides features for market research, brand creation, storefront
        generation and management. Access is offered through a credit and
        subscription model.
      </p>

      <h2>3. Pricing &amp; billing</h2>
      <p>
        The prices shown on urivo.ai apply (Core, Pro, and a free plan).
        Subscriptions taken out during the launch period keep their launch price for
        the lifetime of the subscription. Billing is handled through Stripe.
      </p>

      <h2>4. Credits &amp; expiry</h2>
      <p>
        AI features are paid for with credits. Credits included with a paid subscription
        are granted for each billing period and are valid only within that period: any
        unused monthly plan credits expire at the end of the billing period they were
        granted for and do not roll over. Credits bought separately as one-time top-up
        packs do not expire. Credits have no cash value and are non-refundable except
        where required by law.
      </p>

      <h2>5. Right of withdrawal</h2>
      <Placeholder note="Add the consumer right-of-withdrawal notice, including the model withdrawal form" />

      <h2>6. Cancellation</h2>
      <p>Subscriptions can be cancelled at any time, effective at the end of the billing period.</p>

      <h2>7. Liability &amp; content</h2>
      <p>
        Each merchant is responsible for the content they generate. Urivo gives no
        warranty as to the legal admissibility of the store content published by the
        user.
      </p>
      <Placeholder note="Have the limitation of liability, warranty and place of jurisdiction reviewed by legal counsel" />
    </LegalShell>
  );
}
