import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

/*
 * The merchant's audience — their own subscriber list, finally readable.
 *
 * store_subscribers has been capturing addresses since 0029 and showing them to
 * no one. This reads the list back through the OWNER's Supabase client, so RLS
 * is the boundary: a merchant only ever sees their own stores' subscribers. The
 * unsubscribe token is deliberately NOT selected here — it belongs only to the
 * send path, never to a screen or an export.
 */

export interface Subscriber {
  id: string;
  email: string;
  source: string;
  subscribed: boolean;
  createdAt: string;
}

export interface AudienceStats {
  /** Active (still subscribed). */
  active: number;
  unsubscribed: number;
  /** New active subscribers in the last 30 days. */
  last30d: number;
}

export interface Audience {
  subscribers: Subscriber[];
  stats: AudienceStats;
}

const DAY_MS = 86_400_000;

export async function loadAudience(storeId: string): Promise<Audience> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("store_subscribers")
    .select("id, email, source, unsubscribed_at, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as {
    id: string;
    email: string;
    source: string | null;
    unsubscribed_at: string | null;
    created_at: string;
  }[];

  const subscribers: Subscriber[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    source: r.source ?? "storefront",
    subscribed: r.unsubscribed_at === null,
    createdAt: r.created_at,
  }));

  const since = Date.now() - 30 * DAY_MS;
  const active = subscribers.filter((s) => s.subscribed);
  return {
    subscribers,
    stats: {
      active: active.length,
      unsubscribed: subscribers.length - active.length,
      last30d: active.filter((s) => Date.parse(s.createdAt) >= since).length,
    },
  };
}

/**
 * The list as a CSV the merchant owns and can take anywhere. Excel-safe: a BOM
 * so accented addresses render, CRLF line endings, and every cell quoted with
 * doubled inner quotes (RFC 4180) so a comma or quote in a value can't break a
 * row — which is also how a crafted address would otherwise smuggle a column.
 */
export function subscribersCsv(subscribers: Subscriber[]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["email", "status", "source", "subscribed_at"].join(",");
  const lines = subscribers.map((s) =>
    [
      cell(s.email),
      cell(s.subscribed ? "subscribed" : "unsubscribed"),
      cell(s.source),
      cell(s.createdAt),
    ].join(","),
  );
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}
