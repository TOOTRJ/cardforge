import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { bakedShadowHex, discShadowPx, SYMBOL_STYLES, type SymbolStyle, type SymbolStyleSpec } from "@/lib/cards/symbol-style";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Every mana symbol of a card, from BOTH renderers (preview-symbol parity,
// 2026-10-07).
//
// The stored PNG is drawn by the bake's ManaGem; the live preview by CardPip.
// Until this test the preview took mana-font's own `.ms-cost` look for
// anything but the disc's size and shadow, and that look is not the bake's:
// a black untap disc with a white arrow (the bake: a grey disc, dark arrow),
// a Phyrexian symbol ×1.2, a white snow symbol under a second glyph, a
// hybrid's halves at mana-font's offsets in lighter colours — and NO glyph
// at all for the ten hybrids mana-font has no class for ({U/W}, {G/R}…),
// #111 ink for the bake's #150d08, and an empty disc where the bake draws
// nothing ({C/P}, {W/U/P}, {21}…).
//
// So: one card per symbol class and symbol style, baked at HD (the bake's
// laid-out nodes, Satori's onNodeDetected) and rendered by the preview; each
// pip's disc colour, ink, glyph, glyph size, split fill, half positions and
// shadow must be the same numbers. Both read lib/cards/mana-gem.ts — this
// test is what says they still do. The frame masters are stand-ins: only
// the pips matter here.
//
// Symbols are written as card text ({7}), never as a mana-font class: a
// written-out numeric class would become a Tailwind margin utility
// (tests/unit/content/mana-class-collision.test.ts).
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "" }));

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

const WUBRG = ["W", "U", "B", "R", "G"];
const braces = (symbols: readonly string[]) => symbols.map((s) => `{${s}}`);

/** The symbol classes a card can write, as card text. */
const CLASSES: Record<string, string[]> = {
  "colours and colourless": braces([...WUBRG, "C"]),
  "generic 0–20": braces(Array.from({ length: 21 }, (_, n) => String(n))),
  "variables X Y Z": braces(["X", "Y", "Z"]),
  "snow, tap, untap, energy": braces(["S", "T", "Q", "E"]),
  "hybrid, both orders": braces(WUBRG.flatMap((a) => WUBRG.filter((b) => b !== a).map((b) => `${a}/${b}`))),
  twobrid: braces(WUBRG.map((c) => `2/${c}`)),
  Phyrexian: braces(WUBRG.map((c) => `${c}/P`)),
};
/** Card text mana-font has no glyph for: neither renderer draws a disc. */
const NO_GLYPH = braces(["C/P", "W/U/P", "C/W", "3/W", "W/W", "21", "1/2", "CHAOS"]);

type Disc = {
  size: number;
  /** A solid disc's colour, or a split disc's fill. */
  background: string;
  /** [left, down, colour] of the shadow, px; null with none. */
  shadow: [number, number, string] | null;
  glyphs: Array<{ glyph: string; fontPx: number; color: string; top?: number; left?: number }>;
};

type BakeNode = { type: string; props: Record<string, unknown>; textContent?: string };

/** Each disc the HD bake lays out, in document order, with its glyphs. */
async function bakeDiscs(card: CardPreviewData): Promise<Disc[]> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const nodes: BakeNode[] = [];
  const response = await renderCardImage(card, "hd", {
    brandMark: true,
    printLayer: { omitArt: false, outputWidth: RULES_HD_WIDTH.portrait, onNodeDetected: (node) => nodes.push(node as BakeNode) },
  });
  await response.arrayBuffer();
  const discs: Disc[] = [];
  for (const node of nodes) {
    const style = (node.props.style ?? {}) as Record<string, unknown>;
    if (typeof style.width === "number" && style.borderRadius === style.width && typeof style.background === "string") {
      const shadow = typeof style.boxShadow === "string" ? /^(-?\d+)px (\d+)px 0 (#[0-9a-f]+)$/i.exec(style.boxShadow) : null;
      if (style.boxShadow !== undefined) expect(shadow, String(style.boxShadow)).not.toBeNull();
      discs.push({
        size: style.width,
        background: style.background,
        shadow: shadow ? [Number(shadow[1]), Number(shadow[2]), shadow[3]] : null,
        glyphs: [],
      });
    } else if (style.fontFamily === '"Mana"' && discs.length > 0 && typeof node.textContent === "string") {
      discs[discs.length - 1].glyphs.push({
        glyph: node.textContent,
        fontPx: style.fontSize as number,
        color: style.color as string,
        ...(style.position === "absolute" ? { top: style.top as number, left: style.left as number } : {}),
      });
    }
  }
  return discs;
}

