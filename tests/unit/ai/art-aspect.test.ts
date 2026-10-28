import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48b — an AI card picture is asked for in the shape of its frame's
// art window. Every picture used to be asked for as "4:3", which FLUX.2
// [flex] (the gateway's default image model) drops: it takes width × height
// and answers 1024 × 1024 otherwise — every AI picture on production was
// square. Now the shape is the window's, at today's pixel budget (1024²,
// BFL's megapixel: the first-megapixel price, unchanged).
//
// The gateway is MOCKED (`ai`'s experimental_generateImage): no picture is
// generated and no key is read.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("@/lib/ai/provider", () => ({ isGatewayConfigured: () => true }));
vi.mock("ai", () => ({
  experimental_generateImage: async (args: Record<string, unknown>) => {
    s.calls.push(args);
    return { image: { uint8Array: new Uint8Array([1]), mediaType: "image/jpeg" }, warnings: [] };
  },
  generateText: async () => ({ files: [] }),
}));

import {
  ART_PIXEL_BUDGET,
  ART_PX_MAX,
  ART_PX_MIN,
  ART_PX_STEP,
  ASPECT_SLACK,
  artShapeForAspect,
  artShapeForBackFace,
  artShapeForFace,
  artWindowAspect,
  nearestAspectRatio,
} from "@/lib/ai/art-aspect";
import { faceArtWindow } from "@/lib/cards/art-positioner-window";
import { generateImageWithFallbacks, generatePlainImage, imageShapeArgs } from "@/lib/ai/image-gen";

/** Every template's picture for a red creature: [width x height, the ratio
 *  a ratio-only model is sent, the window's width ÷ height]. A change here
 *  is a change of what every AI picture on that frame is asked for. */
