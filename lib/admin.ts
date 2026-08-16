import "server-only";

/*
 * Admin gate. The finance dashboard exposes whole-business economics and every
 * user's cost — internal-only. Access is granted to the email addresses in the
 * ADMIN_EMAILS env var (comma-separated), matched case-insensitively.
 *
 * Fail closed: if ADMIN_EMAILS is unset or empty, NOBODY is an admin. There is
 * no hardcoded fallback address — access is configured per deployment, never
 * baked into the repo.
 */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = adminEmails().map((e) => e.toLowerCase());
  return allow.includes(email.toLowerCase());
}
