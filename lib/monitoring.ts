import "server-only";
import { logger, type LogContext } from "@/lib/logger";

/*
 * Monitoring service (spec 6.9: business logic depends on this, never on a
 * vendor SDK). It ALWAYS captures to structured logs; when SENTRY_DSN is set it
 * also forwards the error to Sentry via a tiny, dependency-free client — no
 * build-config changes, no SDK to keep in step, and it degrades to log-only
 * when unset. Forwarding is best-effort and never throws into the caller.
 *
 * (A future upgrade to @sentry/nextjs would add traces + source maps; this is
 * the zero-risk wiring that makes production errors visible today.)
 */

export function captureException(error: unknown, context?: LogContext) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const name = error instanceof Error ? error.name : "Error";

  logger.error(message, { ...context, stack });

  // Fire-and-forget. Urivo runs a persistent Node process, so the background
  // send completes; it stays best-effort regardless of runtime.
  void forwardToSentry({ name, message, stack, context });
}

interface Dsn {
  host: string;
  projectId: string;
  publicKey: string;
}

// undefined = not parsed yet, null = absent/invalid.
let dsnCache: Dsn | null | undefined;

function parseDsn(): Dsn | null {
  if (dsnCache !== undefined) return dsnCache;
  const raw = process.env.SENTRY_DSN;
  if (!raw) return (dsnCache = null);
  try {
    const u = new URL(raw);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !u.host || !projectId) return (dsnCache = null);
    return (dsnCache = { host: u.host, projectId, publicKey: u.username });
  } catch {
    return (dsnCache = null);
  }
}

function eventId(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

async function forwardToSentry(input: {
  name: string;
  message: string;
  stack?: string;
  context?: LogContext;
}): Promise<void> {
  const dsn = parseDsn();
  if (!dsn) return;
  try {
    const event = {
      event_id: eventId(),
      timestamp: Date.now() / 1000,
      platform: "node",
      level: "error",
      logger: "urivo",
      environment: process.env.NODE_ENV ?? "production",
      exception: { values: [{ type: input.name, value: input.message }] },
      extra: { ...input.context, stack: input.stack },
    };
    await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=urivo-min/1.0`,
      },
      body: JSON.stringify(event),
      cache: "no-store",
    });
  } catch {
    // Best-effort — monitoring must never break the caller.
  }
}
