import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// TODO 5.3 — both faces baked. The save-time bake (lib/cards/bake-render.ts
// bakeAndPersistCardRender, the ONE entry 5.2's one-click move calls too)
// run against mocked storage and clients, as render-storage-writes.test.ts
// does, on a card whose back face has a BODY of its own:
//
//   * the front renders as today, then the back through the SAME renderer
//     on backPreviewData (its own body, colour, art and content; the card's
//     collector fields and watermark) — never a flip inside the flip;
//   * four objects land in the owner's folder (`{id}.png`, `.thumb.webp`,
//     `.back.png`, `.back.thumb.webp`) and the four pointers, rendered_at
//     and ONE layout_version are written in ONE compare-and-set update by
//     the service role;
//   * a back that fails (its art refused, its render throwing, its upload
//     failing) fails the whole bake: nothing persisted, every pointer
//     cleared — and nothing removed from storage (a refused upsert leaves
//     the previous object; the sweep keeps a failed card's pointers);
//   * a LEGACY back (no body — the 8 imported DFCs) gets ONE bake as it
//     always has, its back pointers written null; a card that lost its
//     back body has the stale `.back.*` objects removed with its next bake.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const ART = (name: string) => `${HOST}/storage/v1/object/public/card-art/${USER}/${name}.png`;

type Op = { op: "upload" | "remove"; keys: string[]; contentType?: string };
type RowWrite = { via: "user" | "admin"; payload: Record<string, unknown>; filters: [string, unknown][] };

const state = vi.hoisted(() => ({
  ops: [] as Op[],
  card: null as Record<string, unknown> | null,
  writes: [] as RowWrite[],
  rendered: [] as Array<{ card: Record<string, unknown>; preset: string; opts: unknown }>,
  png: null as Buffer | null,
  failUpload: null as string | null,
  renderThrowsOn: null as "front" | "back" | null,
  artDown: new Set<string>(),
}));

