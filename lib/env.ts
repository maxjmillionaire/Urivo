import { z } from "zod";

/*
 * Server environment validation (spec 6.1 §4: fail fast, never boot with
 * missing production secrets).
 *
 * Extend the schema as services are wired in:
 *   Phase 2 → STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs
 *   Phase 3 → ANTHROPIC_API_KEY, UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN
 *   Phase 5 → RESEND_API_KEY, POSTHOG_KEY, SENTRY_DSN
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  ROOT_DOMAIN: z.string().min(1).default("localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Server-only admin key — required once webhooks/admin operations land (Phase 2).
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Environment validation failed — refusing to boot. Invalid or missing: ${missing}`,
    );
  }
  cached = parsed.data;
  return cached;
}
