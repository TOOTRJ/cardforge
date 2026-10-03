import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/pdf with faces (TODO 5.3, a double-faced card):
//
//   * `face=back`   → the back alone, rendered through the print path on the
//                     back's own mapping (lib/cards/faces.ts), named
//                     <slug>-back.pdf; a card with no back answers 404;
//   * `faces=both`  → ONE card: two pages, the front then the back (each the
//                     bleed page when asked), named <slug>-both-faces.pdf;
//   * a sheet of a card with a back BODY places the back beside its front
//     by default — the cells run front, back, front, back… (4 pairs on the
//     3 × 3, the ninth cell blank) — and `backs=0` turns that off; a legacy
//     two-faced card's sheet (no body) is the plain sheet, unchanged;
//   * a single-faced card's PDFs are exactly what they were.
// ---------------------------------------------------------------------------

const ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  render: vi.fn(),
  card: null as Record<string, unknown> | null,
  activity: vi.fn(),
  viewer: null as { id: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.card }) }) }) }),
  }),
  getCurrentUser: async () => state.viewer,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => true }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: state.activity }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ isPaid: true, allowBatchExport: true, removeWatermark: true }),
  downloadBrandMark: (v: { removeWatermark: boolean }) => !v.removeWatermark,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-print", () => ({ renderCardPrint: state.render }));

import { GET } from "@/app/api/cards/[id]/pdf/route";
import { NextRequest } from "next/server";
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";

type Rendered = { title?: string; dfc?: { role: string } | null; frameStyle?: { template?: string } };

function dfcCard(patch: Record<string, unknown> = {}) {
  return {
    id: ID,
    slug: "c",
    owner_id: "o",
    visibility: "public",
    title: "Village Elder",
    cost: "{1}{G}",
    card_type: "creature",
    supertype: null,
    subtypes: ["Human"],
    rarity: "uncommon",
    color_identity: ["green"],
    rules_text: "Transform.",
    flavor_text: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artist_credit: null,
    art_url: null,
    art_position: null,
    frame_style: { template: "m15dfcfront", finish: "regular" },
    set_icon_url: null,
    set_icon_code: null,
    back_face: {
      title: "Elder Wolf",
      card_type: "creature",
      subtypes: ["Werewolf"],
      rules_text: "Trample",
      power: "4",
      toughness: "4",
      frame_style: { template: "m15dfcback" },
      color_identity: ["green"],
    },
    face_content: null,
    watermark: null,
    set_code: null,
    collector_number: null,
    lang: null,
    ...patch,
  };
}

function legacyCard() {
  const card = dfcCard({ frame_style: { template: "m15", finish: "regular" } });
  const { frame_style: _b, color_identity: _c, ...back } = card.back_face as Record<string, unknown>;
  void _b;
  void _c;
  return { ...card, back_face: back };
}

/** Each page's size and image draws; which IMAGE each draw is (its XObject's
 *  object reference — pdf-lib names every draw afresh, but the same embedded
 *  PNG keeps one ref). */
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
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    const draws: string[] = [];
    tokens.forEach((t, i) => {
      if (t !== "Do") return;
      const name = tokens[i - 1].slice(1);
      const ref = xobjects?.get(PDFName.of(name));
      draws.push(ref ? ref.toString() : name);
    });
    return { ...page.getSize(), draws };
  });
}