function recordWrite(via: RowWrite["via"], calls: { method: string; args: unknown[] }[]) {
  state.writes.push({
    via,
    payload: calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>,
    filters: calls.filter((c) => c.method === "eq").map((c) => [c.args[0] as string, c.args[1]]),
  });
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const db = chainClient((table, calls): ChainAnswer => {
      if (called(calls, "update")) {
        recordWrite("user", calls);
        return { data: [{ id: CARD }], error: null };
      }
      if (table === "cards" && called(calls, "maybeSingle")) return { data: state.card };
      return { data: null };
    });
    const client = { from: db.client.from };
    Object.defineProperty(client, "storage", {
      get() {
        throw new Error("the user's cookie client must never touch storage (migration 0126)");
      },
    });
    return client;
  },
  getCurrentUser: async () => ({ id: USER }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => {
    const db = chainClient((_table, calls): ChainAnswer => {
      if (called(calls, "update")) {
        recordWrite("admin", calls);
        return { data: [{ id: CARD }], error: null };
      }
      return { data: null };
    });
    return {
      from: db.client.from,
      storage: {
        from: () => ({
          upload: async (key: string, _body: unknown, options: { contentType?: string }) => {
            if (state.failUpload && key.endsWith(state.failUpload)) {
              return { data: null, error: { message: `storage refused ${key}` } };
            }
            state.ops.push({ op: "upload", keys: [key], contentType: options?.contentType });
            return { data: null, error: null };
          },
          remove: async (keys: string[]) => {
            state.ops.push({ op: "remove", keys });
            return { data: [], error: null };
          },
          getPublicUrl: (key: string) => ({ data: { publicUrl: `https://storage.test/card-renders/${key}` } }),
        }),
      },
    };
  },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/render/card-image", () => ({
  renderCardImage: async (card: Record<string, unknown>, preset: string, opts: unknown) => {
    state.rendered.push({ card, preset, opts });
    const face = card.dfc && (card.dfc as { role: string }).role === "back" ? "back" : "front";
    if (state.renderThrowsOn === face) throw new Error(`satori gave up on the ${face}`);
    return new Response(new Uint8Array(state.png!));
  },
}));
vi.mock("@/lib/render/art-source", () => ({
  TRANSPARENT_PIXEL_DATA_URL: "data:image/gif;base64,TRANSPARENT",
  resolveRenderableImage: async (url: string) =>
    state.artDown.has(url) ? null : `data:image/png;base64,${Buffer.from(url).toString("base64")}`,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/lib/pips/queries", () => ({ getPipOverrides: async () => null }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/media/storage-origin", () => ({ ensureStorageOriginRegistered: async () => undefined }));

import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { renderObjectNames } from "@/lib/cards/bake-core";
import { bakedBackOf } from "@/lib/cards/faces";

const NAMES = renderObjectNames(CARD);
const KEY = (name: string) => `${USER}/${name}`;

/** A transform card on the 5.1a bodies: the front on m15dfcfront, the back
 *  on m15dfcback with its own colour, art and content. */
function dfcRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CARD,
    owner_id: USER,
    visibility: "public",
    updated_at: "2026-10-02T00:00:00.000Z",
    title: "Village Elder",
    cost: "{1}{G}",
    card_type: "creature",
    supertype: null,
    subtypes: ["Human", "Werewolf"],
    rarity: "uncommon",
    color_identity: ["green"],
    rules_text: "At the beginning of each upkeep, if no spells were cast last turn, transform Village Elder.",
    flavor_text: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artist_credit: "A. Front",
    art_url: ART("front"),
    art_position: null,
    frame_style: { template: "m15dfcfront", finish: "regular" },
    set_icon_url: null,
    set_icon_code: null,
    back_face: {
      title: "Elder Wolf",
      cost: null,
      card_type: "creature",
      supertype: null,
      subtypes: ["Werewolf"],
      rules_text: "Trample",
      flavor_text: null,
      power: "4",
      toughness: "4",
      artist_credit: "B. Back",
      art_url: ART("back"),
      art_position: null,
      frame_style: { template: "m15dfcback" },
      color_identity: ["green"],
    },
    face_content: null,
    watermark: null,
    set_code: "MID",
    collector_number: "7/277",
    lang: "en",
    rendered_back_image_url: null,
    ...overrides,
  };
}

/** The same card as the 8 imported DFCs store it: a back with no body on
 *  an ordinary front. */
function legacyRow() {
  const row = dfcRow({ frame_style: { template: "m15", finish: "regular" } });
  const { frame_style: _body, color_identity: _colour, ...back } = row.back_face as Record<string, unknown>;
  void _body;
  void _colour;
  return { ...row, back_face: back };
}

const CLEARED = {
  rendered_image_url: null,
  rendered_thumb_url: null,
  rendered_back_image_url: null,
  rendered_back_thumb_url: null,
  rendered_at: null,
  layout_version: null,
};

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_only");
  state.ops.length = 0;
  state.writes.length = 0;
  state.rendered.length = 0;
  state.failUpload = null;
  state.renderThrowsOn = null;
  state.artDown.clear();
  state.card = dfcRow();
  state.png ??= await sharp({ create: { width: 30, height: 42, channels: 4, background: "#345" } }).png().toBuffer();
});

