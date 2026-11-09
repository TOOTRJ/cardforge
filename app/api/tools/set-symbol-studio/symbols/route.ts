import { NextResponse } from "next/server";
import { checkToolAccess } from "@/lib/tools/queries";
import { listMySymbols } from "@/lib/tools/set-symbol/queries";
import { SET_SYMBOL_SLUG } from "@/lib/tools/set-symbol/server";

// ---------------------------------------------------------------------------
// GET /api/tools/set-symbol-studio/symbols — the viewer's symbols for the
// card creator's "Your symbols" pickers (the Set icon and Watermark steps).
// A viewer the tool isn't open to gets a 404, and the pickers stay hidden.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) return NextResponse.json({ ok: false }, { status: 404 });
  const symbols = await listMySymbols(access.userId);
  return NextResponse.json(
    {
      ok: true,
      symbols: symbols.map((s) => ({
        id: s.id,
        name: s.name,
        auto: s.files.auto,
        plain: s.files.plain,
        rare: s.files.rare,
        watermark: s.files.watermark,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
