import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIT_SETTINGS,
  kitColorIdentity,
  kitFaceSchema,
  kitFrameFor,
  kitPreviewData,
  kitWatermarkFor,
  type KitFace,
} from "@/lib/tools/token-kit/model";

// ---------------------------------------------------------------------------
// The Token Kit's pure core: one design for the whole kit, each token on the
// frame its words and text pick, ONLY where that combo is verified in the
// token's colour (the other design standing in), emblems and helper cards
// on the emblem frame, dungeons never drawn.
// ---------------------------------------------------------------------------

const spirit: KitFace = {
  kind: "token",
  title: "Spirit",
  typeWords: "Creature",
  subtypes: ["Spirit"],
  colors: ["white"],
  rulesText: "Flying",
  flavorText: null,
  power: "1",
  toughness: "1",
};
const treasure: KitFace = {
  kind: "token",
  title: "Treasure",
  typeWords: "Artifact",
  subtypes: ["Treasure"],
  colors: ["colorless"],
  rulesText: "{T}, Sacrifice this artifact: Add one mana of any color.",
  flavorText: null,
  power: null,
  toughness: null,
};
const monarch: KitFace = {
  kind: "helper",
  title: "The Monarch",
  typeWords: null,
  subtypes: [],
  colors: [],
  rulesText: "At the beginning of your end step, draw a card.",
  flavorText: null,
  power: null,
  toughness: null,
};

const keys = (...combos: string[]) => new Set(combos);

describe("kitColorIdentity", () => {
  it("colourless, one colour, a printed pair, gold past two", () => {
    expect(kitColorIdentity([])).toEqual(["colorless"]);
    expect(kitColorIdentity(["colorless"])).toEqual(["colorless"]);
    expect(kitColorIdentity(["green"])).toEqual(["green"]);
    expect(kitColorIdentity(["white", "blue"])).toEqual(["white", "blue"]);
    expect(kitColorIdentity(["white", "blue", "black"])).toEqual(["multicolor"]);
  });
});

describe("kitFrameFor — verified combos only", () => {
  it("the kit's design at the height the text asks for", () => {
    const frame = kitFrameFor(spirit, DEFAULT_KIT_SETTINGS, keys("m20tokentext/w", "m15tokentext/w"));
    expect(frame).toEqual({ ok: true, template: "m20tokentext", design: "fullart", standIn: false });
    const arch = kitFrameFor(spirit, { ...DEFAULT_KIT_SETTINGS, design: "arch" }, keys("m20tokentext/w", "m15tokentext/w"));
    expect(arch).toEqual({ ok: true, template: "m15tokentext", design: "arch", standIn: false });
  });

  it("the Artifact word picks the artifact dress", () => {
    expect(kitFrameFor(treasure, DEFAULT_KIT_SETTINGS, keys("m20tokenartifacttext/c"))).toMatchObject({
      ok: true,
      template: "m20tokenartifacttext",
    });
  });

  it("the other design stands in where the kit's isn't verified; neither = not drawn", () => {
    expect(kitFrameFor(spirit, DEFAULT_KIT_SETTINGS, keys("m15tokentext/w"))).toEqual({
      ok: true,
      template: "m15tokentext",
      design: "arch",
      standIn: true,
    });
    expect(kitFrameFor(spirit, DEFAULT_KIT_SETTINGS, keys("m20tokentext/u"))).toEqual({ ok: false, reason: "unverified" });
  });

  it("the Nyx dress for an Enchantment token where verified, and off when the kit says so", () => {
    const glimmer: KitFace = { ...spirit, title: "Glimmer", typeWords: "Enchantment Creature", subtypes: ["Glimmer"] };
    const verified = keys("m20tokennyxtext/w", "m20tokentext/w");
    expect(kitFrameFor(glimmer, DEFAULT_KIT_SETTINGS, verified)).toMatchObject({ template: "m20tokennyxtext" });
    expect(kitFrameFor(glimmer, { ...DEFAULT_KIT_SETTINGS, nyx: false }, verified)).toMatchObject({ template: "m20tokentext" });
  });

  it("emblems and helper cards on the emblem frame; a dungeon never", () => {
    expect(kitFrameFor(monarch, DEFAULT_KIT_SETTINGS, keys("emblem/c"))).toMatchObject({ ok: true, template: "emblem" });
    expect(kitFrameFor(monarch, DEFAULT_KIT_SETTINGS, keys())).toEqual({ ok: false, reason: "unverified" });
    const dungeon: KitFace = { ...monarch, title: "Tomb of Annihilation", typeWords: "Dungeon" };
    expect(kitFrameFor(dungeon, DEFAULT_KIT_SETTINGS, keys("emblem/c"))).toEqual({ ok: false, reason: "dungeon" });
  });
});

describe("kitPreviewData", () => {
  const state = { artUrl: null, artistCredit: null, artPosition: null };

  it("a common token with the kit's symbol, its text and stats, the frame drawn", () => {
    const preview = kitPreviewData(spirit, { ...DEFAULT_KIT_SETTINGS, setIconCode: "dmu" }, state, keys("m20tokentext/w"));
    expect(preview?.data).toMatchObject({
      title: "Spirit",
      cardType: "token",
      supertype: "Creature",
      subtypes: ["Spirit"],
      rarity: "common",
      colorIdentity: ["white"],
      rulesText: "Flying",
      power: "1",
      toughness: "1",
      setIconCode: "dmu",
      artPosition: { focalX: 0.5, focalY: 0.5, scale: 1 },
    });
    expect(preview?.data.frameStyle?.template).toBe("m20tokentext");
    // never a stamp or a collector line on a token
    expect(preview?.data.frameStyle?.stamp).toBeUndefined();
  });

  it("an emblem / helper is colourless with no type words or stats", () => {
    const preview = kitPreviewData(monarch, DEFAULT_KIT_SETTINGS, state, keys("emblem/c"));
    expect(preview?.data).toMatchObject({ cardType: "emblem", colorIdentity: ["colorless"], supertype: null, power: null });
  });

  it("the text alignment travels; null when not drawable", () => {
    const centred = kitPreviewData(spirit, { ...DEFAULT_KIT_SETTINGS, rulesAlign: "center" }, state, keys("m20tokentext/w"));
    expect(centred?.data.frameStyle?.rulesAlign).toBe("center");
    expect(kitPreviewData(spirit, DEFAULT_KIT_SETTINGS, state, keys())).toBeNull();
  });
});

describe("kitWatermarkFor", () => {
  it("only behind text; the token's own mana symbol; a preset", () => {
    expect(kitWatermarkFor(spirit, "none")).toBeNull();
    expect(kitWatermarkFor(spirit, "mana")).toEqual({ kind: "mana", key: "w", size: "normal" });
    expect(kitWatermarkFor({ ...spirit, colors: ["white", "blue"] }, "mana")).toBeNull();
    expect(kitWatermarkFor(spirit, "order-sun")).toEqual({ kind: "preset", key: "order-sun", size: "normal" });
    expect(kitWatermarkFor({ ...spirit, rulesText: null }, "order-sun")).toBeNull();
  });
});

describe("kitFaceSchema", () => {
  it("accepts a face and refuses a blank name or an unknown colour", () => {
    expect(kitFaceSchema.safeParse(spirit).success).toBe(true);
    expect(kitFaceSchema.safeParse({ ...spirit, title: " " }).success).toBe(false);
    expect(kitFaceSchema.safeParse({ ...spirit, colors: ["purple"] }).success).toBe(false);
  });
});
