import { NextResponse, type NextRequest } from "next/server";
import { loadAdLibrary } from "@/lib/ai/ad-performance";
import { buildExport, EXPORT_FORMATS, type ExportFormat } from "@/lib/ai/ad-export";
import { supabaseServer } from "@/lib/supabase/server";
import { requireStoreOwner } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Download this store's ads in the format its ad platform imports.
 *
 * Free — no credits. The ads were already paid for when they were generated;
 * charging again to get them out in a usable shape would be charging for the
 * absence of an inconvenience.
 *
 * Built from the saved library rather than a live plan, so ads written last
 * week export exactly like ads written a minute ago.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const owner = await requireStoreOwner(id);
  if (!owner.ok) {
    return owner.reason === "UNAUTHORIZED"
      ? NextResponse.json({ error: "UNAUTHORIZED", message: "Please sign in." }, { status: 401 })
      : NextResponse.json({ error: "NOT_FOUND", message: "Store not found." }, { status: 404 });
  }

  const raw = request.nextUrl.searchParams.get("format") ?? "";
  if (!(EXPORT_FORMATS as readonly string[]).includes(raw)) {
    return NextResponse.json(
      { error: "BAD_FORMAT", message: `Choose one of: ${EXPORT_FORMATS.join(", ")}.` },
      { status: 400 },
    );
  }
  const format = raw as ExportFormat;

  const supabase = await supabaseServer();
  const { data: store } = await supabase.from("stores").select("store_name, subdomain").eq("id", id).single();
  if (!store) return NextResponse.json({ error: "NOT_FOUND", message: "Store not found." }, { status: 404 });

  const library = await loadAdLibrary(id, store.subdomain, process.env.APP_URL ?? "http://localhost:3000");
  const result = buildExport(format, library, store.store_name);

  /*
   * Nothing to export is a 200 with an explanation, not an error. The merchant
   * asked a reasonable question — "give me my Google ads" — and the answer is
   * that this set has none. A 4xx would render as a failure they cannot act on.
   */
  if (!result.csv) {
    return NextResponse.json({ ok: false, ads: 0, note: result.note }, { status: 200 });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      // A stale ad export would show yesterday's ads with today's numbers.
      "Cache-Control": "no-store",
      "X-Urivo-Ads": String(result.ads),
    },
  });
}
