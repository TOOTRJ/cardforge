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
//
// JPEG (TODO 6.18): `?format=jpeg` is ALWAYS the square card — the Square
// PNG's bytes (the same corner fills, the same tier rules) re-encoded at
// quality 92, 4:4:4, sRGB, no metadata, named <slug>.jpg — with its own ETag.
// No or any other `format` is the PNG, ETag included, exactly as before.
//
// Anonymous live renders (TODO 7.8): a SIGNED-OUT caller's live renders —
// a Square/JPEG that can't be squared from the bake, or any download with no
// servable bake — are capped per network (lib/cards/anon-render-limit.ts,
// migration 0125 modelled by tests/stubs/anon-render-db.ts): over it, 429 +
// Retry-After. Signed-in viewers, stored-bake serves and 304s never count.
// ---------------------------------------------------------------------------

const STORAGE = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png?v=1";
const ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  card: null as Record<string, unknown> | null,
  paid: false,
  render: vi.fn(),
  viewer: null as { id: string } | null,
  activity: vi.fn(),
  admin: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.card }) }) }) }),
  }),
  getCurrentUser: async () => state.viewer,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin, isAdminConfigured: () => true }));
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
import { anonRenderDb } from "@/tests/stubs/anon-render-db";
import { ANON_LIVE_RENDER_LIMITS } from "@/lib/cards/anon-render-limit";
import { CARD_JPEG_QUALITY } from "@/lib/render/card-jpeg";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { createHash } from "node:crypto";

