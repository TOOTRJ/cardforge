import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";
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

  it("a second face's P/T plate (flip, layout v38): only when the bottom creature has a P/T, beside the front's", () => {
    const flip = card({
      power: "2",
      toughness: "1",
      frameStyle: { template: "flip" },
      backFace: { title: "Dokai, Weaver of Life", card_type: "creature", supertype: "Legendary", subtypes: ["Human", "Monk"], power: "3", toughness: "3" },
    });
    expect(frameAssetPathsFor(flip)).toEqual(["/frames/flip/pt/g-top.png", "/frames/flip/pt/g-bottom.png"]);
    // No P/T on the bottom half: no bottom plate (the top keeps its own).
    expect(frameAssetPathsFor({ ...flip, backFace: { ...flip.backFace!, power: undefined, toughness: undefined } })).toEqual(["/frames/flip/pt/g-top.png"]);
    // …and none on the top: only the bottom plate.
    expect(frameAssetPathsFor({ ...flip, power: null, toughness: null })).toEqual(["/frames/flip/pt/g-bottom.png"]);
    // The plate follows the card's plate key (a colourless flip: the
    // pack's colourless plate).
    expect(frameAssetPathsFor({ ...flip, colorIdentity: ["colorless"] })).toEqual(["/frames/flip/pt/c-top.png", "/frames/flip/pt/c-bottom.png"]);
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

  // The preload side of the contract: frameAssetPathsFor lists exactly the
  // plates drawnStatSlots says the card draws. The renderer side — CardImage
  // reads no plate the preload didn't list — is checked on real bakes with
  // an empty cache below ("every plate a card draws was preloaded").
  it("lists exactly drawnStatSlots' plates on every template, for every card type", () => {
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

// ---------------------------------------------------------------------------
// Every plate a card draws was preloaded (review of 4.5.0). The frame-asset
// cache is module-global, so a bake that reads a plate its own preload left
// out is served silently from an EARLIER bake's preload — in a warm lambda,
// in the visual matrix, in a corpus replay — and only a cold bake shows it
// (a transparent pixel on Vercel, where public/frames isn't bundled). So each
// case bakes with an EMPTY cache over a stubbed bucket that publishes every
// plate of its body — the git-backed ones too, so a plate read without a
// preload warns ("was not preloaded") instead of being read from disk — and
// the bake must log no such warning. This is what keeps CardImage's draw
// gates and frameAssetPathsFor from drifting apart: both call drawnStatSlots
// today; a draw site that stops doing so fails here.
// ---------------------------------------------------------------------------

const REAL_MANIFEST_KEYS = Object.keys(
  (JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib/frames/frame-manifest.json"), "utf8")) as { files: Record<string, unknown> })
    .files,
);

/** Every plate file a body's stat slots can name (its manifest objects and
 *  its git files), as manifest keys ("m15/pt/g.png"). */
function platesOf(template: FrameTemplate): string[] {
  const layout = getFrameProfile(template);
  const plates = new Set<string>();
  for (const slot of [layout.pt, layout.loyalty, layout.defense]) {
    const pathTemplate = slot?.plateAssetPathTemplate;
    if (!pathTemplate) continue;
    const dir = pathTemplate.replace(/^\/frames\//, "").replace(/\{color\}\.png$/, "");
    for (const key of REAL_MANIFEST_KEYS) {
      if (key.startsWith(dir) && key.endsWith(".png") && !key.slice(dir.length).includes("/")) plates.add(key);
    }
    const local = path.join(process.cwd(), "public/frames", dir);
    if (fs.existsSync(local)) for (const f of fs.readdirSync(local)) if (f.endsWith(".png")) plates.add(`${dir}${f}`);
  }
  return [...plates].sort();
}

describe("every plate a card draws was preloaded (empty cache, every plate published)", () => {
  let restoreStorage: () => void = () => {};
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetFrameAssetCacheForTests();
  });

  const walker = { cardType: "planeswalker" as const, loyalty: "4", rulesText: "+1: Scry 1.\n−2: Draw a card." };
  const vehicle = {
    cardType: "artifact" as const,
    subtypes: ["Vehicle"],
    colorIdentity: ["colorless" as const],
    cost: "{3}",
    power: "3",
    toughness: "3",
  };
  /** `draws`: the plate the card draws, as its manifest key without ".png"
   *  (null: none). */
  const CASES: { name: string; card: CardPreviewData; draws: string | null }[] = [
    { name: "a creature on m15", card: card({ power: "2", toughness: "2" }), draws: "m15/pt/g" },
    { name: "an instant with a stray P/T", card: card({ cardType: "instant", power: "2", toughness: "2" }), draws: null },
    {
      name: "a hybrid two-colour creature (the grey plate)",
      card: card({ power: "2", toughness: "2", cost: "{W/U}{W/U}", colorIdentity: ["white", "blue"], frameStyle: { template: "m15", twoColor: true } }),
      draws: "m15/pt/c",
    },
    {
      name: "a Creature token",
      card: card({ cardType: "token", supertype: "Creature", power: "1", toughness: "1", frameStyle: { template: "m15token" } }),
      draws: "m15/pt/g",
    },
    {
      name: "a stored word-less token",
      card: card({ cardType: "token", supertype: null, power: "1", toughness: "1", frameStyle: { template: "m15token" } }),
      draws: "m15/pt/g",
    },
    {
      name: "an Artifact token (no P/T printed)",
      card: card({ cardType: "token", supertype: "Artifact", power: "1", toughness: "1", frameStyle: { template: "m15tokenartifact" } }),
      draws: null,
    },
    { name: "a Vehicle on m15artifact", card: card({ ...vehicle, frameStyle: { template: "m15artifact" } }), draws: "m15artifact/pt/c" },
    {
      name: "a Spacecraft on m15artifact",
      card: card({ ...vehicle, subtypes: ["Spacecraft"], frameStyle: { template: "m15artifact" } }),
      draws: "m15artifact/pt/c",
    },
    {
      name: "a Vehicle on the borderless artifact skin",
      card: card({ ...vehicle, frameStyle: { template: "m15borderlessartifact" } }),
      draws: "m15borderlessartifact/pt/c",
    },
    { name: "a walker on m15pw", card: card({ ...walker, frameStyle: { template: "m15pw" } }), draws: "m15pw/loyalty/g" },
    {
      name: "a walker on the borderless walker",
      card: card({ ...walker, frameStyle: { template: "m15borderlesspw" } }),
      draws: "m15borderlesspw/loyalty/g",
    },
    {
      name: "a walker on the tall borderless walker",
      card: card({ ...walker, frameStyle: { template: "m15borderlesspwtall" } }),
      draws: "m15borderlesspwtall/loyalty/g",
    },
    { name: "a creature on the walker body", card: card({ power: "2", toughness: "2", frameStyle: { template: "m15pw" } }), draws: null },
    {
      name: "a battle with a defense",
      card: card({ cardType: "battle", subtypes: ["Siege"], defense: "5", frameStyle: { template: "battle" } }),
      draws: null,
    },
    {
      name: "a saga creature",
      card: card({ cardType: "enchantment", supertype: "Creature", subtypes: ["Saga"], power: "3", toughness: "3", colorIdentity: ["white"], frameStyle: { template: "saga" } }),
      draws: null,
    },
    { name: "a creature on modern (git plates)", card: card({ power: "2", toughness: "2", frameStyle: { template: "modern" } }), draws: "modern/pt/g" },
    {
      name: "a creature on the Tarkir Ghostfire showcase (git plates)",
      card: card({ power: "2", toughness: "2", frameStyle: { template: "tarkirghostfire" } }),
      draws: "tarkirghostfire/pt/g",
    },
  ];

  it.each(CASES)("$name", async ({ card: c, draws }) => {
    const template = (c.frameStyle?.template ?? "m15") as FrameTemplate;
    const plates = platesOf(template);
    const plate = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
      .png()
      .toBuffer();
    const bucket = await bucketWith(Object.fromEntries(plates.map((key) => [key, plate])), []);
    resetFrameAssetCacheForTests();
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        fetched.push(String(input));
        const buf = bucket.byUrl.get(String(input));
        return buf
          ? new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } })
          : new Response(null, { status: 503 });
      }),
    );
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({ manifest: bucket.manifest, origin: ORIGIN });

    const res = await renderCardImage(c, "default", { brandMark: false, watermarkText: null });
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBeGreaterThan(0);

    expect(warnings.filter((w) => /was not preloaded/.test(w))).toEqual([]);
    // Not vacuous: a body that draws a plate publishes it, and the one the
    // card draws was fetched (only a plate the card draws is).
    const platesFetched = fetched.filter((u) => u.startsWith(ORIGIN) && /\/(pt|loyalty|defense)\//.test(u));
    if (draws) {
      expect(plates).toContain(`${draws}.png`);
      expect(platesFetched.some((u) => u.startsWith(`${ORIGIN}/${draws}.`)), platesFetched.join(", ")).toBe(true);
    } else {
      expect(platesFetched).toEqual([]);
    }
  });
});