describe("a card with a back body (TODO 5.3)", () => {
  it("renders the front, then the back on its own body through the same renderer, uploads four objects and writes the four pointers in ONE service-role write", async () => {
    const url = await bakeAndPersistCardRender(CARD, USER);
    expect(url).toMatch(new RegExp(`^https://storage\\.test/card-renders/${USER}/${CARD}\\.png\\?v=\\d+$`));

    // Two renders, both HD, marked, no footer text, round — the front's
    // contract on both faces.
    expect(state.rendered).toHaveLength(2);
    const [front, back] = state.rendered;
    expect(front.preset).toBe("hd");
    expect(back.preset).toBe("hd");
    expect(front.opts).toEqual({ brandMark: true, watermarkText: null, corners: "round" });
    expect(back.opts).toEqual({ brandMark: true, watermarkText: null, corners: "round" });
    // The front: the card itself, its art resolved to a data URL, with its
    // dfc block (the back's P/T for the tab).
    expect(front.card).toMatchObject({
      title: "Village Elder",
      frameStyle: { template: "m15dfcfront" },
      artUrl: `data:image/png;base64,${Buffer.from(ART("front")).toString("base64")}`,
      dfc: { role: "front", otherFace: { printsPt: true, power: "4", toughness: "4" } },
    });
    // The back: backPreviewData of the front — its body, colour, content and
    // art (resolved too), the card's collector fields, never a back of its
    // own.
    expect(back.card).toMatchObject({
      title: "Elder Wolf",
      frameStyle: { template: "m15dfcback", finish: "regular" },
      colorIdentity: ["green"],
      artistCredit: "B. Back",
      artUrl: `data:image/png;base64,${Buffer.from(ART("back")).toString("base64")}`,
      setCode: "MID",
      collectorNumber: "7/277",
      backFace: null,
      dfc: { role: "back", otherFace: { power: "2", toughness: "2" } },
    });
    // Apart from the resolved art, the back IS bakedBackOf(front).
    const expectedBack = bakedBackOf({ ...(front.card as object), artUrl: ART("front") } as never)!;
    expect({ ...(back.card as object), artUrl: ART("back") }).toEqual(expectedBack);

    // Four objects in the owner's folder: the PNGs first (front, back), then
    // the thumbs.
    expect(state.ops).toEqual([
      { op: "upload", keys: [KEY(NAMES.png)], contentType: "image/png" },
      { op: "upload", keys: [KEY(NAMES.backPng)], contentType: "image/png" },
      { op: "upload", keys: [KEY(NAMES.thumb)], contentType: "image/webp" },
      { op: "upload", keys: [KEY(NAMES.backThumb)], contentType: "image/webp" },
    ]);

    // ONE write, by the service role, pinned to the card, its owner and the
    // row it rendered — all four pointers, one rendered_at, one stamp.
    expect(state.writes).toHaveLength(1);
    const [write] = state.writes;
    expect(write.via).toBe("admin");
    expect(write.filters).toEqual([
      ["id", CARD],
      ["owner_id", USER],
      ["updated_at", "2026-10-02T00:00:00.000Z"],
    ]);
    const stamp = (write.payload.rendered_image_url as string).match(/\?v=(\d+)$/)![1];
    expect(write.payload).toEqual({
      rendered_image_url: `https://storage.test/card-renders/${KEY(NAMES.png)}?v=${stamp}`,
      rendered_thumb_url: `https://storage.test/card-renders/${KEY(NAMES.thumb)}?v=${stamp}`,
      rendered_back_image_url: `https://storage.test/card-renders/${KEY(NAMES.backPng)}?v=${stamp}`,
      rendered_back_thumb_url: `https://storage.test/card-renders/${KEY(NAMES.backThumb)}?v=${stamp}`,
      rendered_at: expect.any(String),
      layout_version: expect.any(Number),
    });
  });

  it("a back whose art can't load fails the whole bake: no upload, every pointer cleared", async () => {
    state.artDown.add(ART("back"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
      expect(state.rendered.map((r) => (r.card as { title: string }).title)).toEqual(["Village Elder"]);
      expect(state.ops).toEqual([]);
      expect(state.writes).toEqual([expect.objectContaining({ via: "user", payload: CLEARED })]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Back face: Art unavailable/));
    } finally {
      warn.mockRestore();
    }
  });

  it("a back whose render throws fails the whole bake the same way", async () => {
    state.renderThrowsOn = "back";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
      expect(state.rendered).toHaveLength(2);
      expect(state.ops).toEqual([]);
      expect(state.writes).toEqual([expect.objectContaining({ via: "user", payload: CLEARED })]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Back face render failed: satori gave up on the back/));
    } finally {
      warn.mockRestore();
    }
  });

  it("a back PNG that fails to upload fails the bake: every pointer cleared, the front never persisted, nothing removed (the sweep keeps a failed card's pointers — they must not dangle)", async () => {
    state.failUpload = NAMES.backPng;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
      expect(state.ops).toEqual([{ op: "upload", keys: [KEY(NAMES.png)], contentType: "image/png" }]);
      expect(state.writes).toEqual([expect.objectContaining({ via: "user", payload: CLEARED })]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Back face upload failed: storage refused/));
    } finally {
      warn.mockRestore();
    }
  });

  it("a back thumb that fails is not a bake failure: the back PNG's pointer is written, its thumb null", async () => {
    state.failUpload = NAMES.backThumb;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bakeAndPersistCardRender(CARD, USER)).not.toBeNull();
      expect(state.writes[0].payload).toMatchObject({
        rendered_back_image_url: expect.stringContaining(NAMES.backPng),
        rendered_back_thumb_url: null,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("a private card: both faces' objects removed, every pointer cleared on the owner's client, nothing rendered", async () => {
    state.card = dfcRow({ visibility: "private" });
    expect(await bakeAndPersistCardRender(CARD, USER)).toBeNull();
    expect(state.rendered).toEqual([]);
    expect(state.ops).toEqual([{ op: "remove", keys: [NAMES.png, NAMES.thumb, NAMES.backPng, NAMES.backThumb].map(KEY) }]);
    expect(state.writes).toEqual([expect.objectContaining({ via: "user", payload: CLEARED })]);
  });
});

describe("a legacy back (no body) and a card that lost its back", () => {
  it("a legacy two-faced card gets ONE bake, as it always has: the front's pair, the back pointers written null", async () => {
    state.card = legacyRow();
    await bakeAndPersistCardRender(CARD, USER);
    expect(state.rendered).toHaveLength(1);
    expect(state.rendered[0].card).toMatchObject({ title: "Village Elder", frameStyle: { template: "m15" } });
    expect(state.rendered[0].card).not.toHaveProperty("dfc.role");
    // The back's names are removed on every one-face save bake: the save
    // cleared the row's pointers, so it can't say whether a back bake is left.
    expect(state.ops).toEqual([
      { op: "upload", keys: [KEY(NAMES.png)], contentType: "image/png" },
      { op: "remove", keys: [KEY(NAMES.backPng), KEY(NAMES.backThumb)] },
      { op: "upload", keys: [KEY(NAMES.thumb)], contentType: "image/webp" },
    ]);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].payload).toMatchObject({
      rendered_image_url: expect.stringContaining(NAMES.png),
      rendered_thumb_url: expect.stringContaining(NAMES.thumb),
      rendered_back_image_url: null,
      rendered_back_thumb_url: null,
    });
  });

  it("a card that lost its back body, saved (the save cleared its pointers): the stale back names are still removed, the pointers written null", async () => {
    state.card = legacyRow();
    state.card.rendered_back_image_url = null;
    await bakeAndPersistCardRender(CARD, USER);
    expect(state.ops).toEqual([
      { op: "upload", keys: [KEY(NAMES.png)], contentType: "image/png" },
      { op: "remove", keys: [KEY(NAMES.backPng), KEY(NAMES.backThumb)] },
      { op: "upload", keys: [KEY(NAMES.thumb)], contentType: "image/webp" },
    ]);
    expect(state.writes[0].payload).toMatchObject({ rendered_back_image_url: null, rendered_back_thumb_url: null });
  });

  it("a stored back body on a plain front is a stray value: still ONE bake (backBodyOf refuses it)", async () => {
    state.card = dfcRow({ frame_style: { template: "m15", finish: "regular" } });
    await bakeAndPersistCardRender(CARD, USER);
    expect(state.rendered).toHaveLength(1);
    expect(state.ops.filter((op) => op.op === "upload").map((op) => op.keys).flat()).toEqual([KEY(NAMES.png), KEY(NAMES.thumb)]);
    expect(state.writes[0].payload).toMatchObject({ rendered_back_image_url: null });
  });
});
