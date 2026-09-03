import type { Metadata } from "next";
import { LegalShell } from "../legal/legal-shell";

export const metadata: Metadata = { title: "Terms of Service — Urivo" };

/*
 * PUBLIC, FINAL legal copy only — no internal notes ever render here.
 *
 * Facts used are authoritative: the provider details come from the Legal Notice
 * (Impressum); plan names, billing and credit rules match the product
 * (lib/plans.ts, migration 0022); cancellation matches Stripe cancel-at-period-
 * end plus Pause & Reactivate (migration 0058, store is paused, never deleted).
 *
 * The withdrawal notice and model form below are the statutory templates
 * (EU Consumer Rights Directive / Art. 246a EGBGB), completed with the verified
 * provider details — not drafted from scratch.
 *
 * Outstanding items are tracked OUTSIDE this file (see the launch-readiness
 * notes reported to the founder), so nothing unverified is asserted here:
 *   - counsel to confirm the liability/jurisdiction clause (§8, §9);
 *   - B2C vs B2B applicability of the withdrawal right;
 *   - whether to capture an immediate-performance / withdrawal-waiver consent
 *     at checkout (§356(4)(5) BGB) before relying on it.
 */
export default function Terms() {
  return (
    <LegalShell title="Terms of Service">
      <h2>1. Scope</h2>
      <p>
        These terms govern the use of the Urivo platform, a SaaS application for the
        AI-assisted creation and management of online storefronts, provided by
        buildwithmb (Max-Joel Basner), Mörikestraße 79, 73092 Heiningen, Germany
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Our full contact details are in the{" "}
        <a href="/impressum">Legal Notice</a>.
      </p>

      <h2>2. Services</h2>
      <p>
        Urivo provides features for market research, brand creation, storefront
        generation and management. Access is offered through a credit and
        subscription model. We may improve or change features over time as long as
        the core service you subscribed to remains available.
      </p>

      <h2>3. Pricing &amp; billing</h2>
      <p>
        The prices shown on urivo.ai apply. Urivo offers a free plan (Free) and paid
        subscription plans (Founder and Pro). Paid plans are recurring subscriptions
        billed monthly in advance through our payment provider, Stripe, and renew
        automatically until cancelled. Founding members keep the price at which they
        subscribed for the lifetime of that subscription. All prices are shown
        inclusive of any applicable statutory VAT where indicated.
      </p>

      <h2>4. Credits &amp; expiry</h2>
      <p>
        AI features are paid for with credits. Credits included with a paid
        subscription are granted for each billing period and are valid only within
        that period: any unused monthly plan credits expire at the end of the billing
        period they were granted for and do not roll over. Credits bought separately
        as one-time top-up packs, as well as welcome credits, do not expire. Credits
        have no cash value and are non-refundable except where required by law.
      </p>

      <h2>5. Right of withdrawal for consumers</h2>
      <p>
        If you are a consumer (a natural person entering into the contract for
        purposes outside your trade, business or profession), you have a statutory
        right of withdrawal.
      </p>
      <p>
        <strong>Right of withdrawal.</strong> You have the right to withdraw from this
        contract within 14 days without giving any reason. The withdrawal period is 14
        days from the day of the conclusion of the contract. To exercise your right of
        withdrawal, you must inform us — buildwithmb, Max-Joel Basner, Mörikestraße 79,
        73092 Heiningen, Germany, email{" "}
        <a href="mailto:urivosupport@gmail.com">urivosupport@gmail.com</a>, phone{" "}
        <a href="tel:+4915679817171">+49 15679 817171</a> — of your decision to
        withdraw from this contract by an unequivocal statement (for example, a letter
        sent by post or an email). You may use the model withdrawal form below, but it
        is not obligatory. To meet the withdrawal deadline, it is sufficient for you to
        send your communication concerning the exercise of the right of withdrawal
        before the withdrawal period has expired.
      </p>
      <p>
        <strong>Effects of withdrawal.</strong> If you withdraw from this contract, we
        shall reimburse all payments received from you without undue delay and no later
        than 14 days from the day on which we are informed of your decision to withdraw.
        We will use the same means of payment you used for the original transaction
        unless expressly agreed otherwise; in no case will you be charged any fees for
        this reimbursement. If you requested that the service begin during the
        withdrawal period, you shall pay us a reasonable amount proportionate to the
        service already provided up to the point you inform us of your withdrawal,
        compared with the full scope of the contract.
      </p>
      <p>
        <strong>Model withdrawal form.</strong> (Complete and return this form only if
        you wish to withdraw from the contract.)
      </p>
      <p>
        — To buildwithmb, Max-Joel Basner, Mörikestraße 79, 73092 Heiningen, Germany,
        urivosupport@gmail.com:
        <br />— I/We (*) hereby give notice that I/We (*) withdraw from my/our (*)
        contract for the provision of the following service: Urivo subscription
        <br />— Ordered on (*) / received on (*):
        <br />— Name of consumer(s):
        <br />— Address of consumer(s):
        <br />— Signature of consumer(s) (only if this form is notified on paper):
        <br />— Date:
        <br />
        <span>(*) Delete as appropriate.</span>
      </p>

      <h2>6. Cancellation</h2>
      <p>
        You can cancel a paid subscription at any time. Cancellation takes effect at
        the end of the current billing period; you keep access until then, and you are
        not billed again afterwards. We do not delete your store when your subscription
        ends: your storefront is set to a paused state — visitors see a temporary
        maintenance page and checkout is turned off — while your store, products and
        orders remain in place. Your store returns to live automatically when you
        subscribe again. If you want your data removed entirely, you can delete your
        account at any time from Settings (see our <a href="/datenschutz">Privacy
        Policy</a>).
      </p>

      <h2>7. Your content and responsibilities</h2>
      <p>
        Each merchant is responsible for the content they generate and publish and for
        ensuring it complies with applicable law. Urivo gives no warranty as to the
        legal admissibility of the store content published by the user. You must not
        use Urivo to create content that is unlawful, infringes third-party rights, or
        breaches these terms.
      </p>

      <h2>8. Liability</h2>
      <p>
        We are liable without limitation for damages arising from injury to life, body
        or health, for damages caused intentionally or by gross negligence, and under
        the mandatory provisions of the German Product Liability Act. For slight
        negligence, we are liable only for the breach of an essential contractual
        obligation (an obligation whose fulfilment makes the proper performance of the
        contract possible in the first place and on whose observance you may regularly
        rely), and in that case liability is limited to the foreseeable damage typical
        for this type of contract. Any further liability is excluded. Mandatory
        statutory provisions remain unaffected.
      </p>

      <h2>9. Governing law and place of jurisdiction</h2>
      <p>
        German law applies, excluding the UN Convention on Contracts for the
        International Sale of Goods. If you are a consumer, the mandatory
        consumer-protection provisions of the country of your habitual residence remain
        unaffected by this choice of law. If you are a merchant, a legal entity under
        public law or a special fund under public law, the exclusive place of
        jurisdiction for all disputes arising from this contract is our registered
        seat.
      </p>

      <h2>10. Contact</h2>
      <p>
        buildwithmb, Max-Joel Basner — email{" "}
        <a href="mailto:urivosupport@gmail.com">urivosupport@gmail.com</a>. Full details
        are in the <a href="/impressum">Legal Notice</a>.
      </p>
    </LegalShell>
  );
}