const TABLE: Record<FrameTemplate, [string, string, number]> = {
  m15: ["1184x864", "4:3", 1.366],
  m15land: ["1184x864", "4:3", 1.366],
  m15token: ["960x1088", "1:1", 0.880],
  m15artifact: ["1184x864", "4:3", 1.366],
  m15vehicle: ["1184x864", "4:3", 1.366],
  m15nyx: ["1184x864", "4:3", 1.366],
  m15station: ["848x1200", "3:4", 0.710],
  m15stationland: ["848x1200", "3:4", 0.710],
  m15ub: ["1184x864", "4:3", 1.366],
  m15ubartifact: ["1184x864", "4:3", 1.366],
  m15ubland: ["1184x864", "4:3", 1.366],
  m15snow: ["1184x864", "4:3", 1.366],
  m15snowland: ["1184x864", "4:3", 1.366],
  m15devoid: ["1184x864", "4:3", 1.366],
  m15pw: ["880x1168", "3:4", 0.755],
  m15tokenartifact: ["960x1088", "1:1", 0.880],
  m15tokentext: ["1072x960", "1:1", 1.110],
  m15tokenartifacttext: ["1072x976", "1:1", 1.109],
  m15tokentall: ["1200x864", "4:3", 1.401],
  m15tokenartifacttall: ["1200x864", "4:3", 1.397],
  emblem: ["1040x992", "1:1", 1.045],
  m20token: ["864x1184", "3:4", 0.735],
  m20tokentext: ["864x1184", "3:4", 0.735],
  m20tokentall: ["864x1184", "3:4", 0.735],
  m20tokenartifact: ["864x1184", "3:4", 0.735],
  m20tokenartifacttext: ["864x1184", "3:4", 0.735],
  m20tokenartifacttall: ["864x1184", "3:4", 0.735],
  m20tokennyx: ["864x1184", "3:4", 0.735],
  m20tokennyxtext: ["864x1184", "3:4", 0.735],
  m20tokennyxtall: ["864x1184", "3:4", 0.735],
  m20tokenartifactnyx: ["864x1184", "3:4", 0.735],
  m20tokenartifactnyxtext: ["864x1184", "3:4", 0.735],
  m20tokenartifactnyxtall: ["864x1184", "3:4", 0.735],
  m15borderless: ["896x1168", "3:4", 0.774],
  m15borderlessartifact: ["896x1168", "3:4", 0.774],
  m15borderlessland: ["896x1168", "3:4", 0.774],
  m15borderlessstation: ["896x1168", "3:4", 0.774],
  m15borderlesspw: ["896x1152", "3:4", 0.780],
  m15borderlesspwtall: ["896x1152", "3:4", 0.780],
  m15dfcfront: ["1184x864", "4:3", 1.365],
  m15dfcback: ["1184x864", "4:3", 1.365],
  m15dfcbackleft: ["1184x864", "4:3", 1.365],
  m15dfclandfront: ["1184x864", "4:3", 1.365],
  m15dfclandback: ["1184x864", "4:3", 1.365],
  m15mdfcfront: ["1184x864", "4:3", 1.365],
  m15mdfcback: ["1184x864", "4:3", 1.365],
  m15mdfclandfront: ["1184x864", "4:3", 1.365],
  m15mdfclandback: ["1184x864", "4:3", 1.365],
  m15borderlessdfcfront: ["896x1168", "3:4", 0.774],
  m15borderlessdfcback: ["896x1168", "3:4", 0.774],
  m15borderlessmdfcfront: ["896x1168", "3:4", 0.774],
  m15borderlessmdfcback: ["896x1168", "3:4", 0.774],
  agclassic: ["1136x912", "4:3", 1.240],
  alphaland: ["1136x912", "4:3", 1.240],
  battle: ["1184x864", "4:3", 1.360],
  saga: ["656x1584", "9:21", 0.417],
  sagadfcfront: ["656x1584", "9:21", 0.417],
  sagadfcback: ["656x1584", "9:21", 0.417],
  adventure: ["1184x864", "4:3", 1.364],
  prepare: ["1184x864", "4:3", 1.366],
  flip: ["1392x752", "16:9", 1.842],
  split: ["1232x848", "3:2", 1.462],
  aftermath: ["1680x624", "21:9", 2.701],
  // The Card Conjurer ring window (TODO 4.11, v65): the pack's artBounds, 1202 × 918.
  lotr: ["1168x896", "4:3", 1.309],
  // The Card Conjurer scroll window (TODO 4.11, v62): 1280 × 941.
  lotrscroll: ["1184x864", "4:3", 1.359],
  mysticalarchive: ["992x1056", "1:1", 0.945],
  // The Enchanting Tales showcase (TODO 4.11 wave 2): the art under the
  // whole frame from the title bar down, 1500 × 1821 px.
  enchantingtales: ["928x1120", "3:4", 0.8237],
  // TODO 4.11 (layout v69): print's windows, edge to edge across the card.
  avatar: ["1152x896", "4:3", 1.284],
  bloomburrow: ["1280x816", "3:2", 1.572],
  // TODO 4.11 / 4.35 (layout v70): full bleed, the whole card.
  bloomanime: ["864x1200", "3:4", 0.714],
  // The Tarkir: Dragonstorm showcases (TODO 4.11, v68): the draconic's
  // window and the dragons' gaps, 1390 × 944 px; the ghostfire's inside its
  // painted ring, 1344 × 1806.
  tarkirdraconic: ["1232x832", "3:2", 1.4725],
  tarkirghostfire: ["880x1184", "3:4", 0.7442],
  // The Card Conjurer Tarkir window (TODO 4.11, v67): 1237 × 929 px.
  tarkirdragon: ["1168x880", "4:3", 1.332],
  // The New Capenna Art Deco window (TODO 4.11 wave 2): 1262 × 934 px — the
  // under-frame art is its own layer.
  sncartdeco: ["1184x880", "4:3", 1.351],
  // The Card Conjurer dossier window (TODO 4.11 wave 2): the tilted photo, 1319 × 859 px.
  dossier: ["1264x816", "3:2", 1.5355],
  // The Dominaria United Stained Glass window (TODO 4.11 wave 2): 1382 × 939 px.
  stainedglass: ["1232x832", "3:2", 1.472],
  fullart: ["896x1168", "3:4", 0.7605],
  dndsourcebook: ["1200x848", "4:3", 1.41],
  extendedart: ["1168x896", "4:3", 1.314],
  extendedartland: ["1168x896", "4:3", 1.314],
  extendedartstation: ["896x1168", "3:4", 0.766],
  m15fullartland: ["880x1184", "3:4", 0.737],
  fullartland: ["864x1200", "3:4", 0.714],
  m15fullartlandzen: ["928x1104", "3:4", 0.841],
  m15fullartlandsnc: ["864x1184", "3:4", 0.735],
  m15fullartlandthb: ["880x1184", "3:4", 0.737],
  m15textless: ["864x1200", "3:4", 0.724],
  m15textlessland: ["864x1200", "3:4", 0.724],
  // The Expeditions (TODO 4.11 wave 1, layout v64): CC's window + panel.
  expeditionland: ["976x1056", "1:1", 0.921],
  expeditionlandbfz: ["944x1088", "1:1", 0.867],
  nyx: ["896x1168", "3:4", 0.768],
  retro: ["1136x912", "4:3", 1.239],
  retroland: ["1136x912", "4:3", 1.239],
  modern: ["1184x880", "4:3", 1.358],
  modernland: ["1184x880", "4:3", 1.358],
};

