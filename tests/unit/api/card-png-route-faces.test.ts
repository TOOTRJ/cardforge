import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/png?face=back (TODO 5.3) — the BACK face of a
// double-faced card, with every option the front has:
//
//   * a FREE viewer's download is the stored BACK bake (rendered_back_image_url
//     — the one hasServableStoredRender(row, "back") rule), never the front's
//     object; a card with a back the page flips to but no back bake (a legacy
//     back) renders live, watermarked, like any card without a servable bake;
//   * a PAID viewer's is a live clean render of the back's own mapping
//     (lib/cards/faces.ts: the back's body, colour and art), and so are the
//     print variants (ppi=800, bleed=1|mpc, print=1) through the print path;
//   * the file is <slug>-back.png / -back-square.png / -back.jpg /
//     -back-800ppi.png / -back-mpc.png / -back-print.png;
//   * `face` joins the ETag only for the back: every FRONT download keeps
//     the tag it had (main's formula, verbatim), and a back never answers
//     304 to a front's tag;
//   * a card with no back to flip to answers 404; a front request on a
//     double-faced card is the front, exactly as before.
//
// `?faces=both` (TODO 5.3c, owner decision 2026-10-05): BOTH faces in ONE
// PNG — the front left, the back right, a transparent gutter of 1/25 of a
// face's width between them on a transparent canvas — each half byte-equal
// to what `face=front` / `face=back` serve at the same options (the stored
// bakes, a live render where a face has none, the corner, the preset),
// named <slug>-both.png / -both-square.png, its own ETag; 404 on a card with
// no back, 400 on a print variant or a JPEG (one face each) before any
// lookup; `face=back` wins over `faces=both` (the pdf route's reading).
// ---------------------------------------------------------------------------

const ID = "22222222-2222-4222-8222-222222222222";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/o`;
const FRONT_BAKE = `${RENDERS}/${ID}.png?v=1`;
const BACK_BAKE = `${RENDERS}/${ID}.back.png?v=1`;

const state = vi.hoisted(() => ({
  card: null as Record<string, unknown> | null,
  paid: false,
  render: vi.fn(),
  print: vi.fn(),
  viewer: null as { id: string } | null,
  activity: vi.fn(),
  fetched: [] as string[],
  /** Card row lookups (a refused request must make none). */
  lookups: 0,
  /** The anonymous live-render limiter, one call per live render. */
  limit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.lookups += 1;
            return { data: state.card };
          },
        }),
      }),
    }),
  }),
  getCurrentUser: async () => state.viewer,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => true }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: state.activity }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () =>
    state.paid ? { maxExportPreset: "hd", removeWatermark: true } : { maxExportPreset: "default", removeWatermark: false },
  downloadBrandMark: (v: { removeWatermark: boolean }) => !v.removeWatermark,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-image", async (orig) => ({
  ...(await orig<typeof import("@/lib/render/card-image")>()),
  renderCardImage: state.render,
}));
vi.mock("@/lib/render/card-print", () => ({ renderCardPrint: state.print }));
vi.mock("@/lib/cards/anon-render-limit", () => ({ checkAnonLiveRenderLimit: (...args: unknown[]) => state.limit(...args) }));

import { GET } from "@/app/api/cards/[id]/png/route";
import { NextRequest } from "next/server";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { FACE_GUTTER_OF_WIDTH, faceGutterPx } from "@/lib/render/faces-side-by-side";

type Rendered = { card: { title?: string; dfc?: { role: string } | null; frameStyle?: { template?: string } } };

/** A transform card on the 5.1a bodies, read with `select("*")` as the route
 *  does: baked at the current version on both faces. */
function dfcCard(patch: Record<string, unknown> = {}) {
  return {
    id: ID,
    slug: "c",
    owner_id: "o",
    visibility: "public",
    updated_at: "2026-10-02T00:00:00Z",
    rendered_at: "2026-10-02T01:00:00Z",
    rendered_image_url: FRONT_BAKE,
    rendered_back_image_url: BACK_BAKE,
    layout_version: CARD_LAYOUT_VERSION,
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

/** The same card as the 8 imported DFCs: a legacy back, no back bake. */
function legacyCard() {
  const card = dfcCard({ frame_style: { template: "m15", finish: "regular" }, rendered_back_image_url: null });
  const { frame_style: _b, color_identity: _c, ...back } = card.back_face as Record<string, unknown>;
  void _b;
  void _c;
  return { ...card, back_face: back };
}

async function download(query: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(`http://localhost/api/cards/${ID}/png?${query}`, { headers }), {
    params: Promise.resolve({ id: ID }),
  });
}

