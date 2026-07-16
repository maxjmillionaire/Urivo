import "server-only";
import { logger, type LogContext } from "@/lib/logger";

/*
 * Monitoring service (spec 6.9: business logic depends on this, never on a
 * vendor SDK). Today it captures to structured logs; when SENTRY_DSN is set,
 * this is the single place to forward to Sentry — call sites don't change.
 */

export function captureException(error: unknown, context?: LogContext) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(message, { ...context, stack });

  // When Sentry is configured (Phase 5 wiring), forward here:
  //   if (process.env.SENTRY_DSN) Sentry.captureException(error, { extra: context });
}
