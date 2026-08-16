import "server-only";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/monitoring";
import type { RenderedEmail } from "./templates";

/*
 * EmailService (spec 6.9: business logic depends on this, never on the Resend
 * SDK). Sends via the Resend REST API. When RESEND_API_KEY is unset it logs
 * and no-ops so flows never break in development or before launch config.
 */

export interface SendEmailInput {
  to: string;
  email: RenderedEmail;
}

export async function sendEmail({ to, email }: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Urivo <hello@urivo.ai>";

  if (!apiKey) {
    logger.info("Email suppressed (RESEND_API_KEY unset)", {
      to,
      subject: email.subject,
    });
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      logger.error("Email send failed", { to, subject: email.subject, status: res.status, detail: detail.slice(0, 200) });
      return false;
    }
    logger.info("Email sent", { to, subject: email.subject });
    return true;
  } catch (err) {
    // Provider down must never break the calling flow (spec 6.9).
    captureException(err, { route: "email:send", to });
    return false;
  }
}
