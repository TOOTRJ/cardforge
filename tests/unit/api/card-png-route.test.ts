import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/png — "a card downloads the way it looks" (TODO 0.21).
// A FREE (watermarked) download serves the stored bake whenever the owner
// simply hasn't accepted a newer opt-in look, so it matches the gallery
// tile; a pending platform correction (null stamp / sweep bump) and a PAID
// clean download render live. The ETag follows the bake's stamps so a
// re-baked card never answers 304 with the old bytes.
//
// Corners (TODO 3.26, owner decisions 2026-09-27): `?corners=round|square`
// for every viewer; a request that names none gets SQUARE (stale deck-export
// tabs, bookmarked and external links). The stored bake is ROUND: a free
// square squares it with the live render's corner fills (the border black,
// #101015 on a ring), except where art or frame design runs into a corner
// (an art-to-edge frame; Bloomburrow, LOTR, Tarkir draconic): a live square
// render. A paid viewer renders live with the requested corner.
// ---------------------------------------------------------------------------

const STORAGE = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png?v=1";
const ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  card: null as Record<string, unknown> | null,
  paid: false,
  render: vi.fn(),
  viewer: null as { id: string } | null,
  activity: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.card }) }) }) }),
  }),
  getCurrentUser: async () => state.viewer,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => state.viewer !== null }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: state.activity }));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () =>
    state.paid ? { maxExportPreset: "hd", removeWatermark: true } : { maxExportPreset: "default", removeWatermark: false },
  downloadBrandMark: (v: { removeWatermark: boolean }) => !v.removeWatermark,
  ownerExportStamp: async () => ({ brandMark: true, footerText: null }),
}));
vi.mock("@/lib/cards/bake-core", () => ({
  rowToPreviewData: (row: { frame_style: unknown }) => ({ frameStyle: row.frame_style }),
}));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/render/card-image", async (orig) => ({
  ...(await orig<typeof import("@/lib/render/card-image")>()),
  renderCardImage: state.render,
}));
// Pinned at layout v30: v31 (the one corner radius) is an UNSCOPED sweep, so
// at v31 no older bake has only the v22 opt-in pending (the "owner kept the
// older look" case). tests/stubs/layout-version-at.ts explains.
vi.mock("@/lib/cards/layout-version", async (importOriginal) => {
  const { layoutVersionAt } = await import("@/tests/stubs/layout-version-at");
  return layoutVersionAt(await importOriginal(), 30);
});

import { GET } from "@/app/api/cards/[id]/png/route";
import { NextRequest } from "next/server";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import { UNTOUCHED_SINCE_V22 } from "@/tests/stubs/layout-scope-cards";

let storedPng: Buffer;
let livePng: Buffer;

// A card whose only look pending below v22 is the v22 opt-in (no sweep since
// changed it), read with `select("*")` as the route does.
function card(patch: Record<string, unknown>) {
  return {
    id: ID,
    slug: "c",
    owner_id: "o",
    visibility: "public",
    updated_at: "2026-09-20T00:00:00Z",
    rendered_at: "2026-09-21T00:00:00Z",
    rendered_image_url: STORAGE,
    ...UNTOUCHED_SINCE_V22,
    ...patch,
  };
}

async function download(
  preset = "default",
  headers: Record<string, string> = {},
  corners?: "round" | "square",
) {
  const query = corners ? `preset=${preset}&corners=${corners}` : `preset=${preset}`;
  const request = new NextRequest(`http://localhost/api/cards/${ID}/png?${query}`, { headers });
  return GET(request, { params: Promise.resolve({ id: ID }) });
}

/** A v31 stored bake: #102030 with the card's corner cut transparent. */
async function roundBake() {
  const w = 1500;
  const h = 2100;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([0x10, 0x20, 0x30, 255], i);
  applyCardCornerMask(data, w, h);
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zkwkisxoqdhdchqyjwdc.supabase.co");
  storedPng = await roundBake();
  livePng = await sharp({ create: { width: 750, height: 1050, channels: 4, background: "#ff0000" } }).png().toBuffer();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(storedPng), { status: 200, headers: { "content-type": "image/png" } })),
  );
  state.render.mockReset();
  state.activity.mockReset();
  state.viewer = null;
  // A fresh Response per call: a body can only be read once.
  state.render.mockImplementation(async () => new Response(new Uint8Array(livePng)));
  state.paid = false;
});

type Decoded = { at: (x: number, y: number) => number[]; channels: number; opaque: boolean };
async function decode(res: Response): Promise<Decoded> {
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    channels: meta.channels ?? 0,
    opaque: (await sharp(buf).stats()).isOpaque,
    at: (x, y) => {
      const o = (y * info.width + x) * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    },
  };
}