let frontPng: Buffer;
let backPng: Buffer;
let livePng: Buffer;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only");
  frontPng = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: "#102030" } }).png().toBuffer();
  backPng = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: "#605040" } }).png().toBuffer();
  livePng = await sharp({ create: { width: 750, height: 1050, channels: 4, background: "#ff0000" } }).png().toBuffer();
  state.fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      state.fetched.push(url);
      const bytes = url.includes(".back.png") ? backPng : frontPng;
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  state.render.mockReset();
  state.render.mockImplementation(async () => new Response(new Uint8Array(livePng)));
  state.print.mockReset();
  state.print.mockImplementation(async () =>
    sharp({ create: { width: 2000, height: 2800, channels: 3, background: "#00ff00" } }).png().toBuffer(),
  );
  state.activity.mockReset();
  state.viewer = null;
  state.paid = false;
  state.card = dfcCard();
  state.lookups = 0;
  state.limit.mockReset();
  state.limit.mockResolvedValue({ ok: true });
});

async function centre(res: Response): Promise<number[]> {
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const o = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
  return [data[o], data[o + 1], data[o + 2]];
}

describe("the back face of a double-faced card (TODO 5.3)", () => {
  it("a free viewer's back download is the stored BACK bake — its own object, never the front's — named <slug>-back.png", async () => {
    const res = await download("preset=default&corners=round&face=back");
    expect(res.status).toBe(200);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.fetched).toEqual([BACK_BAKE]);
    expect(await centre(res)).toEqual([0x60, 0x50, 0x40]);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-back.png"');
    // The Square and the JPEG of the back, from the same bake.
    expect((await download("preset=default&corners=square&face=back")).headers.get("content-disposition")).toBe(
      'attachment; filename="c-back-square.png"',
    );
    expect((await download("preset=default&format=jpeg&face=back")).headers.get("content-disposition")).toBe(
      'attachment; filename="c-back.jpg"',
    );
    expect(state.render).not.toHaveBeenCalled();
  });

  it("the front of the same card is the front's bake, as before", async () => {
    const res = await download("preset=default&corners=round");
    expect(res.status).toBe(200);
    expect(state.fetched).toEqual([FRONT_BAKE]);
    expect(await centre(res)).toEqual([0x10, 0x20, 0x30]);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c.png"');
  });

  it("no back bake yet (the pointer null) → the back renders live, watermarked, from the back's own mapping", async () => {
    state.card = dfcCard({ rendered_back_image_url: null });
    const res = await download("preset=default&corners=round&face=back");
    expect(res.status).toBe(200);
    expect(state.fetched).toEqual([]);
    expect(state.render).toHaveBeenCalledTimes(1);
    const [rendered, preset, opts] = state.render.mock.calls[0] as [Rendered["card"], string, unknown];
    expect(preset).toBe("default");
    expect(opts).toEqual({ brandMark: true, watermarkText: null, corners: "round" });
    expect(rendered).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15dfcback" }, dfc: { role: "back" } });
  });

  it("a pending platform correction (null stamp) takes the back's bake off the table too — ONE stamp per card", async () => {
    state.card = dfcCard({ layout_version: null });
    await download("preset=default&corners=round&face=back");
    expect(state.fetched).toEqual([]);
    expect(state.render).toHaveBeenCalledTimes(1);
  });

  it("a legacy two-faced card's back (no body, no bake) renders live as the page draws it: the back's words on the front's frame", async () => {
    state.card = legacyCard();
    const res = await download("preset=default&corners=round&face=back");
    expect(res.status).toBe(200);
    expect(state.render).toHaveBeenCalledTimes(1);
    const [rendered] = state.render.mock.calls[0] as [Rendered["card"]];
    expect(rendered).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15" }, dfc: null });
    // …and its front is still the stored front bake.
    state.render.mockClear();
    await download("preset=default&corners=round");
    expect(state.render).not.toHaveBeenCalled();
  });

  it("a paid viewer's back is a live clean render of the back; the print variants go through the print path on the back's mapping", async () => {
    state.paid = true;
    const res = await download("preset=hd&corners=round&face=back");
    expect(res.status).toBe(200);
    expect(state.fetched).toEqual([]);
    expect(state.render).toHaveBeenCalledWith(expect.objectContaining({ title: "Elder Wolf", dfc: expect.objectContaining({ role: "back" }) }), "hd", {
      brandMark: false,
      watermarkText: null,
      corners: "round",
    });
    for (const [query, filename, print] of [
      ["ppi=800&corners=square&face=back", "c-back-800ppi.png", { ppi: 800, bleed: false }],
      ["ppi=600&corners=square&bleed=mpc&face=back", "c-back-mpc.png", { ppi: 600, bleed: "mpc" }],
      ["ppi=600&corners=square&bleed=1&face=back", "c-back-bleed.png", { ppi: 600, bleed: true }],
      ["ppi=600&corners=square&print=1&face=back", "c-back-print.png", { ppi: 600, bleed: false }],
    ] as const) {
      state.print.mockClear();
      const printed = await download(query);
      expect(printed.status, query).toBe(200);
      expect(printed.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
      expect(state.print).toHaveBeenCalledWith(expect.objectContaining({ title: "Elder Wolf", frameStyle: expect.objectContaining({ template: "m15dfcback" }) }), {
        ...print,
        brandMark: false,
        watermarkText: null,
      });
    }
  });

  it("a card with no back to flip to answers 404 for face=back; an unknown face is the front", async () => {
    state.card = dfcCard({ back_face: null, rendered_back_image_url: null });
    const res = await download("preset=default&corners=round&face=back");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This card has no back face." });
    expect(state.render).not.toHaveBeenCalled();
    const front = await download("preset=default&corners=round&face=sideways");
    expect(front.status).toBe(200);
    expect(front.headers.get("content-disposition")).toBe('attachment; filename="c.png"');
  });

  it("the face is in the ETag only for the back: the front keeps main's tag, a back never answers 304 to it", async () => {
    const c = state.card as Record<string, unknown>;
    // origin/main's ETag inputs, verbatim (no pip or frame overrides, no
    // footer text, no format or print in these fixtures).
    const mainEtag = (preset: string, corners: string, wm: boolean) =>
      `W/"${createHash("sha1")
        .update([c.id, c.updated_at, c.rendered_at, c.layout_version, preset, corners, wm ? "wm" : "clean", "", CARD_LAYOUT_VERSION, "null", "null"].join("|"))
        .digest("hex")
        .slice(0, 27)}"`;
    const front = (await download("preset=default&corners=round")).headers.get("etag")!;
    expect(front).toBe(mainEtag("default", "round", true));
    const back = (await download("preset=default&corners=round&face=back")).headers.get("etag")!;
    expect(back).not.toBe(front);
    expect((await download("preset=default&corners=round&face=back", { "if-none-match": front })).status).toBe(200);
    expect((await download("preset=default&corners=round", { "if-none-match": back })).status).toBe(200);
    expect((await download("preset=default&corners=round&face=back", { "if-none-match": back })).status).toBe(304);
  });

  it("records the face for a signed-in viewer's back download; a front download's props are as before", async () => {
    state.viewer = { id: "viewer-1" };
    await download("preset=default&corners=round&face=back");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "png", preset: "default", clean: false, corners: "round", face: "back" },
    });
    state.activity.mockClear();
    await download("preset=default&corners=round");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "png", preset: "default", clean: false, corners: "round" },
    });
  });
});

