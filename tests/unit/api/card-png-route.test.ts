import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// GET /api/cards/[id]/png — "a card downloads the way it looks" (TODO 0.21).
// A FREE (watermarked) download serves the stored bake whenever the owner
// simply hasn't accepted a newer opt-in look, so it matches the gallery
// tile; a pending platform correction (null stamp / sweep bump) and a PAID
// clean download render live. The ETag follows the bake's stamps so a
// re-baked card never answers 304 with the old bytes.
// ---------------------------------------------------------------------------

const STORAGE = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png?v=1";
const ID = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  card: null as Record<string, unknown> | null,
  paid: false,
  render: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.card }) }) }) }),
  }),
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}), isAdminConfigured: () => false }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
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

import { GET } from "@/app/api/cards/[id]/png/route";
import { NextRequest } from "next/server";

let storedPng: Buffer;
let livePng: Buffer;

function card(patch: Record<string, unknown>) {
  return {
    id: ID,
    slug: "c",
    owner_id: "o",
    visibility: "public",
    updated_at: "2026-09-20T00:00:00Z",
    rendered_at: "2026-09-21T00:00:00Z",
    rendered_image_url: STORAGE,
    frame_style: { template: "m15" },
    rarity: "uncommon",
    set_icon_url: null,
    set_icon_code: null,
    ...patch,
  };
}

async function download(preset = "default", headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost/api/cards/${ID}/png?preset=${preset}`, { headers });
  return GET(request, { params: Promise.resolve({ id: ID }) });
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zkwkisxoqdhdchqyjwdc.supabase.co");
  storedPng = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: "#102030" } }).png().toBuffer();
  livePng = await sharp({ create: { width: 750, height: 1050, channels: 4, background: "#ff0000" } }).png().toBuffer();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(storedPng), { status: 200, headers: { "content-type": "image/png" } })),
  );
  state.render.mockReset();
  state.render.mockResolvedValue(new Response(new Uint8Array(livePng)));
  state.paid = false;
});

async function topLeftRed(res: Response) {
  const { data } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  return data[0];
}

describe("card PNG download", () => {
  it("free viewer + owner kept the older (opt-in) look → the stored bake, matching the gallery", async () => {
    state.card = card({ layout_version: 21 });
    const res = await download();
    expect(res.status).toBe(200);
    expect(state.render).not.toHaveBeenCalled();
    expect(await topLeftRed(res)).toBe(0x10);
  });

  it("free viewer + a pending platform correction (null stamp) → live render", async () => {
    state.card = card({ layout_version: null });
    const res = await download();
    expect(res.status).toBe(200);
    expect(state.render).toHaveBeenCalledTimes(1);
    // Watermark policy: a free viewer's live render carries the mark.
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "default", { brandMark: true, watermarkText: null });
    expect(await topLeftRed(res)).toBe(0xff);
  });

  it("paid viewer → always a live clean render (no stored clean source)", async () => {
    state.paid = true;
    state.card = card({ layout_version: 21 });
    const res = await download("hd");
    expect(state.render).toHaveBeenCalledWith(expect.anything(), "hd", { brandMark: false, watermarkText: null });
    expect(res.status).toBe(200);
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