const red = (template: string) => ({ template, colorIdentity: ["red"] as const, cardType: "creature" });

describe("each frame's window → the picture asked for", () => {
  it("names every template", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...FRAME_TEMPLATE_VALUES].sort());
  });

  it.each(FRAME_TEMPLATE_VALUES)("%s", (template) => {
    const shape = artShapeForFace(red(template));
    const [size, ratio, aspect] = TABLE[template];
    expect(`${shape.width}x${shape.height}`).toBe(size);
    expect(shape.aspectRatio).toBe(ratio);
    expect(shape.windowAspect).toBeCloseTo(aspect, 3);
    // The grid, the provider's side limits and today's price.
    expect(shape.width % ART_PX_STEP).toBe(0);
    expect(shape.height % ART_PX_STEP).toBe(0);
    for (const side of [shape.width, shape.height]) {
      expect(side).toBeGreaterThanOrEqual(ART_PX_MIN);
      expect(side).toBeLessThanOrEqual(ART_PX_MAX);
    }
    expect(shape.width * shape.height).toBeLessThanOrEqual(ART_PIXEL_BUDGET);
    // Never a smaller picture than it needs to be: within 6 % of the budget.
    expect(shape.width * shape.height).toBeGreaterThan(ART_PIXEL_BUDGET * 0.94);
    // The shape is the window's (no window today is past the side limits).
    expect(Math.abs(Math.log(shape.width / shape.height / shape.windowAspect))).toBeLessThanOrEqual(ASPECT_SLACK);
  });

  it("is the window the creator's positioner shows — one source, never a second table", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      for (const colorIdentity of [["red"], [], ["white", "blue"]]) {
        const window = faceArtWindow({ frameStyle: { template }, colorIdentity, cardType: "creature" } as never);
        expect(
          artWindowAspect({ template, colorIdentity: colorIdentity as never, cardType: "creature" }),
          `${template} ${colorIdentity.join("+")}`,
        ).toBeCloseTo(window.aspect, 9);
      }
    }
  });

  it("the TODO's windows: M15 landscape; tokens, borderless, walkers, the full-art basics portrait; the saga tall", () => {
    expect(artShapeForFace(red("m15")).aspectRatio).toBe("4:3");
    for (const template of ["m20token", "m15borderless", "m15pw", "m15fullartland", "fullartland", "m15textless", "fullart"]) {
      const shape = artShapeForFace(red(template));
      expect(shape.height, template).toBeGreaterThan(shape.width);
    }
    expect(artShapeForFace(red("saga"))).toMatchObject({ width: 656, height: 1584, aspectRatio: "9:21" });
  });

  it("a colourless card on a see-through master paints for its window, or the one picture under the frame", () => {
    // m15/c crops a window and an under-frame layer from the picture
    // separately: the window is the shape. m15pw/c is ONE picture.
    expect(artShapeForFace({ template: "m15", colorIdentity: [], cardType: "creature" }).aspectRatio).toBe("4:3");
    expect(artShapeForFace({ template: "m15pw", colorIdentity: [], cardType: "planeswalker" }).windowAspect).toBeCloseTo(0.709, 3);
  });

  it("no template is the default frame (M15), as the card then draws", () => {
    expect(artShapeForFace({ template: null, colorIdentity: ["green"], cardType: "land" })).toEqual(artShapeForFace(red("m15")));
  });

  it("a double-faced back paints for its own body; a back with none, for the front's frame", () => {
    const front = { template: "m15dfcfront", colorIdentity: ["white"] as const, cardType: "creature" };
    const onBody = artShapeForBackFace(front, {
      title: "Back",
      card_type: "creature",
      frame_style: { template: "sagadfcback" },
    } as never);
    expect(onBody).toEqual(artShapeForFace({ template: "sagadfcback", colorIdentity: ["white"], cardType: "creature" }));
    expect(onBody.aspectRatio).toBe("9:21");
    const legacy = artShapeForBackFace(front, { title: "Back", card_type: "creature" } as never);
    expect(legacy).toEqual(artShapeForFace(front));
    expect(artShapeForBackFace(front, null)).toEqual(artShapeForFace(front));
  });

  it("the ratio-only answer is the nearest on a log scale; past the side limits the picture is asked at that end", () => {
    expect(nearestAspectRatio(1)).toBe("1:1");
    expect(nearestAspectRatio(1.37)).toBe("4:3");
    expect(nearestAspectRatio(0.77)).toBe("3:4");
    expect(nearestAspectRatio(0.41)).toBe("9:21");
    const wide = artShapeForAspect(5);
    expect(wide).toMatchObject({ width: 1920, height: 544, aspectRatio: "21:9" });
    expect(artShapeForAspect(Number.NaN)).toMatchObject({ width: 1024, height: 1024 });
  });
});