async function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/cards/${ID}/pdf?${query}`), { params: Promise.resolve({ id: ID }) });
}

beforeEach(async () => {
  // Small portrait stand-ins for the two renders: the PDF's structure (its
  // pages, the order of the image draws) is the point here, never the
  // pixels — pdf-lib decodes and re-deflates every embedded PNG in JS, and
  // the HD-sized ones made the two-render cases time out on CI's
  // coverage-instrumented runner. The builder only reads orientation.
  const front = await sharp({ create: { width: 30, height: 42, channels: 3, background: "#102030" } }).png().toBuffer();
  const back = await sharp({ create: { width: 30, height: 42, channels: 3, background: "#605040" } }).png().toBuffer();
  state.render.mockReset();
  state.render.mockImplementation(async (card: Rendered) => (card.dfc?.role === "back" ? back : front));
  state.card = dfcCard();
  state.activity.mockReset();
  state.viewer = null;
});

describe("card PDF faces (TODO 5.3)", () => {
  it("face=back: one page of the back, rendered on the back's own mapping, named <slug>-back.pdf", async () => {
    const res = await get("layout=card&face=back");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-back.pdf"');
    expect(state.render).toHaveBeenCalledTimes(1);
    const [rendered, opts] = state.render.mock.calls[0] as [Rendered, unknown];
    expect(rendered).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15dfcback" }, dfc: { role: "back" } });
    expect(opts).toEqual({ ppi: 600, bleed: false, brandMark: false, watermarkText: null });
    const got = await pages(res);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ width: 180, height: 252 });
  });

  it("faces=both: two pages, the front then the back — each the bleed page when asked — named <slug>-both-faces.pdf", async () => {
    const res = await get("layout=card&faces=both");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-both-faces.pdf"');
    expect(state.render).toHaveBeenCalledTimes(2);
    expect((state.render.mock.calls[0] as [Rendered])[0]).toMatchObject({ title: "Village Elder", dfc: { role: "front" } });
    expect((state.render.mock.calls[1] as [Rendered])[0]).toMatchObject({ title: "Elder Wolf", dfc: { role: "back" } });
    const got = await pages(res);
    expect(got).toHaveLength(2);
    expect(got.map((p) => p.draws.length)).toEqual([1, 1]);
    // Two different images: the back's page draws the second XObject.
    expect(got[0].draws[0]).not.toBe(got[1].draws[0]);

    const bleed = await pages(await get("layout=card&faces=both&bleed=1"));
    expect(bleed).toHaveLength(2);
    // The single-card bleed page: 198 × 270 pt plus the 1/4 in slug.
    expect(bleed[0]).toMatchObject({ width: 234, height: 306 });
    expect(bleed[1]).toMatchObject({ width: 234, height: 306 });
    expect((await get("layout=card&faces=both&bleed=1")).headers.get("content-disposition")).toBe(
      'attachment; filename="c-both-faces-bleed.pdf"',
    );
  });

  it("a sheet of a card with a back body places the back beside its front: front, back, front, back… — 4 pairs on the 3 × 3, the ninth cell blank", async () => {
    const res = await get("layout=sheet&paper=letter");
    expect(res.status).toBe(200);
    // The sheet's name is unchanged: backs are its default.
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-sheet.pdf"');
    expect(state.render).toHaveBeenCalledTimes(2);
    const [page] = await pages(res);
    expect(page.draws).toHaveLength(8);
    const [front, back] = [page.draws[0], page.draws[1]];
    expect(front).not.toBe(back);
    expect(page.draws).toEqual([front, back, front, back, front, back, front, back]);
    // Both renders through the one print contract.
    for (const call of state.render.mock.calls) {
      expect(call[1]).toEqual({ ppi: 600, bleed: false, brandMark: false, watermarkText: null });
    }
  });

  it("backs=0: the sheet of the front only, as before", async () => {
    const res = await get("layout=sheet&paper=letter&backs=0");
    expect(state.render).toHaveBeenCalledTimes(1);
    const [page] = await pages(res);
    expect(page.draws).toHaveLength(9);
    expect(new Set(page.draws).size).toBe(1);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-sheet.pdf"');
  });

  it("a legacy two-faced card (no body): its sheet is the plain sheet, unchanged — but face=back and faces=both still draw the back the page flips to", async () => {
    state.card = legacyCard();
    const sheet = await get("layout=sheet&paper=letter");
    expect(state.render).toHaveBeenCalledTimes(1);
    expect((await pages(sheet))[0].draws).toHaveLength(9);
    state.render.mockClear();
    const back = await get("layout=card&face=back");
    expect(back.status).toBe(200);
    expect((state.render.mock.calls[0] as [Rendered])[0]).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15" } });
    state.render.mockClear();
    expect(await pages(await get("layout=card&faces=both"))).toHaveLength(2);
  });

  it("a single-faced card: face=back and faces=both answer 404; its sheet and card are exactly what they were", async () => {
    state.card = dfcCard({ back_face: null, frame_style: { template: "m15" } });
    expect((await get("layout=card&face=back")).status).toBe(404);
    expect((await get("layout=card&faces=both")).status).toBe(404);
    expect(state.render).not.toHaveBeenCalled();
    const card = await get("layout=card");
    expect(card.headers.get("content-disposition")).toBe('attachment; filename="c.pdf"');
    expect(await pages(card)).toHaveLength(1);
    state.render.mockClear();
    const sheet = await get("layout=sheet&paper=a4");
    expect(state.render).toHaveBeenCalledTimes(1);
    expect((await pages(sheet))[0].draws).toHaveLength(9);
  });

  it("records the faces for a signed-in viewer", async () => {
    state.viewer = { id: "viewer-1" };
    await get("layout=card&faces=both");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "pdf", layout: "card", face: "both" },
    });
    state.activity.mockClear();
    await get("layout=card");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "pdf", layout: "card" },
    });
  });
});
