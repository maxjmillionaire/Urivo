import "server-only";

/*
 * Structured logging (spec 6.3 §27): production logs are JSON with a level,
 * timestamp and optional request/correlation context. In development they
 * stay human-readable. Never logs secrets — callers pass only safe fields.
 */

type Level = "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  userId?: string;
  route?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, context?: LogContext) {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const line = JSON.stringify({
      level,
      message,
      time: new Date().toISOString(),
      ...context,
    });
    (level === "error" ? console.error : console.log)(line);
  } else {
    const ctx = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : "";
    (level === "error" ? console.error : console.log)(`[${level}] ${message}${ctx}`);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};

/** Short correlation id for a single request. */
export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
