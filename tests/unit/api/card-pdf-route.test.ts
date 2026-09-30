import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/pdf — print is always SQUARE (TODO 3.26, owner decision
// 2026-09-27): the single-card page and the Letter/A4 3×3 sheets are cut
// along the rectangle and its crop marks, so the live render is the PRINT
// render (lib/render/card-print.ts — square, the art at full resolution,
// TODO 6.10), never the rounded, transparent display bake.
//
// `bleed=1` (TODO 6.1a): the single card with its 1/8 in bleed on a slugged
// page (crop marks on the trim, TrimBox/BleedBox); a sheet with bleed is a
// 400 (sheet options are 6.15).
// ---------------------------------------------------------------------------

const ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: ID, slug: "c", title: "Card", owner_id: "o", visibility: "public", frame_style: {} },
          }),
        }),
      }),
    }),
  }),
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ isPaid: true, allowBatchExport: true, removeWatermark: true }),
  downloadBrandMark: () => false,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/cards/bake-core", () => ({ rowToPreviewData: () => ({ frameStyle: {} }) }));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-print", () => ({ renderCardPrint: state.render }));

import { GET } from "@/app/api/cards/[id]/pdf/route";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";

async function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/cards/${ID}/pdf?${query}`), {
    params: Promise.resolve({ id: ID }),
  });
}

beforeEach(async () => {
  const png = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: "#000000" } })
    .png()
    .toBuffer();
  state.render.mockReset();
  state.render.mockImplementation(async () => png);
});

describe("card PDF download", () => {
  it.each(["layout=card", "layout=sheet&paper=letter", "layout=sheet&paper=a4"])(
    "%s renders the card through the (square) print path at 600 ppi, no bleed",
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(state.render).toHaveBeenCalledWith(expect.anything(), {
        ppi: 600,
        bleed: false,
        brandMark: false,
        watermarkText: null,
      });
    },
  );

  it("bleed=1: the single card with its bleed, on a page that declares its trim", async () => {
    const res = await get("layout=card&bleed=1");
    expect(res.status).toBe(200);
    expect(state.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ppi: 600, bleed: true }));
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-bleed.pdf"');
    const page = (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPage(0);
    expect(page.getTrimBox()).toEqual({ x: 27, y: 27, width: 180, height: 252 });
  });

  it.each(["layout=sheet&paper=letter&bleed=1", "layout=sheet&paper=a4&bleed=1"])(
    "%s: a bleed sheet is refused (single card only)",
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(state.render).not.toHaveBeenCalled();
    },
  );
});