const css = (el: Element, prop: string) => new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(el.getAttribute("style") ?? "")?.[1].trim() ?? "";
const unit = (value: string, u: string) => {
  expect(value.endsWith(u), `"${value}" in ${u}`).toBe(true);
  return Number.parseFloat(value);
};

/** Each pip the preview draws, in document order, in the HD bake's px. */
async function previewDiscs(card: CardPreviewData): Promise<Disc[]> {
  const { getManaCodepoint } = await import("@/lib/render/card-fonts");
  const html = renderToStaticMarkup(<CardPreview {...(card as unknown as Parameters<typeof CardPreview>[0])} />);
  const window = new Window();
  window.document.body.innerHTML = html;
  const glyphOf = (el: Element) => {
    const classes = el.className.split(" ");
    expect(classes[0], el.className).toBe("ms");
    expect(classes).toHaveLength(2);
    // The class is mana-font's for this glyph — and never a cost class.
    const glyph = getManaCodepoint(classes[1].replace(/^ms-/, ""));
    expect(glyph, el.className).not.toBeNull();
    return glyph!;
  };
  const pips = Array.from(window.document.body.querySelectorAll("[data-pip]")) as unknown as Element[];
  return pips.map((pip) => {
    // 1 em of the pip's parent is the disc, in cqw of the card.
    const discPx = (unit(css(pip.parentElement!, "font-size"), "cqw") * RULES_HD_WIDTH.portrait) / 100;
    const shadowOf = (emPx: number): Disc["shadow"] => {
      const value = css(pip, "box-shadow");
      if (!value) return null;
      const [x, y, blur, color] = value.split(/\s+/);
      expect(blur).toBe("0");
      return [unit(x, "em") * emPx, unit(y, "em") * emPx, color];
    };
    if (pip.tagName === "SPAN") {
      // A split disc: in the row's own em.
      expect(css(pip, "width")).toBe("1em");
      expect(css(pip, "height")).toBe("1em");
      expect(css(pip, "overflow")).toBe("hidden");
      return {
        size: discPx,
        background: css(pip, "background"),
        shadow: shadowOf(discPx),
        glyphs: (Array.from(pip.children) as Element[]).map((half) => {
          const fontPx = unit(css(half, "font-size"), "em") * discPx;
          expect(css(half, "position")).toBe("absolute");
          expect(css(half, "line-height")).toBe("1");
          return {
            glyph: glyphOf(half),
            fontPx,
            color: css(half, "color"),
            top: unit(css(half, "top"), "em") * fontPx,
            left: unit(css(half, "left"), "em") * fontPx,
          };
        }),
      };
    }
    const fontPx = unit(css(pip, "font-size"), "em") * discPx;
    expect(unit(css(pip, "width"), "em") * fontPx).toBeCloseTo(discPx, 1);
    expect(unit(css(pip, "height"), "em") * fontPx).toBeCloseTo(discPx, 1);
    expect(css(pip, "border-radius")).toBe("50%");
    expect(css(pip, "text-align")).toBe("center");
    return {
      size: discPx,
      background: css(pip, "background-color"),
      shadow: shadowOf(fontPx),
      glyphs: [{ glyph: glyphOf(pip), fontPx, color: css(pip, "color") }],
    };
  });
}

