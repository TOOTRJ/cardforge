import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FrameAssetUnavailableError, resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { drawnStatSlots, frameAssetPathsFor, renderCardImage } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// The bake preloads only the stat plates a card DRAWS (TODO 4.5.0). A body's
// P/T, loyalty and defense plates are type-gated slots — the renderers draw
// one only under printsPowerToughness / showsLoyalty / showsDefense
// (drawnStatSlots) — but the preload used to list every plate the profile
// has, whatever the card, and a bucket plate that fails to load fails the
// whole bake (FrameAssetUnavailableError). So one missing plate coupled
// every card on the body to it: a creature on a walker body whose loyalty
// shield wasn't published could not bake. Pixel-neutral: the plates it no
// longer fetches are the ones nothing draws.
// ---------------------------------------------------------------------------

const card = (over: Partial<CardPreviewData>): CardPreviewData =>
  ({
    title: "Probe",
    cost: "{1}{G}",
    cardType: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["green"],
    rulesText: "",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    frameStyle: { template: "m15", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  }) as unknown as CardPreviewData;

describe("frameAssetPathsFor lists a stat plate only for a card that draws it", () => {
  it("the P/T plate: a creature, a Creature token, a Vehicle or Spacecraft — never an instant, a land or a Treasure", () => {
    expect(frameAssetPathsFor(card({ power: "2", toughness: "2" }))).toEqual(["/frames/m15/pt/g.png"]);
    expect(frameAssetPathsFor(card({ cardType: "instant" }))).toEqual([]);
    // A value alone is not enough: an instant never prints one.
    expect(frameAssetPathsFor(card({ cardType: "instant", power: "2", toughness: "2" }))).toEqual([]);
    // A creature with no value prints no plate either.
    expect(frameAssetPathsFor(card({}))).toEqual([]);
    expect(frameAssetPathsFor(card({ cardType: "land", frameStyle: { template: "m15land" } }))).toEqual([]);
    const vehicle = card({
      cardType: "artifact",
      subtypes: ["Vehicle"],
      colorIdentity: ["colorless"],
      power: "3",
      toughness: "3",
      frameStyle: { template: "m15artifact" },
    });
    expect(frameAssetPathsFor(vehicle)).toEqual(["/frames/m15artifact/pt/c.png"]);
    expect(frameAssetPathsFor({ ...vehicle, subtypes: ["spacecraft "] })).toEqual(["/frames/m15artifact/pt/c.png"]);
    const token = { cardType: "token" as const, power: "1", toughness: "1", frameStyle: { template: "m15token" as const } };
    expect(frameAssetPathsFor(card({ ...token, supertype: "Creature" }))).toEqual(["/frames/m15/pt/g.png"]);
    expect(frameAssetPathsFor(card({ ...token, supertype: "Artifact", frameStyle: { template: "m15tokenartifact" } }))).toEqual([]);
    // A stored token from before the type picker (no type word) keeps its P/T.
    expect(frameAssetPathsFor(card({ ...token, supertype: null }))).toEqual(["/frames/m15/pt/g.png"]);
  });

  it("the loyalty shield: a planeswalker with a starting loyalty — never a creature on the walker body", () => {
    const walker = card({
      cardType: "planeswalker",
      loyalty: "4",
      rulesText: "+1: Scry 1.",
      frameStyle: { template: "m15pw" },
    });
    expect(frameAssetPathsFor(walker)).toEqual(["/frames/m15pw/loyalty/g.png", "/frames/m15pw/loyaltyup.png"]);
    // No starting loyalty: no shield (the badges of its rows still).
    expect(frameAssetPathsFor({ ...walker, loyalty: null })).toEqual(["/frames/m15pw/loyaltyup.png"]);
    expect(frameAssetPathsFor(card({ power: "2", toughness: "2", frameStyle: { template: "m15pw" } }))).toEqual([]);
    expect(
      frameAssetPathsFor({ ...walker, frameStyle: { template: "m15borderlesspwtall" } }),
    ).toEqual(["/frames/m15borderlesspwtall/loyalty/g.png", "/frames/m15pw/loyaltyup.png"]);
  });

  it("follows the renderers' own gates (drawnStatSlots) on every template, for every card type", () => {
    const types = ["creature", "instant", "sorcery", "artifact", "enchantment", "land", "planeswalker", "battle", "token"] as const;
    const templates = ["m15", "m15pw", "battle", "saga", "m15token", "lotr", "m15borderlesspw", "flip"] as const;
    for (const template of templates) {
      for (const cardType of types) {
        const c = card({ cardType, power: "1", toughness: "1", loyalty: "3", defense: "4", frameStyle: { template } });
        const layout = getFrameProfile(template);
        const drawn = drawnStatSlots(layout, c);
        const plates = frameAssetPathsFor(c).filter((p) => !/loyalty(up|down|naught)\.png$/.test(p));
        const expected = [
          drawn.pt ? layout.pt?.plateAssetPathTemplate : undefined,
          drawn.loyalty ? layout.loyalty?.plateAssetPathTemplate : undefined,
          drawn.defense ? layout.defense?.plateAssetPathTemplate : undefined,
        ]
          .filter((t): t is string => Boolean(t))
          .map((t) => t.replace("{color}", "g"));
        expect(plates, `${template}/${cardType}`).toEqual(expected);
      }
    }
  });
});

// Real bakes over a stubbed bucket: the body's master is served, one of its
// plates is published (in the manifest) but can't be fetched.
const ORIGIN = "https://frames.test";

async function bucketWith(served: Record<string, Buffer>, unavailable: string[]) {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const entries: Record<string, { hash: string; sha256: string; bytes: number; width: number; height: number }> = {};
  const byUrl = new Map<string, Buffer>();
  const missing = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
    .png()
    .toBuffer();
  for (const [key, buf] of [...Object.entries(served), ...unavailable.map((k) => [k, missing] as const)]) {
    const sha256 = createHash("sha256").update(buf).digest("hex");
    entries[key] = { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 };
    if (!unavailable.includes(key)) byUrl.set(`${ORIGIN}/${frameObjectKey(key, entries[key].hash)}`, buf);
  }
  return { manifest: { version: 1 as const, bucket: "frames", files: entries }, byUrl };
}

describe("a plate the card doesn't draw can't fail its bake", () => {
  let master: Buffer;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    master = await sharp({ create: { width: 150, height: 210, channels: 4, background: { r: 230, g: 230, b: 230, alpha: 1 } } })
      .png()
      .toBuffer();
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetFrameAssetCacheForTests();
  });

  async function bake(c: CardPreviewData, bucket: Awaited<ReturnType<typeof bucketWith>>) {
    resetFrameAssetCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        return buf
          ? new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } })
          : new Response(null, { status: 503 });
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({ manifest: bucket.manifest, origin: ORIGIN });
    const res = await renderCardImage(c, "default", { brandMark: false, watermarkText: null });
    return Buffer.from(await res.arrayBuffer());
  }

  it("a creature on a walker body whose loyalty shield is unavailable still bakes; a planeswalker on it does not", async () => {
    const bucket = await bucketWith({ "m15pw/g.png": master }, ["m15pw/loyalty/g.png"]);
    const creature = card({ power: "2", toughness: "2", frameStyle: { template: "m15pw" } });
    const png = await bake(creature, bucket);
    expect((await sharp(png).metadata()).width).toBe(750);
    const walker = card({ cardType: "planeswalker", loyalty: "4", rulesText: "+1: Scry 1.", frameStyle: { template: "m15pw" } });
    await expect(bake(walker, bucket)).rejects.toBeInstanceOf(FrameAssetUnavailableError);
  });

  it("an instant on a body whose P/T plate is unavailable still bakes; a creature on it does not", async () => {
    const bucket = await bucketWith({ "m15/g.png": master }, ["m15/pt/g.png"]);
    const png = await bake(card({ cardType: "instant", rulesText: "Draw a card." }), bucket);
    expect((await sharp(png).metadata()).width).toBe(750);
    await expect(bake(card({ power: "2", toughness: "2" }), bucket)).rejects.toBeInstanceOf(FrameAssetUnavailableError);
  });
});
