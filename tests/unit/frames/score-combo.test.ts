import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import registryPrintings from "../cards/fixtures/reference-printings.json";
import { FRAME_REFERENCES, frameReferenceOptions, type FrameColorKey } from "@/lib/cards/frame-reference-registry";
import type { FrameProfileOverridesMap, SlotPath } from "@/lib/cards/profile-override";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// scoreFrameCombo — the work behind POST /api/admin/frame-align-score, the
// verify tick's recorded score and the score batch (TODO 0.18: until now
// every caller's test mocked it away). Only the edges are stubbed: the
// Scryfall payload + scan download and our own render. The reference pick,
// the profile's slots, the scan geometry and sharp are the real ones; the
// registered scorer (lib/frames/align.ts, tested on its own) is a spy that
// records the two grids it is handed, and runs for real end to end once.
// These tests pin:
//
//   * which printing is scored: an explicit registry `ref`, else the pinned
//     one, else the registry default; a ref the registry doesn't list is
//     never rendered; a resolved `referenceId` from an admin-gated caller
//     skips the review read;
//   * the refusals: 404 with no printing, 502 when Scryfall can't give the
//     payload / scan URL / scan — and nothing rendered for a 404;
//   * what is rendered: the payload's preview with THE override map the
//     caller hashes, no brand mark, round corners;
//   * the grids (TODO 0.1): a landscape frame's portrait scan is turned 90°
//     clockwise and compared on the 1040×745 grid, and both images are
//     flattened onto black so our transparent corners match the scan's;
//   * a double-faced reference (TODO 5.0d), on the REAL payload builder and
//     the registry's captured printings: the bake is handed the payload's
//     preview and nothing else — so a front's cross-face block (the back's
//     P/T, the icon family, the modal strip's word, line and key) is on it,
//     as on the compare page.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  reviews: new Map<string, unknown>(),
  reviewReads: 0,
  overrides: {} as Record<string, unknown>,
  overrideReads: 0,
  payload: vi.fn(),
  render: vi.fn(),
  fetchScan: vi.fn(),
  /** Captured Scryfall printings the REAL payload builder is served (the
   *  double-faced cases); empty for every other test. */
  cards: new Map<string, unknown>(),
}));

vi.mock("@/lib/cards/frame-reviews", () => ({
  getFrameReviews: async () => {
    state.reviewReads += 1;
    return state.reviews;
  },
}));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  getFrameProfileOverrides: async () => {
    state.overrideReads += 1;
    return state.overrides;
  },
}));
vi.mock("@/lib/scryfall/reference-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/reference-preview")>();
  return { FrameCompareFaceError: actual.FrameCompareFaceError, buildFrameComparePayload: state.payload };
});
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    fetchScryfallImage: state.fetchScan,
    getCardById: async (id: string) => (state.cards.has(id) ? actual.scryfallCardSchema.parse(state.cards.get(id)) : null),
  };
});
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: state.render }));
// The real scorer, behind a spy: most tests swap in a cheap fake that
// records the two greyscale grids it was handed (the scoring itself has its
// own tests in align.test.ts); the end-to-end ones run the real thing.
vi.mock("@/lib/frames/align", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frames/align")>();
  return { ...actual, alignAndScore: vi.fn(actual.alignAndScore) };
});

import { resolveReferenceId, scoreFrameCombo } from "@/lib/frames/score-combo";
import * as align from "@/lib/frames/align";

const realAlign = (await vi.importActual<typeof import("@/lib/frames/align")>("@/lib/frames/align"))
  .alignAndScore;
const alignSpy = vi.mocked(align.alignAndScore);
/** The real payload builder (its Scryfall lookup served from `state.cards`). */
const realBuildPayload = (
  await vi.importActual<typeof import("@/lib/scryfall/reference-preview")>("@/lib/scryfall/reference-preview")
).buildFrameComparePayload;

type AlignInput = Parameters<typeof realAlign>[0];

