import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { modelFor } from "@/lib/ai/models";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/service";
import type { RenderedEmail } from "@/lib/email/templates";
import type { TokenUsage } from "@/lib/finance/cost-model";
import { CAMPAIGN_LIMITS } from "./limits";

/*
 * Campaigns — the merchant emailing their own subscriber list.
 *
 * Three separable parts, so the pure ones are testable without a database or a
 * provider:
 *   - validateCampaign / renderCampaignEmail / campaignFrom / unsubscribeUrl — pure.
 *   - draftCampaign — one AI call (reuses the ad-studio model route).
 *   - sendCampaign — loads the active list via the service role, sends each
 *     message with its own unsubscribe link, and records the campaign.
 *
 * Every email is CAN-SPAM / GDPR-shaped by construction: it names the store the
 * shopper subscribed to and carries a working one-click unsubscribe. It is sent
 * from Urivo's verified domain under the store's display name ("«Store» via
 * Urivo"), because deliverability lives with the verified domain, not the
 * merchant's — reply-to points back at the merchant.
 */

/** Campaign drafting reuses the ad-studio model route (both are marketing copy). */
export const CAMPAIGN_MODEL = modelFor("adStudio");

/** Re-exported so server callers keep a single import surface. The numbers live
 *  in ./limits (isomorphic) so the client composer can share them. */
export { CAMPAIGN_LIMITS };

export interface CampaignContent {
  subject: string;
  body: string;
}

/** Validate + normalise merchant-entered campaign copy. Pure. */
export function validateCampaign(input: { subject?: unknown; body?: unknown }):
  | { ok: true; value: CampaignContent }
  | { ok: false; error: string } {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (subject.length < CAMPAIGN_LIMITS.subjectMin) return { ok: false, error: "Add a subject line." };
  if (subject.length > CAMPAIGN_LIMITS.subjectMax) return { ok: false, error: "That subject line is too long." };
  if (body.length < CAMPAIGN_LIMITS.bodyMin) return { ok: false, error: "Write a little more before sending." };
  if (body.length > CAMPAIGN_LIMITS.bodyMax) return { ok: false, error: "That message is too long to send." };
  return { ok: true, value: { subject, body } };
}

/** Public one-click unsubscribe link for a subscriber's token. Pure. */
export function unsubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/api/unsubscribe?t=${encodeURIComponent(token)}`;
}

const ADDRESS_FALLBACK = "hello@urivo.ai";

/** The bare address out of an "Name <addr>" EMAIL_FROM, or a sane default. */
function senderAddress(): string {
  const raw = process.env.EMAIL_FROM ?? `Urivo <${ADDRESS_FALLBACK}>`;
  const m = raw.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return raw.includes("@") ? raw.trim() : ADDRESS_FALLBACK;
}

/** A display name safe to drop into a From header — no quotes, brackets, @ or
 *  newlines that could break the header or spoof a second address. Pure. */
export function sanitizeSenderName(name: string): string {
  const clean = name.replace(/["<>@\r\n,;:]/g, "").trim().slice(0, 40);
  return clean || "Your store";
}

/** From line for a campaign: the store's name, on Urivo's verified domain. */
export function campaignFrom(storeName: string): string {
  return `${sanitizeSenderName(storeName)} via Urivo <${senderAddress()}>`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A store-branded campaign email — NOT the Urivo transactional shell. The
 * shopper subscribed to the merchant, so the merchant's name leads and Urivo is
 * a quiet footnote. Bulletproof-ish table layout, inline styles, plain-text
 * alternative, and the legally required unsubscribe line. Pure.
 */
export function renderCampaignEmail(opts: {
  storeName: string;
  subject: string;
  body: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const name = esc(opts.storeName);
  const paras = opts.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155;">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e6e8ec;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:30px 40px 6px;">
        <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:#8a93a2;">${name}</p>
      </td></tr>
      <tr><td style="padding:14px 40px 34px;">
        <h1 style="margin:0 0 22px;font-size:24px;line-height:1.3;color:#141b26;font-weight:700;letter-spacing:-0.3px;">${esc(opts.subject)}</h1>
        ${paras}
      </td></tr>
      <tr><td style="background:#f7f8fa;border-top:1px solid #e6e8ec;padding:22px 40px;font-size:12px;line-height:1.65;color:#8a93a2;">
        You're receiving this because you subscribed to ${name}. <a href="${opts.unsubscribeUrl}" style="color:#57616f;">Unsubscribe</a>.
        <br><span style="color:#aeb4be;">Sent with Urivo</span>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = `${opts.storeName}\n\n${opts.subject}\n\n${opts.body}\n\n—\nYou're receiving this because you subscribed to ${opts.storeName}.\nUnsubscribe: ${opts.unsubscribeUrl}\nSent with Urivo`;

  return { subject: opts.subject, html, text };
}