let storedPng: Buffer;
let livePng: Buffer;
let limiter: ReturnType<typeof anonRenderDb>;
// The limiter's clock: fixed, so no run straddles a minute boundary.
const NOW = Date.parse("2026-09-29T12:00:30Z");

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
  format?: string,
) {
  let query = corners ? `preset=${preset}&corners=${corners}` : `preset=${preset}`;
  if (format) query += `&format=${format}`;
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
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only");
  limiter = anonRenderDb({ now: () => NOW });
  state.admin = limiter.client;
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

type DecodedJpeg = {
  buf: Buffer;
  meta: sharp.Metadata;
  at: (x: number, y: number) => number[];
};
async function decodeJpeg(res: Response): Promise<DecodedJpeg> {
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return {
    buf,
    meta,
    at: (x, y) => {
      const o = (y * info.width + x) * info.channels;
      return [data[o], data[o + 1], data[o + 2]];
    },
  };
}
/** JPEG is lossy: a flat colour decodes within a few levels. */
function near(actual: number[], expected: readonly number[], tolerance = 3) {
  expect(actual.map((v, i) => Math.abs(v - expected[i])).every((d) => d <= tolerance), `${actual} ≈ ${expected}`).toBe(true);
}

describe("JPEG download (TODO 6.18)", () => {
  it("a free viewer's JPEG is the stored bake squared in the border black — quality 92, 4:4:4, sRGB, no metadata, <slug>.jpg", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const res = await download("default", {}, undefined, "jpeg");
    expect(res.status).toBe(200);
    expect(state.render).not.toHaveBeenCalled();
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="c.jpg"');
    const jpeg = await decodeJpeg(res);
    expect(res.headers.get("content-length")).toBe(String(jpeg.buf.byteLength));
    expect(jpeg.meta).toMatchObject({ format: "jpeg", width: 750, height: 1050, channels: 3, space: "srgb" });
    expect(jpeg.meta.chromaSubsampling).toBe("4:4:4");
    expect(jpeg.meta.hasProfile).toBe(false);
    expect(jpeg.meta.exif).toBeUndefined();
    expect(jpeg.meta.icc).toBeUndefined();
    expect(jpeg.meta.xmp).toBeUndefined();
    // Square: the corners in the border black, the card as baked.
    near(jpeg.at(0, 0), [0, 0, 0]);
    near(jpeg.at(749, 0), [0, 0, 0]);
    near(jpeg.at(0, 1049), [0, 0, 0]);
    near(jpeg.at(749, 1049), [0, 0, 0]);
    near(jpeg.at(375, 525), [0x10, 0x20, 0x30]);
    // Exactly the Square PNG's pixels, encoded at quality 92.
    expect(CARD_JPEG_QUALITY).toBe(92);
    const squarePng = Buffer.from(await (await download("default", {}, "square")).arrayBuffer());
    const expected = await sharp(squarePng)
      .jpeg({ quality: CARD_JPEG_QUALITY, chromaSubsampling: "4:4:4" })
      .toBuffer();
    expect(jpeg.buf.equals(expected)).toBe(true);
  });

  it("is always square: corners=round still gets the border-black corners, and the same ETag", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const roundAsked = await download("default", {}, "round", "jpeg");
    const jpeg = await decodeJpeg(roundAsked);
    // A round corner flattened would be the root's #101015, not #000.
    near(jpeg.at(0, 0), [0, 0, 0], 2);
    near(jpeg.at(749, 1049), [0, 0, 0], 2);
    const tag = roundAsked.headers.get("etag");
    expect((await download("default", {}, "square", "jpeg")).headers.get("etag")).toBe(tag);
    expect((await download("default", {}, undefined, "jpeg")).headers.get("etag")).toBe(tag);
    expect(roundAsked.headers.get("content-disposition")).toBe('attachment; filename="c.jpg"');
  });

  it("a ring's JPEG corners are the root's #101015, like its Square PNG", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "tarkirdragon" } });
    const jpeg = await decodeJpeg(await download("default", {}, undefined, "jpeg"));
    expect(state.render).not.toHaveBeenCalled();
    near(jpeg.at(0, 0), [16, 16, 21]);
    near(jpeg.at(749, 1049), [16, 16, 21]);
  });

  it("a paid viewer's JPEG is a live clean SQUARE render, re-encoded", async () => {
    state.paid = true;
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const res = await download("hd", {}, "round", "jpeg");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", {
      brandMark: false,
      watermarkText: null,
      corners: "square",
    });
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    near((await decodeJpeg(res)).at(10, 10), [255, 0, 0]);
  });

  it("a free JPEG where a corner keeps its drawn pixels (art-to-edge) renders live square, like the Square PNG", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    const res = await download("default", {}, undefined, "jpeg");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "default", {
      brandMark: true,
      watermarkText: null,
      corners: "square",
    });
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("the format is in the ETag: a JPEG never answers 304 to a PNG's tag, nor a PNG to a JPEG's", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const png = (await download("default", {}, "square")).headers.get("etag")!;
    const jpeg = (await download("default", {}, "square", "jpeg")).headers.get("etag")!;
    expect(png).toBeTruthy();
    expect(jpeg).toBeTruthy();
    expect(jpeg).not.toBe(png);
    expect((await download("default", { "if-none-match": png }, "square", "jpeg")).status).toBe(200);
    expect((await download("default", { "if-none-match": jpeg }, "square")).status).toBe(200);
    expect((await download("default", { "if-none-match": jpeg }, "square", "jpeg")).status).toBe(304);
    // A paid viewer's JPEG differs from their PNG too.
    state.paid = true;
    const paidPng = (await download("hd", {}, "square")).headers.get("etag");
    expect((await download("hd", {}, "square", "jpeg")).headers.get("etag")).not.toBe(paidPng);
  });

  it("no, png or an unknown format is the PNG, byte for byte and ETag for ETag", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    const plain = await download("default", {}, "round");
    const plainBytes = Buffer.from(await plain.arrayBuffer());
    for (const format of ["png", "gif", "JPEG"]) {
      const res = await download("default", {}, "round", format);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="c.png"');
      expect(res.headers.get("etag")).toBe(plain.headers.get("etag"));
      expect(Buffer.from(await res.arrayBuffer()).equals(plainBytes)).toBe(true);
    }
  });

  it("a PNG's ETag is still main's formula — `format` never enters it — so every browser-cached PNG keeps answering 304", async () => {
    // origin/main's ETag inputs before 6.18, verbatim (no pip or frame
    // overrides, no footer text in these fixtures).
    type EtagCard = { id: string; updated_at: string; rendered_at: string | null; layout_version: number | null };
    const mainEtag = (c: EtagCard, preset: string, corners: string, wm: boolean) =>
      `W/"${createHash("sha1")
        .update(
          [c.id, c.updated_at, c.rendered_at ?? "", c.layout_version ?? "", preset, corners, wm ? "wm" : "clean", "", CARD_LAYOUT_VERSION, "null", "null"].join("|"),
        )
        .digest("hex")
        .slice(0, 27)}"`;
    for (const template of ["m15", "fullartland"]) {
      const c = { ...card({ frame_style: { template } }), layout_version: 30 };
      state.card = c;
      for (const format of [undefined, "png", "gif"]) {
        state.paid = false;
        for (const corners of ["round", "square", undefined] as const) {
          const tag = mainEtag(c, "default", corners ?? "square", true);
          const res = await download("default", {}, corners, format);
          expect(res.headers.get("etag"), `${template} ${format} ${corners}`).toBe(tag);
          expect((await download("default", { "if-none-match": tag }, corners, format)).status).toBe(304);
        }
        state.paid = true;
        expect((await download("hd", {}, "round", format)).headers.get("etag")).toBe(mainEtag(c, "hd", "round", false));
      }
    }
  });

  it("records a signed-in viewer's JPEG as format jpeg, square", async () => {
    state.viewer = { id: "viewer-1" };
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    await download("default", {}, "round", "jpeg");
    expect(state.activity).toHaveBeenCalledWith(expect.anything(), {
      userId: "viewer-1",
      kind: "download",
      props: { format: "jpeg", preset: "default", clean: false, corners: "square" },
    });
  });
});

