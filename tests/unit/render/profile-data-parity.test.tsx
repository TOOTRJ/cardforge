import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { displayLine } from "@/lib/cards/card-display";
import type { FrameProfile } from "@/lib/cards/template-layout";
import { BRAND_FACE, TYPE_FACES, type SlotFace } from "@/lib/cards/type-faces";
import type { CardBackFace } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.8.0 — the SAME face from both renderers, for every text slot.
//
// Until 4.8.0 a slot's `font` was honoured unevenly: the bake's Band (names,
// type lines) and FlipsideBake (the modal strip's word) drew the display
// face whatever the slot said while the preview's BandSlot / FlipsideOverlay
// read the slot, and stats, badges, numerals and second faces were
// hard-coded in both. No shipped profile exercised it (every one says
// "display" there), so nothing was wrong on a card — and nothing would have
// said so when a profile first set `font: "body"` on a type line (the 1997
// frame's, TODO 4.10a): the preview would have changed and the stored PNG
// would not.
//
// This is that test. A THROWAWAY profile (never shipped: getFrameProfile is
// wrapped for the test only) sets a face on one slot at a time; the bake's
// laid-out nodes (Satori's onNodeDetected) and the preview's server markup
// must name the same family for the text, and the family must be the
// resolver's (lib/cards/type-faces.ts). The frame masters are stand-ins:
// only the text matters here.
//
// The same harness holds the two other things 4.8.0 made profile data: the
// footer's wording and alignment (TextSlot.prefix / align), and the symbol
// style (FrameProfile.symbolStyle) — each read by both renderers, each
// changing NOTHING until a profile says so.
// ---------------------------------------------------------------------------

type Patch = (profile: FrameProfile, template: string | undefined) => FrameProfile;
const fixture = vi.hoisted(() => ({ patch: null as null | ((profile: never, template: string | undefined) => unknown) }));
const stand = vi.hoisted(() => ({ grey: "" }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: Parameters<typeof real.getFrameProfile>[0]) => {
      const shipped = real.getFrameProfile(template);
      // The FIXTURE frame is a profile that names nothing: Alpha as it stood
      // before TODO 4.10c gave it the prints' faces, credit, © slot and
      // symbol style (its own tests: tests/unit/render/alpha-1993-bake). Each
      // test below then sets ONE field on it.
      const profile =
        template === "agclassic"
          ? ({
              ...shipped,
              symbolStyle: undefined,
              copyrightSlot: undefined,
              title: { ...shipped.title, fit: undefined, dy: undefined },
              type: { ...shipped.type, font: "display", fit: undefined, dy: undefined },
              footer: { ...shipped.footer!, font: "display", prefix: undefined, noArtist: undefined, uppercase: true },
              pt: { ...shipped.pt!, font: undefined, align: undefined, endKerned: undefined, weight: 700 },
            } as typeof shipped)
          : shipped;
      return fixture.patch ? (fixture.patch(profile as never, template) as FrameProfile) : profile;
    },
  };
});

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.grey,
    getFrameOverlayDataUrl: () => null,
    getFrameAssetDataUrl: () => stand.grey,
  };
});

beforeAll(async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
  stand.grey = `data:image/png;base64,${png.toString("base64")}`;
});

afterEach(() => {
  fixture.patch = null;
});

const withPatch = (patch: Patch | null) => {
  fixture.patch = patch as typeof fixture.patch;
};

// ---------------------------------------------------------------------------
// What each renderer says about a text.
// ---------------------------------------------------------------------------

type Seen = { family: string; weight: number | undefined; justify: string | undefined };

