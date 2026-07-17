/*
 * Transactional email templates in the Urivo design language (spec 6.9):
 * single 600px column, Forest Green header, Warm Ivory body, Champagne Gold
 * CTA. Email clients require inline styles. Every template returns a plain
 * text alternative alongside the HTML.
 */

const FOREST = "#0B2416";
const IVORY = "#EFEAD8";
const GOLD = "#C69B3C";
const INK = "#2C3239";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Block {
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
}

function layout({ preheader, heading, paragraphs, cta, footnote }: Block): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:${INK};">${p}</p>`,
    )
    .join("");

  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
         <tr><td style="border-radius:8px;background:${GOLD};">
           <a href="${cta.url}" style="display:inline-block;padding:14px 28px;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${FOREST};text-decoration:none;">${cta.label}</a>
         </td></tr>
       </table>`
    : "";

  const foot = footnote
    ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#8a8f8b;">${footnote}</p>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Urivo</title></head>
<body style="margin:0;padding:0;background:#f2efe6;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${IVORY};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${FOREST};padding:28px 40px;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:${IVORY};letter-spacing:1px;">Urivo</span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.25;color:${FOREST};">${heading}</h1>
          ${body}
          ${button}
          ${foot}
        </td></tr>
        <tr><td style="padding:24px 40px;border-top:1px solid rgba(11,36,22,0.08);">
          <p style="margin:0;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8f8b;">Urivo — The AI Commerce Operating System</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function toText({ heading, paragraphs, cta, footnote }: Block): string {
  const parts = [heading, "", ...paragraphs];
  if (cta) parts.push("", `${cta.label}: ${cta.url}`);
  if (footnote) parts.push("", footnote);
  parts.push("", "— Urivo");
  return parts.join("\n");
}

function build(subject: string, block: Block): RenderedEmail {
  return { subject, html: layout(block), text: toText(block) };
}

const APP_URL = () => process.env.APP_URL ?? "https://urivo.ai";

export function welcomeEmail(name?: string): RenderedEmail {
  return build("Welcome to Urivo", {
    preheader: "Your AI commerce workspace is ready.",
    heading: name ? `Welcome, ${name}.` : "Welcome to Urivo.",
    paragraphs: [
      "Your workspace is ready. Describe a business in one sentence and Urivo designs the brand, writes the catalog and builds a live storefront in under a minute.",
      "You start with 15 free credits — enough for your first store.",
    ],
    cta: { label: "Build your first store", url: `${APP_URL()}/dashboard` },
  });
}

export function subscriptionConfirmedEmail(
  plan: "Core" | "Pro",
  priceLine: string,
): RenderedEmail {
  return build(`Your Urivo ${plan} subscription is active`, {
    preheader: `You're on ${plan}.`,
    heading: `You're on ${plan}.`,
    paragraphs: [
      `Your subscription is active. ${priceLine}`,
      "Your credits and features are available now in your workspace.",
    ],
    cta: { label: "Open workspace", url: `${APP_URL()}/dashboard` },
    footnote: "Manage or cancel your plan anytime from Billing.",
  });
}

export function paymentSucceededEmail(amount: string): RenderedEmail {
  return build("Payment received", {
    preheader: "Thanks — your payment went through.",
    heading: "Payment received.",
    paragraphs: [`We've received your payment of ${amount}. Thank you.`],
    cta: { label: "View billing", url: `${APP_URL()}/dashboard/billing` },
  });
}

export function paymentFailedEmail(): RenderedEmail {
  return build("Action needed: payment failed", {
    preheader: "We couldn't process your payment.",
    heading: "We couldn't process your payment.",
    paragraphs: [
      "Your most recent payment didn't go through. To keep your plan active, please update your payment details.",
      "We'll try again automatically over the next few days.",
    ],
    cta: { label: "Update payment", url: `${APP_URL()}/dashboard/billing` },
  });
}

export function subscriptionCancelledEmail(): RenderedEmail {
  return build("Your Urivo subscription was cancelled", {
    preheader: "Your plan has been cancelled.",
    heading: "Your subscription was cancelled.",
    paragraphs: [
      "Your plan has been cancelled and won't renew. You can keep using Urivo until the end of your current billing period.",
      "Changed your mind? You can resubscribe anytime.",
    ],
    cta: { label: "Resubscribe", url: `${APP_URL()}/dashboard/billing` },
  });
}