/** A fake scorer: records its input, answers a fixed per-slot score. */
function fakeAlign(input: AlignInput) {
  return {
    global: { dxPx: 0, dyPx: 0, dxPct: 0.2, dyPct: -0.1, confidence: 0.7 },
    overall: 3.5,
    perSlot: Object.fromEntries(
      input.slots.map((slot, index) => [slot.path, { score: index + 1, best: index, dxPct: 0.1, dyPct: 0 }]),
    ),
  };
}

const alignInput = (call = 0) => alignSpy.mock.calls[call][0];

// lotr/u lists two printings (default first); lotr/c lists none.
const [LOTR_U_DEFAULT, LOTR_U_ALT] = frameReferenceOptions("lotr", "u");
const PINNED = "0b5b9131-4f7e-4912-ba47-63ed82f21d1b";
const SCAN_URL = "https://cards.scryfall.io/png/front/3/0/scan.png";

// ---------------------------------------------------------------------------
// Synthetic cards: black with white lines at uneven spacings (so a turned or
// mirrored image can't pass for the original), optionally with transparent
// corners like our round-cornered render.
// ---------------------------------------------------------------------------

function cardPixels(width: number, height: number, transparentCorners: boolean) {
  const data = Buffer.alloc(width * height * 4);
  const corner = Math.round(width * 0.05);
  const xs = [0.04, 0.11, 0.3, 0.52, 0.61, 0.9].map((f) => Math.round(f * width));
  const ys = [0.03, 0.09, 0.2, 0.47, 0.55, 0.83, 0.95].map((f) => Math.round(f * height));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const line =
        xs.some((lx) => x >= lx && x < lx + 3) || ys.some((ly) => y >= ly && y < ly + 3);
      const inCorner =
        (x < corner || x >= width - corner) && (y < corner || y >= height - corner);
      if (inCorner && transparentCorners) {
        // Transparent WHITE: only a flatten onto black reads it as black.
        data.set([255, 255, 255, 0], i);
      } else if (inCorner) {
        data.set([0, 0, 0, 255], i);
      } else {
        const v = line ? 255 : 0;
        data.set([v, v, v, 255], i);
      }
    }
  }
  return data;
}