/** `"CardDisplay", "MPlantin", Georgia, serif` → CardDisplay. */
const firstFamily = (stack: string) => stack.split(",")[0].trim().replace(/^["']|["']$/g, "");

type BakeNode = {
  left: number;
  top: number;
  width: number;
  height: number;
  type: string;
  props: Record<string, unknown>;
  textContent?: string;
};
type BakeStyle = { fontFamily?: string; fontWeight?: number; justifyContent?: string } | undefined;

/** The brand mark's text shares its box with the rose (an inline svg), so
 *  Satori reports no text node for it: it is the node that sets a family
 *  right before that 32 × 32 svg. */
const MARK = "pipglyph.com";

/** The bake: the family and weight each `text` is laid out in — Satori
 *  reports its nodes in document order with their boxes, so a text's face
 *  is the nearest node before it (or itself) that sets a `fontFamily` and
 *  whose box holds the text's centre. */
async function bakeNodes(card: CardPreviewData, watermarkText: string | null = null): Promise<BakeNode[]> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const nodes: BakeNode[] = [];
  // A print layer hands Satori's layout to the caller (onNodeDetected); the
  // tree is the stored bake's.
  const response = await renderCardImage(card, "default", {
    brandMark: !watermarkText,
    watermarkText,
    printLayer: { omitArt: false, outputWidth: 750, onNodeDetected: (node) => nodes.push(node as BakeNode) },
  });
  // The render runs when the body is read.
  await response.arrayBuffer();
  expect(nodes.length).toBeGreaterThan(10);
  return nodes;
}

async function bakeSees(card: CardPreviewData, texts: readonly string[], watermarkText: string | null = null): Promise<Record<string, Seen | null>> {
  const nodes = await bakeNodes(card, watermarkText);
  const seen = (node: BakeNode | undefined): Seen | null => {
    const style = node?.props.style as BakeStyle;
    return style?.fontFamily ? { family: firstFamily(style.fontFamily), weight: style.fontWeight, justify: style.justifyContent } : null;
  };
  // (The centre: a stat value wider than its rect overflows it evenly.)
  const holdsBox = (outer: BakeNode, inner: BakeNode) => {
    const [x, y] = [inner.left + inner.width / 2, inner.top + inner.height / 2];
    return outer.left <= x && x <= outer.left + outer.width && outer.top <= y && y <= outer.top + outer.height;
  };
  const out: Record<string, Seen | null> = {};
  for (const text of texts) {
    if (text === MARK) {
      const at = nodes.findIndex((node, i) => seen(node) && nodes[i + 1]?.type === "svg" && nodes[i + 1].props.viewBox === "0 0 32 32");
      out[text] = seen(nodes[at]);
      continue;
    }
    const at = nodes.findIndex((node) => node.textContent === text);
    out[text] = null;
    for (let i = at; i >= 0; i -= 1) {
      if (seen(nodes[i]) && holdsBox(nodes[i], nodes[at])) {
        out[text] = seen(nodes[i]);
        break;
      }
    }
  }
  return out;
}

const VOID = new Set(["img", "br", "hr", "input", "meta", "link"]);
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The preview: the family and weight the nearest ancestor of each text node
 *  equal to `text` declares, read from the server markup. */
function previewSees(html: string, texts: readonly string[]): Record<string, Seen | null> {
  const out: Record<string, Seen | null> = Object.fromEntries(texts.map((text) => [text, null]));
  const stack: string[] = [];
  for (const m of html.matchAll(/<(\/)?([a-zA-Z0-9]+)((?:"[^"]*"|[^>"])*?)(\/)?>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      const text = decode(m[5]);
      if (!(text in out) || out[text]) continue;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const family = /(?:^|;)font-family:([^;]+)/.exec(stack[i])?.[1];
        if (!family) continue;
        // The weight is declared beside the family at every site.
        const weight = /(?:^|;)font-weight:(\d+)/.exec(stack[i])?.[1];
        const justify = /(?:^|;)justify-content:([^;]+)/.exec(stack[i])?.[1];
        out[text] = { family: firstFamily(family), weight: weight ? Number(weight) : undefined, justify };
        break;
      }
    } else if (m[1]) {
      stack.pop();
    } else if (!m[4] && !VOID.has(m[2].toLowerCase())) {
      stack.push(decode(/\sstyle="([^"]*)"/.exec(m[3])?.[1] ?? ""));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cards.
// ---------------------------------------------------------------------------

const BASE = {
  rarity: "rare",
  flavorText: null,
  loyalty: null,
  defense: null,
  artUrl: null,
  artPosition: {},
  setIconUrl: null,
  setIconCode: null,
  backFace: null,
  faceContent: null,
  watermark: null,
} as const;

const CREATURE = {
  ...BASE,
  title: "Probe Wurm",
  cost: "{3}{G}",
  cardType: "creature",
  supertype: null,
  subtypes: ["Wurm"],
  colorIdentity: ["green"],
  rulesText: "Trample",
  power: "6",
  toughness: "4",
  artistCredit: "Ada Lovelace",
  frameStyle: { template: "agclassic", finish: "regular" },
} as unknown as CardPreviewData;
const CREATURE_TEXT = {
  name: displayLine("Probe Wurm"),
  typeLine: displayLine("Creature — Wurm"),
  stat: "6/4",
  footer: displayLine("Art: Ada Lovelace"),
  mark: "pipglyph.com",
};

/** The preview of `card` as a display surface (the brand mark), or as a
 *  paid viewer's clean download with their custom footer text. */
const preview = (card: CardPreviewData, watermarkText: string | null = null) =>
  renderToStaticMarkup(
    <CardPreview
      {...(card as unknown as Parameters<typeof CardPreview>[0])}
      brandMark={!watermarkText}
      footerWatermark={watermarkText}
    />,
  );

async function both(card: CardPreviewData, texts: Record<string, string>, watermarkText: string | null = null) {
  const list = Object.values(texts);
  const bake = await bakeSees(card, list, watermarkText);
  const page = previewSees(preview(card, watermarkText), list);
  return Object.fromEntries(Object.entries(texts).map(([role, text]) => [role, { bake: bake[text], preview: page[text] }])) as Record<
    string,
    { bake: Seen | null; preview: Seen | null }
  >;
}

const face = (id: SlotFace) => TYPE_FACES[id].family;

describe("a slot's face is the same in the bake and the preview (TODO 4.8.0)", () => {
  it("every shipped role draws what it drew: the display face for names, type lines, stats, the footer and the mark", async () => {
    const seen = await both(CREATURE, CREATURE_TEXT);
    for (const [role, s] of Object.entries(seen)) {
      expect(s.bake, `bake ${role}`).not.toBeNull();
      expect(s.preview, `preview ${role}`).not.toBeNull();
      expect(s.bake!.family, `bake ${role}`).toBe("CardDisplay");
      expect(s.preview!.family, `preview ${role}`).toBe("CardDisplay");
    }
    expect([seen.name.bake!.weight, seen.name.preview!.weight]).toEqual([600, 600]);
    expect([seen.stat.bake!.weight, seen.stat.preview!.weight]).toEqual([700, 700]);
  }, 60_000);

  it("a type line a profile sets in the BODY face is MPlantin in BOTH renderers — and nothing else moves", async () => {
    withPatch((profile, template) => (template === "agclassic" ? { ...profile, type: { ...profile.type, font: "body" } } : profile));
    const seen = await both(CREATURE, CREATURE_TEXT);
    // The test that would have caught the old disagreement: the bake's Band
    // drew the display face here while the preview's BandSlot read the slot.
    expect(seen.typeLine.bake!.family).toBe(face("body"));
    expect(seen.typeLine.preview!.family).toBe(face("body"));
    expect(seen.typeLine.bake!.family).toBe(seen.typeLine.preview!.family);
    // …at the slot's own weight in both (one master either way: MPlantin's
    // @font-face covers 400–700, tests/unit/cards/type-faces.test.ts).
    expect(seen.typeLine.bake!.weight).toBe(seen.typeLine.preview!.weight);
    for (const role of ["name", "stat", "footer", "mark"]) {
      expect(seen[role].bake!.family, `bake ${role}`).toBe("CardDisplay");
      expect(seen[role].preview!.family, `preview ${role}`).toBe("CardDisplay");
    }
  }, 60_000);

  it("the name, the P/T and the footer follow their own slots the same way; the mark stays the brand's face", async () => {
    withPatch((profile, template) =>
      template === "agclassic"
        ? {
            ...profile,
            title: { ...profile.title, font: "body" },
            type: { ...profile.type, font: "body" },
            pt: { ...profile.pt!, font: "body" },
            footer: { ...profile.footer!, font: "body" },
          }
        : profile,
    );
    // (A body footer is not a displayLine: its spaces stay spaces.)
    const texts = { ...CREATURE_TEXT, footer: "Art: Ada Lovelace" };
    const seen = await both(CREATURE, texts);
    for (const role of ["name", "typeLine", "stat", "footer"]) {
      expect(seen[role].bake, `bake ${role}`).not.toBeNull();
      expect(seen[role].preview, `preview ${role}`).not.toBeNull();
      expect(seen[role].bake!.family, `bake ${role}`).toBe(face("body"));
      expect(seen[role].preview!.family, `preview ${role}`).toBe(face("body"));
    }
    expect(seen.stat.bake!.weight).toBe(seen.stat.preview!.weight);
    // Whatever the frame's faces, the mark is the brand's (era design D16).
    expect(seen.mark.bake!.family).toBe(BRAND_FACE.family);
    expect(seen.mark.preview!.family).toBe(BRAND_FACE.family);
  }, 60_000);

  it("a second face's name, type line and P/T (flip) follow their slots in both renderers", async () => {
    const back: CardBackFace = {
      title: "Flipped Probe",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Spirit"],
      rules_text: "Flying",
      power: "3",
      toughness: "5",
    } as CardBackFace;
    const card = { ...CREATURE, title: "Probe Monk", power: "1", toughness: "1", frameStyle: { template: "flip", finish: "regular" }, backFace: back } as unknown as CardPreviewData;
    const texts = { secondName: displayLine("Flipped Probe"), secondType: displayLine("Legendary Creature — Spirit"), secondStat: "3/5", name: displayLine("Probe Monk") };
    const plain = await both(card, texts);
    for (const role of Object.keys(texts)) {
      expect(plain[role].bake?.family, `bake ${role}`).toBe("CardDisplay");
      expect(plain[role].preview?.family, `preview ${role}`).toBe("CardDisplay");
    }
    withPatch((profile, template) =>
      template === "flip" && profile.secondFace
        ? {
            ...profile,
            secondFace: {
              ...profile.secondFace,
              title: { ...profile.secondFace.title, font: "body" },
              type: { ...profile.secondFace.type, font: "body" },
              pt: { ...profile.secondFace.pt!, font: "body" },
            },
          }
        : profile,
    );
    const seen = await both(card, texts);
    for (const role of ["secondName", "secondType", "secondStat"]) {
      expect(seen[role].bake?.family, `bake ${role}`).toBe(face("body"));
      expect(seen[role].preview?.family, `preview ${role}`).toBe(face("body"));
    }
    // The front's own name is its own slot's.
    expect([seen.name.bake!.family, seen.name.preview!.family]).toEqual(["CardDisplay", "CardDisplay"]);
  }, 120_000);

  it("a walker's loyalty and its cost badges, and a saga's numerals, follow the profile in both renderers", async () => {
    const walker = {
      ...BASE,
      title: "Probe, the Planar",
      cost: "{2}{B}{B}",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Probe"],
      colorIdentity: ["black"],
      rulesText: "+1: Draw a card.\n−3: Destroy target creature.",
      power: null,
      toughness: null,
      loyalty: "4",
      artistCredit: "Probe",
      frameStyle: { template: "m15pw", finish: "regular" },
    } as unknown as CardPreviewData;
    const walkerTexts = { loyalty: "4", badge: "+1" };
    const plain = await both(walker, walkerTexts);
    expect([plain.loyalty.bake?.family, plain.loyalty.preview?.family]).toEqual(["CardDisplay", "CardDisplay"]);
    expect([plain.badge.bake?.family, plain.badge.preview?.family]).toEqual(["CardDisplay", "CardDisplay"]);
    withPatch((profile, template) =>
      template === "m15pw" && profile.loyalty && profile.loyaltyRows
        ? { ...profile, loyalty: { ...profile.loyalty, font: "body" }, loyaltyRows: { ...profile.loyaltyRows, badgeFont: "body" } }
        : profile,
    );
    const seen = await both(walker, walkerTexts);
    expect([seen.loyalty.bake?.family, seen.loyalty.preview?.family]).toEqual([face("body"), face("body")]);
    expect([seen.badge.bake?.family, seen.badge.preview?.family]).toEqual([face("body"), face("body")]);

    // A saga's numerals are the BODY face as shipped (the prints' MPlantin)…
    withPatch(null);
    const saga = {
      ...BASE,
      title: "The First Probe",
      cost: "{2}",
      cardType: "enchantment",
      supertype: null,
      subtypes: ["Saga"],
      colorIdentity: ["red"],
      rulesText: "I — Draw a card.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain.",
      power: null,
      toughness: null,
      artistCredit: "Probe",
      frameStyle: { template: "saga", finish: "regular" },
    } as unknown as CardPreviewData;
    const shipped = await both(saga, { numeral: "II" });
    expect([shipped.numeral.bake?.family, shipped.numeral.preview?.family]).toEqual([face("body"), face("body")]);
    // …and the display face in both where a profile says so.
    withPatch((profile, template) =>
      template === "saga" && profile.chapters
        ? { ...profile, chapters: { ...profile.chapters, badge: { ...profile.chapters.badge, numeralFont: "display" } } }
        : profile,
    );
    const set = await both(saga, { numeral: "II" });
    expect([set.numeral.bake?.family, set.numeral.preview?.family]).toEqual([face("display"), face("display")]);
  }, 180_000);

  it("the modal strip's word follows its slot in both renderers (the bake's FlipsideBake used to ignore it)", async () => {
    const back = {
      title: "Soporific Springs",
      cost: "",
      card_type: "land",
      supertype: null,
      subtypes: [],
      rules_text: "{T}: Add {U}.",
      power: null,
      toughness: null,
      frame_style: { template: "m15mdfclandback" },
      color_identity: ["blue"],
    };
    const { frontPreviewData } = await import("@/lib/cards/faces");
    const stored = {
      ...BASE,
      title: "Sink into Stupor",
      cost: "{2}{U}",
      cardType: "instant",
      supertype: null,
      subtypes: [],
      colorIdentity: ["blue"],
      rulesText: "Return target spell to its owner's hand.",
      power: null,
      toughness: null,
      artistCredit: "Probe",
      frameStyle: { template: "m15mdfcfront", finish: "regular" },
      backFace: back,
    } as unknown as CardPreviewData;
    const sees = async () => ({
      // The stored bake's front (the bake paths' frontPreviewData), and the
      // preview of the same card.
      bake: (await bakeSees(frontPreviewData(stored), ["Land"])).Land,
      preview: previewSees(preview(stored), ["Land"]).Land,
    });
    const plain = await sees();
    expect([plain.bake?.family, plain.preview?.family]).toEqual(["CardDisplay", "CardDisplay"]);
    withPatch((profile, template) =>
      template === "m15mdfcfront" && profile.flipside
        ? { ...profile, flipside: { ...profile.flipside, word: { ...profile.flipside.word, font: "body" } } }
        : profile,
    );
    const seen = await sees();
    expect([seen.bake?.family, seen.preview?.family]).toEqual([face("body"), face("body")]);
    expect(seen.bake?.weight).toBe(seen.preview?.weight);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The footer's wording and alignment (TextSlot.prefix / align).
// ---------------------------------------------------------------------------

describe("the footer line is profile data (TODO 4.8.0)", () => {
  const MARK_TEXT = "Probe Press";
  const footerOf = (patch: Partial<NonNullable<FrameProfile["footer"]>>): Patch => (profile, template) =>
    template === "agclassic" && profile.footer ? { ...profile, footer: { ...profile.footer, ...patch } } : profile;

  it("as shipped: \"Art: \" + the credit at the rect's start, a clean download's custom mark at its end — in both renderers", async () => {
    const texts = { artist: displayLine("Art: Ada Lovelace"), custom: displayLine(MARK_TEXT) };
    const seen = await both(CREATURE, texts, MARK_TEXT);
    for (const role of ["artist", "custom"]) {
      expect(seen[role].bake, `bake ${role}`).not.toBeNull();
      expect(seen[role].preview, `preview ${role}`).not.toBeNull();
      expect([seen[role].bake!.justify, seen[role].preview!.justify]).toEqual(["space-between", "space-between"]);
    }
    // A card with no credit says so, behind the same prefix.
    const anonymous = await both({ ...CREATURE, artistCredit: null } as CardPreviewData, { artist: displayLine("Art: Unknown") });
    expect(anonymous.artist.bake).not.toBeNull();
    expect(anonymous.artist.preview).not.toBeNull();
  }, 60_000);

  it("a profile's prefix replaces it in both renderers (the 1993–2003 prints' \"Illus. \")", async () => {
    withPatch(footerOf({ prefix: "Illus. " }));
    const texts = { illus: displayLine("Illus. Ada Lovelace"), art: displayLine("Art: Ada Lovelace") };
    const seen = await both(CREATURE, texts);
    expect(seen.illus.bake).not.toBeNull();
    expect(seen.illus.preview).not.toBeNull();
    expect(seen.art.bake).toBeNull();
    expect(seen.art.preview).toBeNull();
    const anonymous = await both({ ...CREATURE, artistCredit: "  " } as CardPreviewData, { illus: displayLine("Illus. Unknown") });
    expect([anonymous.illus.bake === null, anonymous.illus.preview === null]).toEqual([false, false]);
  }, 60_000);

  it("`noArtist: \"omit\"` — a card with no artist prints NO credit line in either renderer; one with an artist prints it as before (TODO 4.10c)", async () => {
    withPatch(footerOf({ prefix: "Illus. ", noArtist: "omit" }));
    for (const none of [null, "", "  "]) {
      const anonymous = await both({ ...CREATURE, artistCredit: none } as CardPreviewData, {
        unknown: displayLine("Illus. Unknown"),
        bare: displayLine("Illus."),
        art: displayLine("Art: Unknown"),
      });
      for (const role of ["unknown", "bare", "art"]) {
        expect([role, anonymous[role].bake, anonymous[role].preview]).toEqual([role, null, null]);
      }
    }
    const credited = await both(CREATURE, { illus: displayLine("Illus. Ada Lovelace") });
    expect(credited.illus.bake).not.toBeNull();
    expect(credited.illus.preview).not.toBeNull();
  }, 60_000);

  it("a centred footer centres its line in both renderers and draws no custom mark on it", async () => {
    withPatch(footerOf({ align: "center" }));
    const texts = { artist: displayLine("Art: Ada Lovelace"), custom: displayLine(MARK_TEXT) };
    const seen = await both(CREATURE, texts, MARK_TEXT);
    expect([seen.artist.bake!.justify, seen.artist.preview!.justify]).toEqual(["center", "center"]);
    expect(seen.custom.bake).toBeNull();
    expect(seen.custom.preview).toBeNull();
    // Set in the BODY face (as the 1997 prints set it), it is MPlantin in both.
    withPatch(footerOf({ align: "center", font: "body" }));
    const body = await both(CREATURE, { artist: "Art: Ada Lovelace" });
    expect([body.artist.bake!.family, body.artist.preview!.family]).toEqual([face("body"), face("body")]);
    expect([body.artist.bake!.justify, body.artist.preview!.justify]).toEqual(["center", "center"]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The symbol style (FrameProfile.symbolStyle).
// ---------------------------------------------------------------------------

describe("the symbol style is profile data (TODO 4.8.0)", () => {
  // The cost is {X}{G}, never a numeral: this file is inside Tailwind's source
  // scan, and a numeric mana class written out here (the generic-mana pip's)
  // is also Tailwind's margin-inline-start utility — the build would emit it
  // and every such pip on the site would gain a margin
  // (tests/unit/content/mana-class-collision.test.ts).
  const PIPS = { ...CREATURE, cost: "{X}{G}", rulesText: "{T}: Add {G}." } as CardPreviewData;
  /** Each disc the bake draws: its hard shadow (or none). */
  const bakeDiscs = async (card: CardPreviewData) =>
    (await bakeNodes(card))
      .map((node) => node.props.style as { borderRadius?: number; width?: number; boxShadow?: string; background?: string } | undefined)
      .filter((style) => style?.borderRadius !== undefined && style.borderRadius === style.width && style.background)
      .map((style) => style!.boxShadow ?? null);
  /** Each pip of the card's preview (CardPip marks its own with `data-pip`):
   *  the mana-font suffix it draws, and whether its disc has a shadow. */
  const previewPips = (html: string) =>
    [...html.matchAll(/data-pip="([^"]*)"[^>]*style="([^"]*)"/g)].map((m) => `${m[1]} ${/box-shadow:/.test(m[2]) ? "shadow" : "flat"}`);

  it("\"modern\" — every profile's style — is today's discs: the hard offset shadow under the COST, flat pips in the rules text (layout v49) and the modern tap, in both renderers", async () => {
    // (The SHIPPED profiles: this file's getFrameProfile hands the fixture
    // frame out plain.)
    const { getFrameProfile } = await vi.importActual<typeof import("@/lib/cards/template-layout")>("@/lib/cards/template-layout");
    const { symbolStyleOf } = await import("@/lib/cards/symbol-style");
    const { FRAME_TEMPLATE_VALUES } = await import("@/types/card");
    // …but the 1997 pair, which names its own since TODO 4.10a (flat discs,
    // the 1997 tap: tests/unit/render/retro-1997-bake.test.tsx).
    // …and the 2003 pair since TODO 4.10b (a cost shadow down and a little left,
    // flat inline pips: tests/unit/render/modern-2003-bake.test.tsx).
    const RETRO_1997 = ["retro", "retroland"];
    const MODERN_2003 = ["modern", "modernland"];
    // …and the 1993 pair since TODO 4.10c (flat discs, the 1993 drawings,
    // the tilted-T tap: tests/unit/render/alpha-1993-bake.test.tsx).
    const ALPHA_1993 = ["agclassic", "alphaland"];
    for (const template of FRAME_TEMPLATE_VALUES) {
      const own = RETRO_1997.includes(template) ? "1997" : MODERN_2003.includes(template) ? "2003" : ALPHA_1993.includes(template) ? "original" : undefined;
      expect(getFrameProfile(template).symbolStyle, template).toBe(own);
      expect(symbolStyleOf(getFrameProfile(template)).id, template).toBe(own ?? "modern");
    }
    // {X}{G} in the cost, {T} and {G} in the rules: four discs — the cost's
    // two with the bake's one-layer hard shadow at their own size, the
    // rules text's two flat (the M15-era prints shadow the cost alone).
    const discs = await bakeDiscs(PIPS);
    expect(discs).toHaveLength(4);
    for (const shadow of discs.slice(0, 2)) expect(shadow).toMatch(/^-\d+px \d+px 0 #111$/);
    expect(discs.slice(2)).toEqual([null, null]);
    expect(previewPips(preview(PIPS))).toEqual(["x shadow", "g shadow", "tap flat", "g flat"]);
  }, 60_000);

  it("a style with no shadow and another tap reaches every pip of the card in both renderers, and both shadow models", async () => {
    const styles = await import("@/lib/cards/symbol-style");
    const { metricsFor } = await import("@/lib/cards/rules-layout");
    const { costRowWidthPct } = await import("@/lib/cards/render-tiers");
    const { getManaCodepoint } = await import("@/lib/render/card-fonts");
    // A THROWAWAY style on a frame that draws "modern": what 4.10a's "1997"
    // is on the 1997 pair — no disc shadow, the Fourth Edition tap.
    const table = styles.SYMBOL_STYLES as unknown as Record<string, unknown>;
    table.test = { id: "test", discShadow: null, inlineShadow: false, previewShadowClass: null, previewShadowCss: null, costRowShadowDiscs: 0, costGapDiscs: 0.12, symbolImages: null, tapSuffix: "tap-4ed" };
    try {
      withPatch((profile, template) => (template === "agclassic" ? ({ ...profile, symbolStyle: "test" } as unknown as FrameProfile) : profile));
      const discs = await bakeDiscs(PIPS);
      expect(discs).toEqual([null, null, null, null]);
      // The bake draws the style's tap glyph…
      const texts = (await bakeNodes(PIPS)).map((node) => node.textContent);
      expect(texts).toContain(getManaCodepoint("tap-4ed"));
      expect(texts).not.toContain(getManaCodepoint("tap"));
      // …and the preview the same classes, on the card's own pips.
      expect(previewPips(preview(PIPS))).toEqual(["x flat", "g flat", "tap-4ed flat", "g flat"]);
      // The rules layout's inline pip keeps no shadow clear; the cost row is
      // shorter by the shadow's reach.
      const style = "test" as unknown as import("@/lib/cards/symbol-style").SymbolStyle;
      expect(metricsFor(64, undefined, "hd", style)).toMatchObject({ pipShadowPx: 0, pipShadowLeftPx: 0 });
      // "modern" keeps none clear either since layout v49 (it kept 4 px
      // down and 3 left); its COST row still measures its shadow, below.
      expect(metricsFor(64, undefined, "hd")).toMatchObject({ pipShadowPx: 0, pipShadowLeftPx: 0 });
      expect(costRowWidthPct("{3}{G}", 0.04) - costRowWidthPct("{3}{G}", 0.04, styles.symbolStyle(style))).toBeCloseTo(0.1 * 0.04, 12);
      // Another frame's card is untouched.
      const other = { ...PIPS, frameStyle: { template: "tarkirdragon", finish: "regular" } } as unknown as CardPreviewData;
      expect(previewPips(preview(other))).toEqual(["x shadow", "g shadow", "tap flat", "g flat"]);
    } finally {
      delete table.test;
    }
  }, 120_000);
});
