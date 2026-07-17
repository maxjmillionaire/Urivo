/*
 * Transactional email templates — Urivo Design System v2 (Slate/Gold).
 * A single 600px column on a light canvas: a white card, the navy brand tile,
 * generous spacing, a clean sans-serif hierarchy, a slate primary CTA and one
 * whisper-thin gold hairline as the only gold accent. Inline styles only
 * (email requirement); every template returns a plain-text alternative.
 * Bulletproof for Outlook/Gmail — table layout, system fonts, no web fonts.
 */

import { LOGO_DATA_URI } from "./logo";

// Design System v2 tokens (mirrors app/globals.css @theme).
const SLATE = "#1F293B"; // brand
const INK = "#0F172A"; // headings
const BODY = "#334155"; // body copy
const MUTED = "#64748B"; // secondary text
const CANVAS = "#F8FAFC"; // outer background
const SURFACE = "#FFFFFF"; // card
const SURFACE_MUTED = "#F1F5F9"; // footer band
const LINE = "#E2E8F0"; // borders
const GOLD = "#D4AF37"; // accent — used sparingly

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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
  const [lead, ...rest] = paragraphs;
  const leadHtml = lead
    ? `<p style="margin:0 0 20px;font-family:${FONT};font-size:16px;line-height:1.7;color:${INK};font-weight:500;">${lead}</p>`
    : "";
  const restHtml = rest
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.75;color:${BODY};">${p}</p>`,
    )
    .join("");

  // Bulletproof CTA: solid slate on a table cell (renders in Outlook/Gmail),
  // white text, one soft shadow — matches the app's primary button.
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;">
         <tr><td align="center" bgcolor="${SLATE}" style="border-radius:12px;background:${SLATE};box-shadow:0 8px 20px -10px rgba(15,23,42,0.35);">
           <a href="${cta.url}" style="display:inline-block;padding:15px 32px;font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:0.2px;color:#ffffff;text-decoration:none;">${cta.label}</a>
         </td></tr>
       </table>`
    : "";

  const foot = footnote
    ? `<p style="margin:28px 0 0;padding-top:22px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.65;color:${MUTED};">${footnote}</p>`
    : "";

  // Header: navy logo tile + "Urivo" wordmark on white, then a thin gold rule.
  const header = `
    <tr><td class="u-head" style="background:${SURFACE};padding:34px 48px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;padding-right:13px;">
          <img src="${LOGO_DATA_URI}" width="40" height="40" alt="Urivo" style="display:block;border-radius:11px;width:40px;height:40px;" />
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:${FONT};font-size:20px;font-weight:600;letter-spacing:-0.3px;color:${SLATE};">Urivo</span>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:1px;background:linear-gradient(90deg,rgba(212,175,55,0.6) 0%,rgba(212,175,55,0) 62%);line-height:1px;font-size:0;">&nbsp;</td></tr>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Urivo</title>
  <style>
    @media only screen and (max-width:620px){
      .u-card{border-radius:16px !important;}
      .u-pad{padding:34px 26px 30px !important;}
      .u-head{padding:28px 26px 24px !important;}
      .u-foot{padding:22px 26px !important;}
      .u-h1{font-size:24px !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:44px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="u-card" style="max-width:600px;width:100%;background:${SURFACE};border:1px solid ${LINE};border-radius:20px;overflow:hidden;box-shadow:0 20px 48px -24px rgba(15,23,42,0.18);">
        ${header}
        <tr><td class="u-pad" style="padding:40px 48px 40px;">
          <p style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${MUTED};">Urivo</p>
          <h1 class="u-h1" style="margin:0 0 22px;font-family:${FONT};font-weight:600;font-size:28px;line-height:1.25;color:${INK};letter-spacing:-0.4px;">${heading}</h1>
          ${leadHtml}
          ${restHtml}
          ${button}
          ${foot}
        </td></tr>
        <tr><td class="u-foot" style="background:${SURFACE_MUTED};border-top:1px solid ${LINE};padding:26px 48px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};">The AI Commerce<br>Operating System</td>
            <td align="right" style="font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:-0.2px;color:${SLATE};">Urivo</td>
          </tr></table>
        </td></tr>
      </table>
      <p style="margin:22px 0 0;font-family:${FONT};font-size:11px;letter-spacing:0.2px;color:${MUTED};">Sent with intention · Urivo</p>
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