describe("card PNG download", () => {
  it("free viewer + owner kept the older (opt-in) look → the stored bake, matching the gallery", async () => {
    state.card = card({ layout_version: 21 });
    const res = await download("default", {}, "round");
    expect(res.status).toBe(200);
    expect(state.render).not.toHaveBeenCalled();
    const png = await decode(res);
    expect(png.at(375, 525)).toEqual([0x10, 0x20, 0x30, 255]);
    // The stored bake's rounded corner, untouched (2× downscaled).
    expect(png.at(0, 0)[3]).toBe(0);
  });

  it("free viewer + a pending platform correction (null stamp) → live render", async () => {
    state.card = card({ layout_version: null });
    const res = await download("default", {}, "round");
    expect(res.status).toBe(200);
    expect(state.render).toHaveBeenCalledTimes(1);
    // Watermark policy: a free viewer's live render carries the mark.
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "default", {
      brandMark: true,
      watermarkText: null,
      corners: "round",
    });
    expect((await decode(res)).at(0, 0)[0]).toBe(0xff);
  });

  it("paid viewer → always a live clean render (no stored clean source), with the requested corner", async () => {
    state.paid = true;
    state.card = card({ layout_version: 21 });
    const res = await download("hd", {}, "round");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", {
      brandMark: false,
      watermarkText: null,
      corners: "round",
    });
    expect(res.status).toBe(200);
    state.render.mockClear();
    await download("hd", {}, "square");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", {
      brandMark: false,
      watermarkText: null,
      corners: "square",
    });
  });

  it("a request that names no corners gets an opaque SQUARE PNG — stale deck-export tabs and old links keep working", async () => {
    // Free: the stored round bake (baked at the pinned current version, so
    // servable), squared in the border black.
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const free = await decode(await download());
    expect(state.render).not.toHaveBeenCalled();
    expect(free.opaque).toBe(true);
    expect(free.at(0, 0).slice(0, 3)).toEqual([0, 0, 0]);
    expect(free.at(749, 1049).slice(0, 3)).toEqual([0, 0, 0]);
    expect(free.at(375, 525).slice(0, 3)).toEqual([0x10, 0x20, 0x30]);
    // Paid: a live square render.
    state.paid = true;
    await download("hd");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", {
      brandMark: false,
      watermarkText: null,
      corners: "square",
    });
  });

  it("free Square on an art-to-edge frame renders live square, so the art keeps its corners", async () => {
    // Baked at the (pinned) current version, so its stored bake is servable.
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    await download("default", {}, "square");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "default", {
      brandMark: true,
      watermarkText: null,
      corners: "square",
    });
    // …while its Rounded download is still the stored bake.
    state.render.mockClear();
    const round = await decode(await download("default", {}, "round"));
    expect(state.render).not.toHaveBeenCalled();
    expect(round.at(0, 0)[3]).toBe(0);
  });

  it("free Square where frame design runs into the corners (LOTR's tan top) renders live square", async () => {
    // lotr (the stub's frame): its master paints the top corners.
    state.card = card({ layout_version: 21 });
    await download("default", {}, "square");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "default", {
      brandMark: true,
      watermarkText: null,
      corners: "square",
    });
    state.render.mockClear();
    await download("default", {}, "round");
    expect(state.render).not.toHaveBeenCalled();
  });

  it("free Square of a ring squares the stored bake with the root's #101015 — its border's colour, not #000", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "tarkirdragon" } });
    const png = await decode(await download("default", {}, "square"));
    expect(state.render).not.toHaveBeenCalled();
    expect(png.opaque).toBe(true);
    expect(png.at(0, 0).slice(0, 3)).toEqual([16, 16, 21]);
    expect(png.at(749, 1049).slice(0, 3)).toEqual([16, 16, 21]);
  });

  it("names the Square file <slug>-square.png (the header wins over the modal's download attribute)", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const square = await download("default", {}, "square");
    expect(square.headers.get("content-disposition")).toBe('attachment; filename="c-square.png"');
    expect((await download()).headers.get("content-disposition")).toBe('attachment; filename="c-square.png"');
    const round = await download("default", {}, "round");
    expect(round.headers.get("content-disposition")).toBe('attachment; filename="c.png"');
  });

  it("records which corner a signed-in viewer downloaded (the owner can see Rounded vs Square use)", async () => {
    state.viewer = { id: "viewer-1" };
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    await download("default", {}, "square");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "png", preset: "default", clean: false, corners: "square" },
    });
  });

  it("an unknown corners value falls back to square", async () => {
    state.paid = true;
    state.card = card({ layout_version: 21 });
    const request = new NextRequest(`http://localhost/api/cards/${ID}/png?preset=hd&corners=oval`);
    await GET(request, { params: Promise.resolve({ id: ID }) });
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", expect.objectContaining({ corners: "square" }));
  });

  it("round and square answer different ETags (the same card, different bytes)", async () => {
    state.card = card({ layout_version: 21 });
    const round = (await download("default", {}, "round")).headers.get("etag");
    const square = (await download("default", {}, "square")).headers.get("etag");
    const unnamed = (await download()).headers.get("etag");
    expect(round).toBeTruthy();
    expect(square).not.toBe(round);
    // No corners = square: the same bytes, the same ETag.
    expect(unnamed).toBe(square);
    expect((await download("default", { "if-none-match": round! }, "square")).status).toBe(200);
    expect((await download("default", { "if-none-match": round! }, "round")).status).toBe(304);
  });

  it("a re-bake changes the ETag even though updated_at did not move", async () => {
    state.card = card({ layout_version: 21 });
    const before = (await download()).headers.get("etag");
    state.card = card({ layout_version: 23, rendered_at: "2026-09-25T00:00:00Z" });
    const after = (await download()).headers.get("etag");
    expect(before).toBeTruthy();
    expect(after).not.toBe(before);
    // Marking the card (a layout save) moves only layout_version.
    const marked = card({ layout_version: null, rendered_at: "2026-09-25T00:00:00Z" });
    state.card = marked;
    expect((await download()).headers.get("etag")).not.toBe(after);
    // A same-version re-bake (legacy-art) only moves rendered_at.
    state.card = card({ layout_version: 23, rendered_at: "2026-09-26T00:00:00Z" });
    expect((await download()).headers.get("etag")).not.toBe(after);
    state.card = card({ layout_version: 23, rendered_at: "2026-09-25T00:00:00Z" });
    // …and the unchanged card still short-circuits to 304.
    expect((await download("default", { "if-none-match": after! })).status).toBe(304);
  });
});
