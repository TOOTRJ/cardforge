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
// page (crop marks on the trim, TrimBox/BleedBox).
//
// Sheets (TODO 6.15): the selection export's options — `gap`, `marks`,
// `size` (lib/cards/card-pdf-link.ts) — and a bleed sheet, laid out by the
// same grid (lib/render/sheet-layout.ts): Letter turns landscape (3 × 2),
// A4 too (4 × 2). One page, filled with copies. It used to answer 400.
// ---------------------------------------------------------------------------

const ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  render: vi.fn(),
  batch: true,
  // A free viewer (signed out, or signed in on the free plan) — PDF is Plus+.
  paid: true,
  viewer: null as { id: string } | null,
}));
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
  getCurrentUser: async () => state.viewer,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () =>
    state.paid
      ? { isPaid: true, allowBatchExport: state.batch, removeWatermark: true }
      : { isPaid: false, allowBatchExport: false, removeWatermark: false },
  downloadBrandMark: (v: { removeWatermark: boolean }) => !v.removeWatermark,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/cards/bake-core", () => ({ rowToPreviewData: () => ({ frameStyle: {} }) }));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-print", () => ({ renderCardPrint: state.render }));

import { GET } from "@/app/api/cards/[id]/pdf/route";
import { NextRequest } from "next/server";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, PDFRef } from "pdf-lib";
import { DEFAULT_SHEET_OPTIONS, planSheet } from "@/lib/render/sheet-layout";

/** Each page's size, image draws and line segments (from its content). */
async function pages(res: Response) {
  const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref as PDFRef) as PDFRawStream)
        : [contents as PDFRawStream];
    const tokens = streams
      .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1"))
      .join("\n")
      .split(/\s+/);
    return {
      ...page.getSize(),
      images: tokens.filter((t) => t === "Do").length,
      lines: tokens.filter((t) => t === "l").length,
    };
  });
}

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
  state.batch = true;
  state.paid = true;
  state.viewer = null;
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

});

describe("single-card sheets with the print options (TODO 6.15)", () => {
  it("the plain sheet is still the 3 × 3 with corner marks on portrait Letter", async () => {
    const res = await get("layout=sheet&paper=letter");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-sheet.pdf"');
    expect(await pages(res)).toEqual([{ width: 612, height: 792, images: 9, lines: 72 }]);
  });

  it.each([
    ["letter", [792, 612], 6, "c-sheet-bleed.pdf"],
    ["a4", [841.89, 595.276], 8, "c-sheet-a4-bleed.pdf"],
  ] as const)("a %s bleed sheet renders the card WITH its bleed and makes room: landscape, %s", async (paper, size, cards, filename) => {
    const bleedPng = await sharp({ create: { width: 1650, height: 2250, channels: 3, background: "#000000" } })
      .png()
      .toBuffer();
    state.render.mockImplementation(async () => bleedPng);
    const res = await get(`layout=sheet&paper=${paper}&bleed=1`);
    expect(res.status).toBe(200);
    expect(state.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ppi: 600, bleed: true }));
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
    const [page] = await pages(res);
    expect([page.width, page.height]).toEqual(size);
    expect(page.images).toBe(cards);
    expect(page.images).toBe(planSheet(paper, { ...DEFAULT_SHEET_OPTIONS, bleed: true }).perPage);
  });

  it("gap, full-length lines and 63 × 88 mm reach the grid", async () => {
    const res = await get("layout=sheet&paper=letter&gap=sixteenth&marks=lines&size=mm");
    expect(res.status).toBe(200);
    const plan = planSheet("letter", { gap: "sixteenth", marks: "lines", cardSize: "mm", bleed: false });
    const [page] = await pages(res);
    expect(page.images).toBe(plan.perPage);
    // Full-length lines: one per distinct trim x and y (3 columns and 3
    // rows with a gap: 6 + 6), not 8 corner marks per card.
    expect(page.lines).toBe(2 * plan.cols + 2 * plan.rows);
  });

  it("unknown option values are the defaults", async () => {
    const res = await get("layout=sheet&paper=letter&gap=huge&marks=dots&size=poker");
    expect(await pages(res)).toEqual([{ width: 612, height: 792, images: 9, lines: 72 }]);
  });

  it("a sheet is still Pro: a Plus viewer gets 403 UPGRADE_REQUIRED, and nothing renders", async () => {
    state.batch = false;
    const res = await get("layout=sheet&paper=letter&bleed=1");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("UPGRADE_REQUIRED");
    expect(state.render).not.toHaveBeenCalled();
    // …while the single card (Plus) still downloads.
    expect((await get("layout=card&bleed=1")).status).toBe(200);
  });

  // Every print option this route takes stays behind the paid gate: a free
  // viewer — signed out, or signed in on the free plan — gets 403
  // UPGRADE_REQUIRED before anything renders, whatever the options say.
  it.each([
    ["signed out", null],
    ["signed in, free plan", { id: "free-viewer" }],
  ] as const)("%s: every PDF option answers 403 UPGRADE_REQUIRED, and nothing renders", async (_label, viewer) => {
    state.paid = false;
    state.viewer = viewer;
    for (const query of [
      "layout=card",
      "layout=card&bleed=1",
      "layout=sheet&paper=letter",
      "layout=sheet&paper=a4&bleed=1",
      "layout=sheet&paper=letter&gap=sixteenth&marks=lines&size=mm&bleed=1",
      "sheet=true&bleed=1",
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(403);
      expect((await res.json()).code, query).toBe("UPGRADE_REQUIRED");
    }
    expect(state.render).not.toHaveBeenCalled();
  });
});