describe("anonymous live renders are rate-limited (TODO 7.8)", () => {
  const LIMIT = ANON_LIVE_RENDER_LIMITS.perMinute;
  const ip = (address: string) => ({ "x-real-ip": address });

  it("a signed-out caller's live Square renders stop at the limit: 429 + Retry-After, no render", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    for (let i = 0; i < LIMIT; i += 1) {
      expect((await download("default", ip("203.0.113.7"), "square")).status).toBe(200);
    }
    expect(state.render).toHaveBeenCalledTimes(LIMIT);
    const over = await download("default", ip("203.0.113.7"), "square");
    expect(over.status).toBe(429);
    // 12:00:30 → the next minute window opens in 30 s.
    expect(over.headers.get("retry-after")).toBe("30");
    expect(await over.json()).toMatchObject({ ok: false, error: expect.stringMatching(/sign in/i) });
    expect(state.render).toHaveBeenCalledTimes(LIMIT);
    // Another network has its own count.
    expect((await download("default", ip("198.51.100.1"), "square")).status).toBe(200);
  });

  it("the JPEG's live path counts against the same limit", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await download("default", ip("203.0.113.7"), "square", i % 2 ? "jpeg" : undefined);
      expect(res.status).toBe(200);
    }
    expect((await download("default", ip("203.0.113.7"), undefined, "jpeg")).status).toBe(429);
    expect((await download("default", ip("203.0.113.7"), "square")).status).toBe(429);
  });

  it("a download with no servable bake (a sweep window) is a live render too, and counts", async () => {
    state.card = card({ layout_version: null });
    for (let i = 0; i < LIMIT; i += 1) {
      expect((await download("default", ip("203.0.113.7"), "round")).status).toBe(200);
    }
    expect((await download("default", ip("203.0.113.7"), "round")).status).toBe(429);
  });

  it("signed-in viewers are never limited, free or paid", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    state.viewer = { id: "viewer-1" };
    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await download("default", ip("203.0.113.7"), "square", i % 2 ? "jpeg" : undefined)).status).toBe(200);
    }
    state.paid = true;
    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await download("hd", ip("203.0.113.7"), "round")).status).toBe(200);
    }
    expect(state.render).toHaveBeenCalledTimes(2 * (LIMIT + 5));
    expect(limiter.calls).toHaveLength(0);
  });

  it("stored-bake serves are never counted: an m15 Square or JPEG, a Rounded art-to-edge card", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "m15" } });
    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await download("default", ip("203.0.113.7"), "square", i % 2 ? "jpeg" : undefined)).status).toBe(200);
    }
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    for (let i = 0; i < LIMIT + 5; i += 1) {
      expect((await download("default", ip("203.0.113.7"), "round")).status).toBe(200);
    }
    expect(state.render).not.toHaveBeenCalled();
    expect(limiter.calls).toHaveLength(0);
  });

  it("a cached download (304) is never limited", async () => {
    state.card = card({ layout_version: 30, frame_style: { template: "fullartland" } });
    let tag = "";
    for (let i = 0; i < LIMIT; i += 1) {
      tag = (await download("default", ip("203.0.113.7"), "square")).headers.get("etag")!;
    }
    expect((await download("default", ip("203.0.113.7"), "square")).status).toBe(429);
    expect((await download("default", { ...ip("203.0.113.7"), "if-none-match": tag }, "square")).status).toBe(304);
  });
});
