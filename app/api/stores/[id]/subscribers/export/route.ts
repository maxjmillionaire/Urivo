import { NextResponse, type NextRequest } from "next/server";
import { requireStoreOwner } from "@/lib/tenant";
import { loadAudience, subscribersCsv } from "@/lib/marketing/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The merchant's own subscriber list, as a CSV they can take anywhere. Owner-
 * gated through requireStoreOwner; the read inside loadAudience goes through the
 * user's own client, so RLS is a second, independent check. Their data is their
 * data — this is the door out.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireStoreOwner(id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.reason === "UNAUTHORIZED" ? 401 : 404 },
    );
  }

  const { subscribers } = await loadAudience(id);
  const csv = subscribersCsv(subscribers);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="subscribers-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