function expectSameDisc(preview: Disc, bake: Disc, label: string) {
  expect(preview.size, `${label}: disc`).toBeCloseTo(bake.size, 1);
  expect(preview.background.toLowerCase(), `${label}: fill`).toBe(bake.background.toLowerCase());
  if (bake.shadow) {
    expect(preview.shadow, `${label}: shadow`).not.toBeNull();
    expect(preview.shadow![0], `${label}: shadow left`).toBeCloseTo(bake.shadow[0], 1);
    expect(preview.shadow![1], `${label}: shadow down`).toBeCloseTo(bake.shadow[1], 1);
    // The colour the bake's filter leaves in the PNG.
    expect(preview.shadow![2], `${label}: shadow colour`).toBe(bakedShadowHex(bake.shadow[2]));
  } else {
    expect(preview.shadow, `${label}: no shadow`).toBeNull();
  }
  expect(preview.glyphs.length, `${label}: glyphs`).toBe(bake.glyphs.length);
  bake.glyphs.forEach((want, i) => {
    const got = preview.glyphs[i];
    expect(got.glyph, `${label}: glyph ${i}`).toBe(want.glyph);
    expect(got.fontPx, `${label}: glyph ${i} size`).toBeCloseTo(want.fontPx, 1);
    expect(got.color.toLowerCase(), `${label}: ink`).toBe(want.color.toLowerCase());
    if (want.top !== undefined) {
      expect(got.top, `${label}: half ${i} top`).toBeCloseTo(want.top, 1);
      expect(got.left, `${label}: half ${i} left`).toBeCloseTo(want.left!, 1);
    } else {
      expect(got.top, `${label}: centred`).toBeUndefined();
    }
  });
}

/** A portrait frame that draws `style` (M15 for the default style). */
async function templateOf(style: SymbolStyle): Promise<FrameTemplate | null> {
  const { getFrameProfile } = await import("@/lib/cards/template-layout");
  const { DEFAULT_SYMBOL_STYLE } = await import("@/lib/cards/symbol-style");
  if (style === DEFAULT_SYMBOL_STYLE) return "m15";
  return FRAME_TEMPLATE_VALUES.find((t) => getFrameProfile(t).symbolStyle === style && getFrameProfile(t).orientation !== "landscape") ?? null;
}

const card = (template: FrameTemplate, cost: string | null, rulesText: string): CardPreviewData =>
  ({
    title: "Probe",
    cost,
    cardType: "creature",
    supertype: null,
    subtypes: ["Elf"],
    colorIdentity: ["green"],
    rulesText,
    flavorText: null,
    power: "2",
    toughness: "2",
    rarity: "common",
    frameStyle: { template, finish: "regular" },
  }) as unknown as CardPreviewData;