async function renderPng(width: number, height: number): Promise<Buffer> {
  return sharp(cardPixels(width, height, true), { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** The printed card as Scryfall serves it: opaque, black corners — and for
 *  a landscape frame, a PORTRAIT file with the content turned 90° CCW. */
async function scanPng(width: number, height: number, turnCcw = false): Promise<Buffer> {
  let image = sharp(cardPixels(width, height, false), { raw: { width, height, channels: 4 } });
  if (turnCcw) image = image.rotate(270);
  return image.removeAlpha().png().toBuffer();
}

function scanResult(png: Buffer) {
  return { blob: new Blob([new Uint8Array(png)], { type: "image/png" }), contentType: "image/png" };
}

function payloadFor(scryfallId: string) {
  return {
    preview: { title: `Card ${scryfallId}`, colorIdentity: ["blue"], frameStyle: { template: "lotr" } },
    scanUrl: SCAN_URL,
    cardName: `Card ${scryfallId}`,
    patch: {},
    scryfallUri: null,
  };
}

beforeEach(async () => {
  state.reviews = new Map();
  state.reviewReads = 0;
  state.overrides = { lotr: { title: { rect: { topPct: 5 } } } };
  state.overrideReads = 0;
  state.payload.mockReset();
  state.payload.mockImplementation(async (id: string) => payloadFor(id));
  state.cards.clear();
  const ours = await renderPng(745, 1040);
  const scan = await scanPng(745, 1040);
  state.render.mockReset();
  state.render.mockImplementation(async () => new Response(new Uint8Array(ours)));
  state.fetchScan.mockReset();
  state.fetchScan.mockImplementation(async () => scanResult(scan));
  alignSpy.mockReset();
  alignSpy.mockImplementation(fakeAlign);
});

describe("resolveReferenceId", () => {
  it("takes an explicit registry pick without reading the reviews", async () => {
    state.reviews.set("lotr/u", { referenceScryfallId: PINNED, referenceName: "Pinned", referenceSet: "ltr" });
    expect(await resolveReferenceId("lotr", "u", LOTR_U_ALT.scryfallId)).toBe(LOTR_U_ALT.scryfallId);
    expect(state.reviewReads).toBe(0);
  });

  it("ignores a ref the registry doesn't list for the combo: pinned, then the default", async () => {
    // lotr/w's printing is a real registry id — just not one of lotr/u's.
    const foreign = FRAME_REFERENCES.lotr.w!.scryfallId;
    state.reviews.set("lotr/u", { referenceScryfallId: PINNED, referenceName: "Pinned", referenceSet: "ltr" });
    expect(await resolveReferenceId("lotr", "u", foreign)).toBe(PINNED);

    state.reviews = new Map();
    expect(await resolveReferenceId("lotr", "u", foreign)).toBe(LOTR_U_DEFAULT.scryfallId);
    expect(await resolveReferenceId("lotr", "u")).toBe(LOTR_U_DEFAULT.scryfallId);
  });

  it("is null for a combo with no printing and no pin", async () => {
    expect(frameReferenceOptions("lotr", "c")).toEqual([]);
    expect(await resolveReferenceId("lotr", "c")).toBeNull();
  });
});

describe("scoreFrameCombo — refusals", () => {
  it("404s a combo with no printing, rendering and fetching nothing", async () => {
    expect(await scoreFrameCombo({ template: "lotr", color: "c" })).toEqual({
      ok: false,
      error: "No reference printing for this combination.",
      status: 404,
    });
    expect(state.payload).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
    expect(state.fetchScan).not.toHaveBeenCalled();
  });

  it("502s when Scryfall can't give the printing or its scan URL", async () => {
    state.payload.mockResolvedValueOnce(null);
    expect(await scoreFrameCombo({ template: "lotr", color: "u" })).toEqual({
      ok: false,
      error: "Could not resolve the reference scan.",
      status: 502,
    });
    state.payload.mockResolvedValueOnce({ ...payloadFor("x"), scanUrl: null });
    expect(await scoreFrameCombo({ template: "lotr", color: "u" })).toMatchObject({ ok: false, status: 502 });
    expect(state.fetchScan).not.toHaveBeenCalled();
  });

  it("502s when the scan download fails", async () => {
    state.fetchScan.mockResolvedValueOnce(null);
    expect(await scoreFrameCombo({ template: "lotr", color: "u" })).toEqual({
      ok: false,
      error: "Could not download the scan.",
      status: 502,
    });
  });
});

describe("scoreFrameCombo — what is scored", () => {
  it("scores the pinned printing, fetching its scan and naming it in the result", async () => {
    state.reviews.set("lotr/u", { referenceScryfallId: PINNED, referenceName: "Pinned", referenceSet: "ltr" });
    const result = await scoreFrameCombo({ template: "lotr", color: "u" });
    expect(state.payload).toHaveBeenCalledWith(PINNED, "lotr", "front");
    expect(state.fetchScan).toHaveBeenCalledWith(SCAN_URL);
    expect(result).toMatchObject({ ok: true, referenceId: PINNED });
  });

  it("uses a caller-resolved referenceId as is, without a review read", async () => {
    state.reviews.set("lotr/u", { referenceScryfallId: PINNED, referenceName: "Pinned", referenceSet: "ltr" });
    const result = await scoreFrameCombo({ template: "lotr", color: "u", referenceId: LOTR_U_ALT.scryfallId });
    expect(state.reviewReads).toBe(0);
    expect(state.payload).toHaveBeenCalledWith(LOTR_U_ALT.scryfallId, "lotr", "front");
    expect(result).toMatchObject({ ok: true, referenceId: LOTR_U_ALT.scryfallId });
  });

  it("renders the payload's preview with the caller's override map, no brand mark, round corners", async () => {
    const overrides = { lotr: { type: { rect: { topPct: 57 } } } };
    await scoreFrameCombo({ template: "lotr", color: "u", overrides: overrides as never });
    expect(state.overrideReads).toBe(0);
    expect(state.render).toHaveBeenCalledTimes(1);
    const [preview, variant, options] = state.render.mock.calls[0];
    expect(preview).toMatchObject({ title: `Card ${LOTR_U_DEFAULT.scryfallId}` });
    expect(preview.profileOverrides).toBe(overrides);
    expect(variant).toBe("default");
    expect(options).toEqual({ brandMark: false, corners: "round" });
  });

  it("reads the saved overrides when the caller passes none", async () => {
    await scoreFrameCombo({ template: "lotr", color: "u" });
    expect(state.overrideReads).toBe(1);
    expect(state.render.mock.calls[0][0].profileOverrides).toBe(state.overrides);
  });

  it("scores every slot of the frame's profile and reports each one", async () => {
    const result = await scoreFrameCombo({ template: "lotr", color: "u" });
    if (!result.ok) throw new Error(result.error);
    const paths = alignInput().slots.map((slot) => slot.path as SlotPath);
    expect(paths).toEqual(expect.arrayContaining(["artSlot", "title", "type", "rules"]));
    expect(alignInput().slots.find((slot) => slot.path === "artSlot")?.kind).toBe("art");
    for (const path of paths) {
      expect(result.slots[path], path).toBeDefined();
      expect(result.perSlot[path], path).toBe(result.slots[path]!.score);
    }
    expect(result).toMatchObject({
      overall: 3.5,
      global: { dxPct: 0.2, dyPct: -0.1, confidence: 0.7 },
    });
  });

  it("scores only the slots the reference printing's kind draws (TODO 4.5.0)", async () => {
    const onWalker = async (cardType: string | undefined) => {
      state.payload.mockImplementation(async (id: string) => {
        const payload = payloadFor(id);
        return { ...payload, preview: { ...payload.preview, cardType, frameStyle: { template: "m15pw" } } };
      });
      alignSpy.mockClear();
      await scoreFrameCombo({ template: "m15pw", color: "u", referenceId: PINNED });
      return alignInput().slots.map((slot) => slot.path);
    };
    // A planeswalker printing is scored against the loyalty shield…
    expect(await onWalker("planeswalker")).toContain("loyalty");
    // …a creature printing pinned on the walker frame never is.
    const creature = await onWalker("creature");
    expect(creature).not.toContain("loyalty");
    expect(creature).toEqual(expect.arrayContaining(["artSlot", "title", "type", "rules"]));
    // A printing with no card type keeps every slot, as before.
    expect(await onWalker(undefined)).toContain("loyalty");
  });

  it("lays the slots out from the override map it renders with", async () => {
    const overrides = { lotr: { title: { rect: { topPct: 12.5 } } } };
    await scoreFrameCombo({ template: "lotr", color: "u", overrides: overrides as never });
    expect(alignInput().slots.find((slot) => slot.path === "title")?.rect.topPct).toBe(12.5);
  });
});

describe("scoreFrameCombo — grids", () => {
  it("compares a portrait frame on the 745×1040 grid, both images flattened onto black", async () => {
    await scoreFrameCombo({ template: "lotr", color: "u" });
    const { ours, scan } = alignInput();
    expect([ours.width, ours.height]).toEqual([745, 1040]);
    expect([scan.width, scan.height]).toEqual([745, 1040]);
    // One byte per pixel (the alpha channel is gone) …
    expect(ours.data.length).toBe(745 * 1040);
    // … and our transparent corner reads black, like the printed one.
    expect(ours.data[0]).toBe(0);
    expect(Buffer.from(ours.data).equals(Buffer.from(scan.data))).toBe(true);
  });

  it("turns a landscape frame's portrait scan 90° clockwise onto the 1040×745 grid", async () => {
    // battle is landscape: our render is 7:5, Scryfall's PNG is the 5:7
    // printed card with the content turned 90° counter-clockwise.
    const ours = await renderPng(1040, 745);
    state.render.mockImplementation(async () => new Response(new Uint8Array(ours)));
    state.fetchScan.mockResolvedValue(scanResult(await scanPng(1040, 745, true)));

    await scoreFrameCombo({ template: "battle", color: "r" });
    const input = alignInput();
    expect([input.ours.width, input.ours.height]).toEqual([1040, 745]);
    expect([input.scan.width, input.scan.height]).toEqual([1040, 745]);
    // Turned back, the printed card is our render pixel for pixel.
    expect(Buffer.from(input.ours.data).equals(Buffer.from(input.scan.data))).toBe(true);
  });

  it("end to end: a render scores as a match against its own printing, and a mismatch doesn't", async () => {
    alignSpy.mockImplementation(realAlign);
    const same = await scoreFrameCombo({ template: "lotr", color: "u" });
    if (!same.ok) throw new Error(same.error);
    expect(same.overall).toBeLessThan(0.5);
    expect(same.global).toMatchObject({ dxPct: 0, dyPct: 0 });
    expect(same.slots.title!.score).toBeLessThan(0.5);

    // A landscape printing served un-turned lands sideways on the grid.
    const ours = await renderPng(1040, 745);
    state.render.mockImplementation(async () => new Response(new Uint8Array(ours)));
    state.fetchScan.mockResolvedValue(scanResult(await scanPng(1040, 745, false)));
    const sideways = await scoreFrameCombo({ template: "battle", color: "r" });
    if (!sideways.ok) throw new Error(sideways.error);
    expect(sideways.overall).toBeGreaterThan(same.overall + 2);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// A double-faced reference (TODO 5.0d). The scorer bakes the payload's
// preview AS GIVEN — the renderer derives nothing (lib/render/card-image.tsx
// reads `card.dfc`; only a STORED card's bake maps its row through
// lib/cards/faces.ts) — while the compare page's live preview derives a
// front's cross-face block by itself. So a front was scored without its
// reverse P/T, its icon rider and its modal strip, beside a page that showed
// them. The payload now carries the block (frontPreviewData, in
// buildFrameComparePayload), and with it the printing's icon family: what is
// baked is the payload's preview plus the override map, nothing else.
// ---------------------------------------------------------------------------

describe("scoreFrameCombo — a double-faced reference is baked as the compare page shows it (TODO 5.0d)", () => {
  const overrides = {} as FrameProfileOverridesMap;

  beforeEach(() => {
    for (const [id, card] of Object.entries(registryPrintings)) state.cards.set(id, card);
    state.payload.mockImplementation(realBuildPayload);
  });

  /** Score the combo's registry reference #index and hand back what the
   *  bake was given — held equal to the compare page's own expression: the
   *  payload's preview for the face the template is compared on, with the
   *  override map (app/(app)/admin/frame-compare/page.tsx). */
  async function bakedFor(template: FrameTemplate, color: FrameColorKey, index = 0) {
    const reference = frameReferenceOptions(template, color)[index];
    const result = await scoreFrameCombo({ template, color, ref: reference.scryfallId, overrides });
    if (!result.ok) throw new Error(result.error);
    expect(result.referenceId).toBe(reference.scryfallId);
    expect(state.render).toHaveBeenCalledTimes(1);
    const [baked, variant, options] = state.render.mock.calls[0];
    expect(variant).toBe("default");
    expect(options).toEqual({ brandMark: false, corners: "round" });
    const payload = await realBuildPayload(reference.scryfallId, template, result.face);
    if (!payload) throw new Error("no payload");
    expect(baked).toEqual({ ...payload.preview, profileOverrides: overrides });
    expect(baked.profileOverrides).toBe(overrides);
    return { baked, reference, face: result.face };
  }

  it("a transform front (MOM #43): the back's P/T for the grey tab and the ▲ family", async () => {
    const { baked, reference, face } = await bakedFor("m15dfcfront", "w");
    expect(`${reference.set} ${reference.name}`).toBe("mom Tarkir Duneshaper");
    expect(face).toBe("front");
    expect(baked.dfc).toEqual({
      layout: "transform",
      role: "front",
      icon: "arrows",
      // Burnished Dunestomper, a 4/3 Phyrexian Warrior.
      otherFace: { typeWord: "Warrior", line: null, printsPt: true, power: "4", toughness: "3", stripKey: "w" },
    });
    expect(baked.frameStyle).not.toHaveProperty("dfcIcon");
  });

  it("a sun / moon front (MID #169): the printing's family, not the default", async () => {
    const { baked, reference } = await bakedFor("m15dfcfront", "g", 1);
    expect(`${reference.set} ${reference.name}`).toBe("mid Bird Admirer");
    expect(baked.dfc).toEqual({
      layout: "transform",
      role: "front",
      icon: "sunmoon",
      // Wing Shredder, a 3/5.
      otherFace: { typeWord: "Werewolf", line: null, printsPt: true, power: "3", toughness: "5", stripKey: "g" },
    });
    expect(baked.frameStyle).toMatchObject({ template: "m15dfcfront", dfcIcon: "sunmoon" });
  });

  it("the transform land front (INR #287): Ormendahl's 9/7 in the tab", async () => {
    const { baked } = await bakedFor("m15dfclandfront", "c");
    expect(baked.dfc).toMatchObject({
      layout: "transform",
      role: "front",
      icon: "arrows",
      otherFace: { typeWord: "Demon", printsPt: true, power: "9", toughness: "7" },
    });
  });

  it("a modal front (STX #147): the strip's word, line and key are the back's", async () => {
    const { baked, reference } = await bakedFor("m15mdfcfront", "g", 1);
    expect(`${reference.set} ${reference.name}`).toBe("stx Augmenter Pugilist");
    expect(baked.dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Sorcery", line: "{3}{U}{U}", printsPt: false, power: null, toughness: null, stripKey: "u" },
    });
    // …on the back body the import stores, in its own colour (5.1c).
    expect(baked.backFace).toMatchObject({ frame_style: { template: "m15mdfcback" }, color_identity: ["blue"] });
  });

  it("a pathway front (ZNR #259): the land back's mana line and colour", async () => {
    const { baked, reference } = await bakedFor("m15mdfclandfront", "w");
    expect(`${reference.set} ${reference.name}`).toBe("znr Brightclimb Pathway");
    expect(baked.dfc).toEqual({
      layout: "modal",
      role: "front",
      icon: null,
      otherFace: { typeWord: "Land", line: "{T}: Add {B}.", printsPt: false, power: null, toughness: null, stripKey: "b" },
    });
  });

  it("the 2016–22 back (MID #27) is scored on its back with the moon's family — as before for its block, now for its glyph", async () => {
    const { baked, reference, face } = await bakedFor("m15dfcbackleft", "w");
    expect(`${reference.set} ${reference.name}`).toBe("mid Luminous Phantom");
    expect(face).toBe("back");
    expect(baked.dfc).toEqual({
      layout: "transform",
      role: "back",
      icon: "sunmoon",
      otherFace: { typeWord: "Cleric", line: "{W}", printsPt: true, power: "1", toughness: "1", stripKey: "w" },
    });
    expect(baked.frameStyle).toEqual({ template: "m15dfcbackleft", dfcIcon: "sunmoon" });
  });

  it("a single-faced reference is baked as it always was: no block, no family", async () => {
    // The registry capture keeps scans for the double-faced printings only.
    const serra = FRAME_REFERENCES.m15.w!.scryfallId;
    state.cards.set(serra, { ...(state.cards.get(serra) as object), image_uris: { png: SCAN_URL } });
    const { baked } = await bakedFor("m15", "w");
    expect(baked).not.toHaveProperty("dfc");
    expect(baked.frameStyle).not.toHaveProperty("dfcIcon");
  });
});