// ---------------------------------------------------------------------------
// Both faces in one PNG (TODO 5.3c).
// ---------------------------------------------------------------------------

type Raw = { data: Buffer; width: number; height: number; channels: number };

async function raw(res: Response): Promise<Raw> {
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: meta.channels ?? 0 };
}

/** The RGBA pixels of the columns [left, left + width) of `image`, row by row. */
function columns(image: Raw, left: number, width: number): Buffer {
  const out = Buffer.alloc(width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    image.data.copy(out, y * width * 4, (y * image.width + left) * 4, (y * image.width + left + width) * 4);
  }
  return out;
}

/** A solid-colour face with the card's corner cut transparent (a v31 bake):
 *  its anti-aliased arc has partial alpha, so an exact copy is provable. */
async function roundFace(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  applyCardCornerMask(data, width, height);
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

describe("both faces in one PNG (TODO 5.3c)", () => {
  beforeEach(async () => {
    // Round bakes, so the halves carry partial alpha on their arcs.
    frontPng = await roundFace(1500, 2100, [0x10, 0x20, 0x30]);
    backPng = await roundFace(1500, 2100, [0x60, 0x50, 0x40]);
    // A live render coloured by the face it draws, at the preset's size —
    // so the halves of a both-faces download can be told apart and checked
    // against the single-face answers.
    state.render.mockImplementation(async (card: { title?: string }, preset: "default" | "hd") => {
      const { width, height } = RENDER_PRESETS[preset];
      return new Response(new Uint8Array(await roundFace(width, height, card.title === "Elder Wolf" ? [0, 0xff, 0] : [0xff, 0, 0])));
    });
  });

  /** The composite against its two single-face downloads at `options`:
   *  the size, the exact halves, the transparent gutter. */
  async function expectSideBySide(options: string) {
    const both = await raw(await download(`${options}&faces=both`));
    const front = await raw(await download(options));
    const back = await raw(await download(`${options}&face=back`));
    const gutter = faceGutterPx(front.width);
    expect(gutter).toBe(front.width * FACE_GUTTER_OF_WIDTH);
    expect([both.width, both.height]).toEqual([front.width + gutter + back.width, front.height]);
    expect(both.channels).toBe(4);
    expect(columns(both, 0, front.width).equals(front.data)).toBe(true);
    expect(columns(both, front.width + gutter, back.width).equals(back.data)).toBe(true);
    // The gutter: transparent, every row.
    expect(columns(both, front.width, gutter).equals(Buffer.alloc(gutter * both.height * 4))).toBe(true);
    return { both, front, back, gutter };
  }

  it("a free viewer's both faces are the two stored bakes side by side — each half byte-equal to its own download, a transparent 1/25 gutter between — named <slug>-both.png", async () => {
    const res = await download("preset=default&corners=round&faces=both");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-both.png"');
    expect(state.fetched).toEqual([FRONT_BAKE, BACK_BAKE]);
    expect(state.render).not.toHaveBeenCalled();
    const { both, gutter } = await expectSideBySide("preset=default&corners=round");
    expect([both.width, both.height, gutter]).toEqual([1530, 1050, 30]);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("Square: the two squared faces with the gutter still transparent — <slug>-both-square.png", async () => {
    const res = await download("preset=default&corners=square&faces=both");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c-both-square.png"');
    const { both, front } = await expectSideBySide("preset=default&corners=square");
    // Each face is opaque to its corner (squared), the canvas between is not.
    expect(front.data[3]).toBe(255);
    expect(both.data[(front.width + 1) * 4 + 3]).toBe(0);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("a paid viewer's both faces are two live clean renders at HD — the front then the back — 3060 × 2100", async () => {
    state.paid = true;
    const { both, gutter } = await expectSideBySide("preset=hd&corners=round");
    expect([both.width, both.height, gutter]).toEqual([3060, 2100, 60]);
    expect(state.fetched).toEqual([]);
    // The both-faces download's two renders came first: the front, the back.
    const calls = state.render.mock.calls as [Rendered["card"], string, unknown][];
    expect(calls[0][0]).toMatchObject({ title: "Village Elder", dfc: { role: "front" } });
    expect(calls[1][0]).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15dfcback" }, dfc: { role: "back" } });
    for (const call of calls.slice(0, 2)) {
      expect(call[1]).toBe("hd");
      expect(call[2]).toEqual({ brandMark: false, watermarkText: null, corners: "round" });
    }
  });

  it("a legacy back (no body, no bake): the front from its bake, the back live as the page draws it — each half its own download's", async () => {
    state.card = legacyCard();
    const res = await download("preset=default&corners=round&faces=both");
    expect(res.status).toBe(200);
    expect(state.fetched).toEqual([FRONT_BAKE]);
    expect(state.render).toHaveBeenCalledTimes(1);
    expect(state.render.mock.calls[0][0]).toMatchObject({ title: "Elder Wolf", frameStyle: { template: "m15" }, dfc: null });
    await expectSideBySide("preset=default&corners=round");
  });

  it("a card with no back to flip to answers 404 — nothing fetched or rendered", async () => {
    state.card = dfcCard({ back_face: null, rendered_back_image_url: null });
    const res = await download("preset=default&corners=round&faces=both");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "This card has no back face." });
    expect(state.fetched).toEqual([]);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("never a print file, never a JPEG: 400 before any lookup", async () => {
    for (const query of ["ppi=800&corners=square", "bleed=1&corners=square", "bleed=mpc&corners=square", "print=1&corners=square", "ppi=800&bleed=mpc"]) {
      const res = await download(`${query}&faces=both`);
      expect(res.status, query).toBe(400);
      expect(await res.json()).toEqual({ error: "Print files are one face each — ask for face=front or face=back." });
    }
    const jpeg = await download("preset=default&format=jpeg&faces=both");
    expect(jpeg.status).toBe(400);
    expect((await jpeg.json()).error).toMatch(/^Both faces come as one PNG/);
    expect(state.lookups).toBe(0);
    expect(state.fetched).toEqual([]);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.print).not.toHaveBeenCalled();
    // The same query for ONE face is the print file it was: with `face=back`
    // named, `faces=both` is ignored — the back's print file (clean-only, so
    // 403 for this free viewer; 200 paid).
    expect((await download("ppi=800&corners=square&face=back&faces=both")).status).toBe(403);
    state.paid = true;
    expect((await download("ppi=800&corners=square&face=back&faces=both")).headers.get("content-disposition")).toBe(
      'attachment; filename="c-back-800ppi.png"',
    );
  });

  it("face=back beside faces=both is the back alone (the pdf route's reading); an unknown faces value is the front", async () => {
    const back = await download("preset=default&corners=round&face=back&faces=both");
    expect(back.headers.get("content-disposition")).toBe('attachment; filename="c-back.png"');
    expect((await raw(back)).width).toBe(750);
    const front = await download("preset=default&corners=round&faces=all");
    expect(front.headers.get("content-disposition")).toBe('attachment; filename="c.png"');
    expect((await raw(front)).width).toBe(750);
  });

  it("the ETag is its own: never the front's or the back's, 304 only to itself", async () => {
    const front = (await download("preset=default&corners=round")).headers.get("etag")!;
    const back = (await download("preset=default&corners=round&face=back")).headers.get("etag")!;
    const both = (await download("preset=default&corners=round&faces=both")).headers.get("etag")!;
    expect(new Set([front, back, both]).size).toBe(3);
    expect((await download("preset=default&corners=round&faces=both", { "if-none-match": front })).status).toBe(200);
    expect((await download("preset=default&corners=round&faces=both", { "if-none-match": back })).status).toBe(200);
    expect((await download("preset=default&corners=round", { "if-none-match": both })).status).toBe(200);
    const hit = await download("preset=default&corners=round&faces=both", { "if-none-match": both });
    expect(hit.status).toBe(304);
    expect(hit.headers.get("etag")).toBe(both);
    // The corner is in it too: Square is other bytes.
    expect((await download("preset=default&corners=square&faces=both")).headers.get("etag")).not.toBe(both);
  });

  it("records face: both for a signed-in viewer", async () => {
    state.viewer = { id: "viewer-1" };
    await download("preset=default&corners=round&faces=both");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "png", preset: "default", clean: false, corners: "round", face: "both" },
    });
  });

  it("a signed-out viewer's live renders are counted one per face; a refusal answers 429 + Retry-After, not a 500", async () => {
    // A pending correction: neither bake serves, both faces render live.
    state.card = dfcCard({ layout_version: null });
    const res = await download("preset=default&corners=round&faces=both");
    expect(res.status).toBe(200);
    expect(state.limit).toHaveBeenCalledTimes(2);
    expect(state.render).toHaveBeenCalledTimes(2);
    state.limit.mockReset();
    state.limit
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, retryAfterSeconds: 42, message: "Too many card downloads." });
    const refused = await download("preset=default&corners=round&faces=both");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("42");
    expect(await refused.json()).toEqual({ ok: false, error: "Too many card downloads." });
    // A signed-in viewer is never counted.
    state.limit.mockReset();
    state.limit.mockResolvedValue({ ok: false, retryAfterSeconds: 1, message: "no" });
    state.viewer = { id: "viewer-1" };
    expect((await download("preset=default&corners=round&faces=both")).status).toBe(200);
    expect(state.limit).not.toHaveBeenCalled();
  });
});