/* ------------------------------- AI draft ---------------------------------- */

const DraftSchema = z.object({
  subject: z.string().min(3).max(120),
  body: z.string().min(20).max(1200),
});

const DRAFT_SYSTEM = `You write a single marketing email from a real ecommerce brand to its OWN existing subscribers — people who already signed up on the storefront.

Standards:
- HONESTY is absolute. This will be sent as the merchant's own words. Never invent a discount, a deadline, a stock level, a shipping time, a review, a customer count or a fact you were not given. If the merchant's goal implies an offer they did not specify, write around it rather than inventing numbers.
- Write to people who already know the brand — warm, specific, not a cold pitch. Lead with something worth opening the email for.
- Voice matches the brand's personality. Concise: a subject line and 2–4 short paragraphs. No filler.
- Banned words: "Revolutionary", "Unlock", "Dive into", "Game-changing", "Elevate", "Unleash", "In today's digital world". No exclamation-mark spam.
- Do NOT write greetings that assume a name you don't have ("Hi [name]"), and do NOT write an unsubscribe line — the system adds a lawful one.

Return: a subject line, and the body as plain paragraphs separated by blank lines.`;

export interface DraftInput {
  storeName: string;
  tagline?: string | null;
  personality?: string;
  products: { title: string; priceEUR: number }[];
  /** The merchant's instruction — "announce we're live", "win back quiet subscribers". */
  goal: string;
}

export interface DraftOutcome extends CampaignContent {
  usage: TokenUsage;
}

/** Draft a campaign from the store's brand + the merchant's goal. Throws on
 *  missing config, refusal, or invalid output — the route maps each to a code. */
export async function draftCampaign(input: DraftInput): Promise<DraftOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  const client = new Anthropic({ apiKey });
  const products = input.products
    .slice(0, 8)
    .map((p, i) => `${i + 1}. ${p.title} — €${p.priceEUR}`)
    .join("\n");
  const context = `Brand: ${input.storeName}${input.tagline ? ` — "${input.tagline}"` : ""}
${input.personality ? `Personality: ${input.personality}\n` : ""}Products:
${products || "(none listed)"}

The merchant wants this email to: ${input.goal.trim()}`;

  const res = await client.messages.parse({
    model: CAMPAIGN_MODEL,
    max_tokens: 1200,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(DraftSchema) },
    system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: context }],
  });

  if (res.stop_reason === "refusal") throw new Error("AI_REFUSED");
  const parsed = DraftSchema.safeParse(res.parsed_output);
  if (!parsed.success) throw new Error("AI_INVALID_OUTPUT");

  return {
    subject: parsed.data.subject,
    body: parsed.data.body,
    usage: {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    },
  };
}

/* --------------------------------- send ------------------------------------ */

export interface SendResult {
  audienceCount: number;
  sentCount: number;
  campaignId: string | null;
}

/** Run fn over items with bounded concurrency (kind to the email provider and
 *  to a serverless deadline). */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Send a campaign to a store's ACTIVE subscribers (unsubscribed excluded at the
 * query), record it, and return the counts. Best-effort per recipient: one
 * failed address never aborts the run. The campaign row is written first so an
 * audit trail survives even a partial send.
 */
export async function sendCampaign(opts: {
  storeId: string;
  storeName: string;
  subject: string;
  body: string;
  origin: string;
}): Promise<SendResult> {
  const admin = supabaseAdmin();

  const { data } = await admin
    .from("store_subscribers")
    .select("email, unsubscribe_token")
    .eq("store_id", opts.storeId)
    .is("unsubscribed_at", null)
    .limit(5000);
  const recipients = (data ?? []) as { email: string; unsubscribe_token: string }[];

  const { data: created } = await admin
    .from("store_campaigns")
    .insert({
      store_id: opts.storeId,
      subject: opts.subject,
      body: opts.body,
      audience_count: recipients.length,
      status: "draft",
    })
    .select("id")
    .single();
  const campaignId = (created?.id as string) ?? null;

  const from = campaignFrom(opts.storeName);
  let sent = 0;
  await mapLimit(recipients, 4, async (r) => {
    const email = renderCampaignEmail({
      storeName: opts.storeName,
      subject: opts.subject,
      body: opts.body,
      unsubscribeUrl: unsubscribeUrl(opts.origin, r.unsubscribe_token),
    });
    const ok = await sendEmail({ to: r.email, email, from });
    if (ok) sent += 1;
  });

  if (campaignId) {
    await admin
      .from("store_campaigns")
      .update({ sent_count: sent, status: "sent", sent_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  return { audienceCount: recipients.length, sentCount: sent, campaignId };
}