describe.each(Object.keys(SYMBOL_STYLES) as SymbolStyle[])('symbol style "%s": the preview draws each symbol as the bake does', (style) => {
  it.each(Object.entries(CLASSES))("%s — in the rules text", async (_name, symbols) => {
    const template = await templateOf(style);
    if (!template) return;
    const data = card(template, null, `${symbols.join(", ")}: Draw a card.`);
    const [bake, preview] = [await bakeDiscs(data), await previewDiscs(data)];
    expect(bake).toHaveLength(symbols.length);
    expect(preview).toHaveLength(symbols.length);
    symbols.forEach((symbol, i) => expectSameDisc(preview[i], bake[i], `${style} rules ${symbol}`));
  }, 60_000);

  it("one of each class — in the cost row", async () => {
    const template = await templateOf(style);
    if (!template) return;
    const symbols = braces(["X", "S", "T", "Q", "U/W", "2/G", "G/P"]);
    const data = card(template, symbols.join(""), "Trample");
    const [bake, preview] = [await bakeDiscs(data), await previewDiscs(data)];
    expect(bake).toHaveLength(symbols.length);
    expect(preview).toHaveLength(symbols.length);
    symbols.forEach((symbol, i) => expectSameDisc(preview[i], bake[i], `${style} cost ${symbol}`));
  }, 60_000);

  it("a symbol the font has no glyph for: no disc, in either renderer, in the cost or the rules", async () => {
    const template = await templateOf(style);
    if (!template) return;
    const data = card(template, `{G}${NO_GLYPH.join("")}{R}`, `{T}, ${NO_GLYPH.join(", ")}, {G}: Draw a card.`);
    const [bake, preview] = [await bakeDiscs(data), await previewDiscs(data)];
    // {G}{R} in the cost, {T} and {G} in the rules.
    expect(bake).toHaveLength(4);
    expect(preview).toHaveLength(4);
    preview.forEach((disc, i) => expectSameDisc(disc, bake[i], `${style} beside a glyphless symbol, pip ${i}`));
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Style "2003" by its own numbers (TODO 4.10b: `modern`, `modernland`). The
// loop above holds the preview to the bake for every style; this says what
// both must BE on the 2003 pair, so neither can drift with the other: a
// 66 px cost disc with ONE shadow layer 6 px down and 2 px to the LEFT in
// pure black — the left component too, in both renderers and in the PNG —
// and FLAT pips in the rules text (inlineSymbolStyle).
// ---------------------------------------------------------------------------

describe('symbol style "2003": the cost row\'s shadow (down and a little left) and flat inline pips, in both renderers', () => {
  const COST = braces(["X", "2", "G", "U/W", "G/P"]);
  const RULES = braces(["T", "1", "G", "Q", "R/G", "2/W", "B/P"]);

  // A land frame draws no cost row: its pips are the rules text's alone.
  it.each([
    ["modern", COST],
    ["modernland", []],
  ] as const)("%s names the style; its discs are the same in the bake and the preview", async (template, cost: readonly string[]) => {
    const { getFrameProfile } = await import("@/lib/cards/template-layout");
    const { symbolStyleOf, inlineSymbolStyle, discShadowCss } = await import("@/lib/cards/symbol-style");
    const spec = symbolStyleOf(getFrameProfile(template));
    expect(spec.id).toBe("2003");
    expect(discShadowCss(spec, 66)).toBe("-2px 6px 0 #000");
    expect(inlineSymbolStyle(spec).discShadow).toBeNull();

    const data = card(template, cost.join(""), `${RULES.join(", ")}: Draw a card.`);
    const [bake, preview] = [await bakeDiscs(data), await previewDiscs(data)];
    expect(bake).toHaveLength(cost.length + RULES.length);
    expect(preview).toHaveLength(cost.length + RULES.length);
    bake.forEach((disc, i) => expectSameDisc(preview[i], disc, `2003 ${template} pip ${i}`));

    // The cost row: every disc 66 px, the shadow's LEFT and DOWN components
    // and its colour, as the bake writes them and as the preview lands them.
    for (let i = 0; i < cost.length; i += 1) {
      expect(bake[i].size, `cost ${cost[i]}`).toBe(66);
      expect(bake[i].shadow, `bake cost ${cost[i]}`).toEqual([-2, 6, "#000"]);
      expect(preview[i].shadow![0], `preview cost ${cost[i]}: left`).toBeCloseTo(-2, 1);
      expect(preview[i].shadow![1], `preview cost ${cost[i]}: down`).toBeCloseTo(6, 1);
      expect(preview[i].shadow![2], `preview cost ${cost[i]}: colour`).toBe("#000000");
    }
    // The rules text: flat, whatever the symbol's class.
    for (let i = cost.length; i < bake.length; i += 1) {
      expect(bake[i].shadow, `bake rules ${RULES[i - cost.length]}`).toBeNull();
      expect(preview[i].shadow, `preview rules ${RULES[i - cost.length]}`).toBeNull();
    }
  }, 60_000);

  it("the PNG holds the left component: black beside the disc's left edge, none beside its right", async () => {
    const { renderCardImage } = await import("@/lib/render/card-image");
    const { MANA_GEM_BG } = await import("@/lib/cards/mana-gem");
    const response = await renderCardImage(card("modern", "{G}", "Trample"), "hd", { brandMark: true });
    const { data: px, info } = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgb = (x: number, y: number) => [0, 1, 2].map((c) => px[(y * info.width + x) * 3 + c]);
    const hex = (x: number, y: number) => `#${rgb(x, y).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const box = { minX: Infinity, maxX: -1, minY: Infinity, maxY: -1 };
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (hex(x, y) !== MANA_GEM_BG.g) continue;
        box.minX = Math.min(box.minX, x);
        box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y);
        box.maxY = Math.max(box.maxY, y);
      }
    }
    expect(box.maxX - box.minX + 1, "the {G} disc").toBeGreaterThanOrEqual(64);
    expect(box.maxX - box.minX + 1, "the {G} disc").toBeLessThanOrEqual(66);
    // Half the shadow's drop under the disc's middle row, the shadow's own
    // widest rows: it reaches 2 px past the disc on the left only.
    const y = Math.round((box.minY + box.maxY) / 2) + 3;
    const edgeLeft = Math.round((box.minX + box.maxX) / 2 - 33);
    const edgeRight = Math.round((box.minX + box.maxX) / 2 + 33);
    const darkest = (xs: number[]) => Math.min(...xs.map((x) => Math.max(...rgb(x, y))));
    expect(darkest([edgeLeft - 2, edgeLeft - 1, edgeLeft]), "black left of the disc").toBeLessThan(0x20);
    for (const x of [edgeRight + 1, edgeRight + 2, edgeRight + 3]) expect(Math.max(...rgb(x, y)), `no shadow right of the disc, x ${x}`).toBeGreaterThan(0x60);
    // …and under it, in the colour the preview asks for.
    expect(hex(Math.round((box.minX + box.maxX) / 2) - 2, box.maxY + 5)).toBe("#000000");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// bakedShadowHex against the PNG itself. The comparisons above hold the
// preview's shadow colour to bakedShadowHex(the bake's CSS colour) — which
// says nothing if the model is wrong. So: a real HD bake, the shadow's own
// pixel read out of the PNG (the disc's bottom, moved by the shadow's
// offset: inside the shadow, outside the disc), for every style that draws
// a shadow and for colours no style uses yet (a new style's colour is
// modelled before it ships). A rasteriser that stops rounding through 8-bit
// linearRGB fails here, not in a stored card.
// ---------------------------------------------------------------------------

/** The colour of the cost pip's shadow in a real HD bake of `data` (a {G}
 *  cost): the green disc found by its own colour, then the pixel under its
 *  bottom centre moved by the shadow's offset — inside the shadow, outside
 *  the disc. (Satori's node boxes are before the cost row's transform, so
 *  the disc is found in the pixels.) */
async function shadowPixel(data: CardPreviewData, spec: SymbolStyleSpec): Promise<string> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const { MANA_GEM_BG } = await import("@/lib/cards/mana-gem");
  const response = await renderCardImage(data, "hd", { brandMark: true });
  const { data: px, info } = await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => `#${[0, 1, 2].map((c) => px[(y * info.width + x) * 3 + c].toString(16).padStart(2, "0")).join("")}`;
  const box = { minX: Infinity, maxX: -1, maxY: -1 };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (at(x, y) !== MANA_GEM_BG.g) continue;
      box.minX = Math.min(box.minX, x);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  expect(box.maxY, "the {G} disc in the bake").toBeGreaterThan(0);
  const { left, down } = discShadowPx(spec, box.maxX - box.minX + 1);
  expect(down).toBeGreaterThanOrEqual(3);
  return at(Math.round((box.minX + box.maxX) / 2) - left, box.maxY + down - 1);
}

describe("the shadow colour the preview asks for is the one in the PNG", () => {
  const shadowed = (Object.keys(SYMBOL_STYLES) as SymbolStyle[]).filter((style) => SYMBOL_STYLES[style].discShadow);

  it.each(shadowed)('style "%s": bakedShadowHex is the baked pixel', async (style) => {
    const template = await templateOf(style);
    if (!template) return;
    const spec = SYMBOL_STYLES[style];
    expect(await shadowPixel(card(template, "{G}", "Trample"), spec)).toBe(bakedShadowHex(spec.discShadow!.colorHex));
  }, 60_000);

  it("…and for colours no style uses yet (the model is not fitted to one colour)", async () => {
    const spec = SYMBOL_STYLES.modern as { discShadow: { left: number; down: number; colorHex: string } };
    const own = spec.discShadow.colorHex;
    try {
      for (const [colorHex, landed] of [
        ["#333", "#323232"],
        ["#7f1d1d", "#7f1c1c"],
        ["#191970", "#161670"],
        ["#2a4b6c", "#2a4b6c"],
        ["#fff", "#ffffff"],
      ]) {
        spec.discShadow.colorHex = colorHex;
        expect(bakedShadowHex(colorHex), colorHex).toBe(landed);
        expect(await shadowPixel(card("m15", "{G}", "Trample"), SYMBOL_STYLES.modern), colorHex).toBe(landed);
      }
    } finally {
      spec.discShadow.colorHex = own;
    }
  }, 120_000);
});