describe("what the gateway is asked", () => {
  beforeEach(() => {
    s.calls = [];
    delete process.env.AI_IMAGE_MODEL;
  });

  it("FLUX.2 gets width × height (size + the provider's own options), never a ratio it drops", () => {
    expect(imageShapeArgs("bfl/flux-2-flex", artShapeForFace(red("m20token")))).toEqual({
      size: "864x1184",
      providerOptions: { blackForestLabs: { width: 864, height: 1184 } },
    });
  });

  it("another model gets the nearest ratio; covers, icons and the banner are asked as before", () => {
    expect(imageShapeArgs("bfl/flux-3-image", artShapeForFace(red("m20token")))).toEqual({ aspectRatio: "3:4" });
    expect(imageShapeArgs("bfl/flux-pro-1.1", artShapeForFace(red("saga")))).toEqual({ aspectRatio: "9:21" });
    expect(imageShapeArgs("bfl/flux-2-flex", "wide")).toEqual({ aspectRatio: "16:9" });
    expect(imageShapeArgs("bfl/flux-2-flex", "banner")).toEqual({ aspectRatio: "21:9" });
    expect(imageShapeArgs("bfl/flux-2-flex", "square")).toEqual({ aspectRatio: "1:1" });
  });

  it("the default model is called with the window's size — the prompt ladder unchanged", async () => {
    const result = await generateImageWithFallbacks(["A painted scene."], artShapeForFace(red("m15borderless")));
    expect(result.ok).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({
      model: "bfl/flux-2-flex",
      prompt: "A painted scene.",
      size: "896x1168",
      providerOptions: { blackForestLabs: { width: 896, height: 1168 } },
    });
    expect(s.calls[0]).not.toHaveProperty("aspectRatio");
  });

  it("an AI_IMAGE_MODEL override that is not FLUX.2 is sent the ratio", async () => {
    process.env.AI_IMAGE_MODEL = "bfl/flux-pro-1.1";
    await generatePlainImage("A painted scene.", artShapeForFace(red("saga")));
    expect(s.calls[0]).toMatchObject({ model: "bfl/flux-pro-1.1", aspectRatio: "9:21" });
    expect(s.calls[0]).not.toHaveProperty("size");
  });
});
