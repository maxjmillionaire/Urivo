import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

/*
 * Merchant notifications — one place to raise an event and one place to read the
 * feed. Server-only; callers authorise the user first. Raising a notification is
 * best-effort: a failed insert must never break the action that triggered it
 * (a sale is recorded whether or not the "you made a sale" notice sends).
 */

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface NotifyInput {
  kind: string;
  title: string;
  body?: string;
  href?: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: string;
}

export async function notify(userId: string, input: NotifyInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("notifications").insert({
      user_id: userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      severity: input.severity ?? "info",
      metadata: input.metadata ?? {},
    });
    if (error) logger.warn("notify insert failed", { userId, kind: input.kind, error: error.message });
  } catch (err) {
    logger.warn("notify threw", { userId, err: err instanceof Error ? err.message : String(err) });
  }
}

export async function getNotifications(userId: string, limit = 12): Promise<Notification[]> {
  const { data } = await supabaseAdmin()
    .from("notifications")
    .select("id, kind, title, body, href, severity, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    href: r.href,
    severity: (r.severity ?? "info") as NotificationSeverity,
    read: r.read_at != null,
    createdAt: r.created_at,
  }));
}

export async function unreadCount(userId: string): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

export async function markAllRead(userId: string): Promise<void> {
  await supabaseAdmin()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
}
