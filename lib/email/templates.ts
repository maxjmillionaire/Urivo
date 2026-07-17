/*
 * Transactional email templates — Urivo's luxury visual language (spec 6.9,
 * 6.5). Single 600px column, deep forest header with a soft gold hairline,
 * generous editorial spacing, serif display headings, a gold-gradient CTA with
 * depth, and the logo mark. Inline styles only (email requirement); every
 * template returns a plain-text alternative. Copy is unchanged — only the
 * presentation is elevated.
 */

import { LOGO_DATA_URI } from "./logo";

const FOREST = "#0B2416";
const FOREST_DEEP = "#05120B";
const IVORY = "#EFEAD8";
const IVORY_SOFT = "#F7F4EA";
const GOLD = "#C69B3C";
const GOLD_LIGHT = "#E3C77E";
const CHAMPAGNE = "#EDE0C2";
const INK = "#3A413C";

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
    ? `<p style="margin:0 0 20px;font-size:17px;line-height:1.7;color:${FOREST};font-weight:500;">${lead}</p>`
    : "";
  const restHtml = rest
    .map(
      (p) =>
        `<p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:${INK};">${p}</p>`,
    )
    .join("");

  // Bulletproof CTA: solid gold on a table cell (renders in Outlook/Gmail),
  // forest text, one soft shadow. Restrained — an invitation, not a game.
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;">
         <tr><td align="center" bgcolor="${GOLD}" style="border-radius:10px;background:${GOLD};box-shadow:0 6px 16px -8px rgba(198,155,60,0.4);">
           <a href="${cta.url}" style="display:inline-block;padding:15px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${FOREST};text-decoration:none;">${cta.label}</a>
         </td></tr>
       </table>`
    : "";

  const foot = footnote
    ? `<p style="margin:28px 0 0;padding-top:22px;border-top:1px solid rgba(11,36,22,0.08);font-size:13px;line-height:1.65;color:#8f938e;">${footnote}</p>`
    : "";

  // Header: logo mark + wordmark on deep forest, with a whisper-thin gold rule.
  const header = `
    <tr><td class="u-head" style="background:${FOREST};padding:38px 48px 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;padding-right:15px;">
          <img src="${LOGO_DATA_URI}" width="42" height="42" alt="Urivo" style="display:block;border-radius:11px;width:42px;height:42px;" />
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:21px;color:${IVORY};letter-spacing:4px;">URIVO</span>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:1px;background:linear-gradient(90deg,rgba(198,155,60,0.55) 0%,rgba(198,155,60,0) 55%);line-height:1px;font-size:0;">&nbsp;</td></tr>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Urivo</title>
  <style>
    @media only screen and (max-width:620px){
      .u-card{border-radius:16px !important;}
      .u-pad{padding:32px 26px !important;}
      .u-head{padding:30px 26px 26px !important;}
      .u-foot{padding:22px 26px !important;}
      .u-h1{font-size:26px !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${FOREST_DEEP};-webkit-font-smoothing:antialiased;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOREST_DEEP};padding:44px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="u-card" style="max-width:600px;width:100%;background:${IVORY_SOFT};border-radius:22px;overflow:hidden;box-shadow:0 40px 90px -35px rgba(0,0,0,0.65);">
        ${header}
        <tr><td class="u-pad" style="padding:48px 48px 44px;">
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${GOLD};">Urivo</p>
          <h1 class="u-h1" style="margin:0 0 26px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:31px;line-height:1.22;color:${FOREST};letter-spacing:-0.4px;">${heading}</h1>
          ${leadHtml}
          ${restHtml}
          ${button}
          ${foot}
        </td></tr>
        <tr><td class="u-foot" style="background:${FOREST};padding:28px 48px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(239,234,216,0.5);">The AI Commerce<br>Operating System</td>
            <td align="right" style="font-family:Georgia,serif;font-size:15px;letter-spacing:3px;color:${CHAMPAGNE};">URIVO</td>
          </tr></table>
        </td></tr>
      </table>
      <p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.5px;color:rgba(239,234,216,0.32);">Sent with intention · Urivo</p>
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
