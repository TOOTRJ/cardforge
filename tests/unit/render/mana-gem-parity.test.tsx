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
// nothing ({C/P}, {21}…).
//
// Layout v49 (the symbols as printed) put the prints' own drawings in that
// one description — a near-black untap disc, a Phyrexian symbol on a larger
// disc, the two-colour Phyrexian disc, the snow flake as an SVG, the energy
// symbol with no disc, flat pips in the rules text — and the last describe
// below reads each of them out of a real PNG.
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
  "two-colour Phyrexian, both orders": braces(WUBRG.flatMap((a) => WUBRG.filter((b) => b !== a).map((b) => `${a}/${b}/P`))),
};
/** Card text mana-font has no glyph for: neither renderer draws a disc. */
const NO_GLYPH = braces(["C/P", "W/W/P", "C/W", "3/W", "W/W", "21", "1/2", "CHAOS"]);

type FlakePath = { d: string; fill: string; stroke: string; strokeWidth: number; join: string; mitre: number };
type Disc = {
  size: number;
  /** A solid disc's colour, or a split disc's fill; null = no disc at all
   *  (the energy symbol). */
  background: string | null;
  /** The disc's top in its line box, px (a pip in the rules text). */
  lineTop?: number;
  /** The snow flake's inline SVG: its square, viewBox and two paths. */
  flake?: { size: number; viewBox: string; paths: FlakePath[] };
  /** [left, down, colour] of the shadow, px; null with none. */
  shadow: [number, number, string] | null;
  glyphs: Array<{ glyph: string; fontPx: number; color: string; top?: number; left?: number }>;
  /** A style's own symbol IMAGE — the whole pip, no fill and no glyph of
   *  ours (TODO 4.10c: the 1993 frame's five colour symbols). */
  image?: true;
};

type BakeNode = { type: string; props: Record<string, unknown>; textContent?: string; left?: number; top?: number };

/** The last HD bake's PNG (bakeDiscs keeps it for the pixel reads). */
let lastBake: Buffer = Buffer.alloc(0);

/** Each disc the HD bake lays out, in document order, with its glyphs. */
async function bakeDiscs(card: CardPreviewData): Promise<Array<Disc & { x: number; y: number }>> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const nodes: BakeNode[] = [];
  const response = await renderCardImage(card, "hd", {
    brandMark: true,
    printLayer: { omitArt: false, outputWidth: RULES_HD_WIDTH.portrait, onNodeDetected: (node) => nodes.push(node as BakeNode) },
  });
  lastBake = Buffer.from(await response.arrayBuffer());
  const discs: Array<Disc & { x: number; y: number }> = [];
  for (const node of nodes) {
    const style = (node.props.style ?? {}) as Record<string, unknown>;
    if (node.type === "svg" && discs.length > 0 && String(node.props.viewBox ?? "").startsWith("-")) {
      // The snow flake (its viewBox starts left of the path's box; the set
      // symbol's and the brand mark's start at 0).
      discs[discs.length - 1].flake = { size: node.props.width as number, viewBox: node.props.viewBox as string, paths: [] };
    } else if (node.type === "path" && discs.length > 0 && discs[discs.length - 1].flake && discs[discs.length - 1].flake!.paths.length < 2 && node.props.strokeMiterlimit !== undefined) {
      const p = node.props as Record<string, string | number>;
      discs[discs.length - 1].flake!.paths.push({ d: String(p.d), fill: String(p.fill), stroke: String(p.stroke), strokeWidth: Number(p.strokeWidth), join: String(p.strokeLinejoin), mitre: Number(p.strokeMiterlimit) });
    } else if (node.type === "img" && typeof style.width === "number" && style.borderRadius === style.width && style.height === style.width) {
      const shadow = typeof style.boxShadow === "string" ? /^(-?\d+)px (\d+)px 0 (#[0-9a-f]+)$/i.exec(style.boxShadow) : null;
      discs.push({ size: style.width, x: node.left ?? 0, y: node.top ?? 0, background: "", ...(typeof style.marginTop === "number" ? { lineTop: style.marginTop } : {}), shadow: shadow ? [Number(shadow[1]), Number(shadow[2]), shadow[3]] : null, glyphs: [], image: true });
    } else if (typeof style.width === "number" && style.borderRadius === style.width && style.height === style.width && style.objectFit === undefined) {
      const shadow = typeof style.boxShadow === "string" ? /^(-?\d+)px (\d+)px 0 (#[0-9a-f]+)$/i.exec(style.boxShadow) : null;
      if (style.boxShadow !== undefined) expect(shadow, String(style.boxShadow)).not.toBeNull();
      discs.push({
        size: style.width,
        // Where Satori laid the disc out (a rules pip: where it is drawn).
        x: node.left ?? 0,
        y: node.top ?? 0,
        background: typeof style.background === "string" ? style.background : null,
        ...(typeof style.marginTop === "number" ? { lineTop: style.marginTop } : {}),
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
    // 1 em of the pip's parent is a PLAIN pip's disc, in cqw of the card.
    const emCqw = unit(css(pip.parentElement!, "font-size"), "cqw");
    const pipPx = (emCqw * RULES_HD_WIDTH.portrait) / 100;
    // A pip in the rules text sits in RulesPip's wrapper, at the layout's top.
    const top = css(pip.parentElement!, "margin-top");
    const lineTop = top ? { lineTop: (unit(top, "cqw") * RULES_HD_WIDTH.portrait) / 100 } : {};
    const shadowOf = (emPx: number): Disc["shadow"] => {
      const value = css(pip, "box-shadow");
      if (!value) return null;
      const [x, y, blur, color] = value.split(/\s+/);
      expect(blur).toBe("0");
      return [unit(x, "em") * emPx, unit(y, "em") * emPx, color];
    };
    const image = pip.querySelector("img");
    if (image) {
      // A style's own symbol image: the span's em × the image's 1.3 em box
      // is one (plain) disc, round, and the shadow (if any) is the image's.
      const emPx = unit(css(pip, "font-size"), "em") * pipPx;
      expect(unit(css(image, "width"), "em") * emPx).toBeCloseTo(pipPx, 1);
      expect(unit(css(image, "height"), "em") * emPx).toBeCloseTo(pipPx, 1);
      expect(css(image, "border-radius")).toBe("50%");
      expect(image.getAttribute("src")).toMatch(/\/manaoriginal\/[wubrg](\.[0-9a-f]{12})?\.png$/);
      const value = css(image, "box-shadow");
      expect(value).toBe("");
      return { size: pipPx, background: "", ...lineTop, shadow: null, glyphs: [], image: true as const };
    }
    if (pip.tagName === "SPAN") {
      // In the row's own em: the disc's width says its size.
      const size = unit(css(pip, "width"), "em") * pipPx;
      expect(css(pip, "height")).toBe(css(pip, "width"));
      expect(css(pip, "border-radius")).toBe("50%");
      const svg = pip.querySelector("svg");
      if (svg) {
        // The snow flake: a solid disc with the SVG centred on it.
        expect(css(pip, "align-items")).toBe("center");
        expect(css(pip, "justify-content")).toBe("center");
        expect(css(svg, "height")).toBe(css(svg, "width"));
        return {
          size,
          background: css(pip, "background-color") || null,
          ...lineTop,
          shadow: shadowOf(pipPx),
          glyphs: [],
          flake: {
            size: unit(css(svg, "width"), "em") * pipPx,
            viewBox: svg.getAttribute("viewBox") ?? "",
            paths: (Array.from(svg.children) as Element[]).map((path) => ({
              d: path.getAttribute("d") ?? "",
              fill: path.getAttribute("fill") ?? "",
              stroke: path.getAttribute("stroke") ?? "",
              strokeWidth: Number(path.getAttribute("stroke-width")),
              join: path.getAttribute("stroke-linejoin") ?? "",
              mitre: Number(path.getAttribute("stroke-miterlimit")),
            })),
          },
        };
      }
      // A split disc.
      expect(css(pip, "overflow")).toBe("hidden");
      return {
        size,
        background: css(pip, "background"),
        ...lineTop,
        shadow: shadowOf(pipPx),
        glyphs: (Array.from(pip.children) as Element[]).map((half) => {
          const fontPx = unit(css(half, "font-size"), "em") * pipPx;
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
    const fontPx = unit(css(pip, "font-size"), "em") * pipPx;
    const size = unit(css(pip, "width"), "em") * fontPx;
    expect(unit(css(pip, "height"), "em") * fontPx).toBeCloseTo(size, 1);
    expect(css(pip, "border-radius")).toBe("50%");
    expect(css(pip, "text-align")).toBe("center");
    return {
      size,
      background: css(pip, "background-color") || null,
      ...lineTop,
      shadow: shadowOf(fontPx),
      glyphs: [{ glyph: glyphOf(pip), fontPx, color: css(pip, "color") }],
    };
  });
}

function expectSameDisc(preview: Disc, bake: Disc, label: string) {
  expect(preview.size, `${label}: disc`).toBeCloseTo(bake.size, 1);
  expect(Boolean(preview.image), `${label}: an image pip in both`).toBe(Boolean(bake.image));
  expect(preview.background?.toLowerCase() ?? null, `${label}: fill`).toBe(bake.background?.toLowerCase() ?? null);
  if (bake.lineTop !== undefined) expect(preview.lineTop, `${label}: top in the line`).toBeCloseTo(bake.lineTop, 1);
  else expect(preview.lineTop, `${label}: a cost pip`).toBeUndefined();
  if (bake.flake) {
    expect(bake.flake.paths, `${label}: the flake's two paths`).toHaveLength(2);
    expect(preview.flake?.size, `${label}: flake`).toBeCloseTo(bake.flake.size, 1);
    expect(preview.flake?.viewBox, `${label}: flake viewBox`).toBe(bake.flake.viewBox);
    expect(preview.flake?.paths, `${label}: flake paths`).toEqual(bake.flake.paths);
  } else {
    expect(preview.flake, `${label}: no flake`).toBeUndefined();
  }
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
    const symbols = braces(["X", "S", "T", "Q", "E", "U/W", "2/G", "G/P", "G/U/P"]);
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
      // 66 px; a Phyrexian symbol's disc ×1.2 (New Phyrexia's own: 80.9 px).
      expect(bake[i].size, `cost ${cost[i]}`).toBe(cost[i].endsWith("/P}") ? 79 : 66);
      // The shadow is the disc's own share: 6 px under 66, 7 under 79.
      const down = cost[i].endsWith("/P}") ? 7 : 6;
      expect(bake[i].shadow, `bake cost ${cost[i]}`).toEqual([-2, down, "#000"]);
      expect(preview[i].shadow![0], `preview cost ${cost[i]}: left`).toBeCloseTo(-2, 1);
      expect(preview[i].shadow![1], `preview cost ${cost[i]}: down`).toBeCloseTo(down, 1);
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

// ---------------------------------------------------------------------------
// The symbols as printed (layout v49, owner round 43), by their own numbers
// and out of the PNG. The loops above hold the preview to the bake; this
// says what both must BE — measured on the prints (docs/FRAMES.md "Symbols
// as printed") — and reads each drawing out of a real HD bake: a pip in the
// rules text sits where Satori laid it out, so its cell is cut from the PNG
// and its colours counted.
// ---------------------------------------------------------------------------

describe("the symbols as printed (v49): the numbers, in both renderers and in the PNG", () => {
  const INK = "#150d08";
  type Cell = { size: number; hex: (x: number, y: number) => string; count: (hex: string) => number; box: (test: (hex: string) => boolean) => { w: number; h: number; cx: number; cy: number } | null };

  /** The square cell of each rules-text disc of `data`'s HD bake. */
  async function cells(data: CardPreviewData, margin = 0): Promise<{ bake: Awaited<ReturnType<typeof bakeDiscs>>; preview: Disc[]; cells: Cell[] }> {
    const [bake, preview] = [await bakeDiscs(data), await previewDiscs(data)];
    const { data: px, info } = await sharp(lastBake).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = bake.map((disc) => {
      const [x0, y0, size] = [Math.round(disc.x) - margin, Math.round(disc.y) - margin, disc.size + 2 * margin];
      const hex = (x: number, y: number) => `#${[0, 1, 2].map((c) => px[((y0 + y) * info.width + x0 + x) * 3 + c].toString(16).padStart(2, "0")).join("")}`;
      const each = (fn: (x: number, y: number, h: string) => void) => {
        for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) fn(x, y, hex(x, y));
      };
      return {
        size: disc.size,
        hex,
        count: (want: string) => {
          let n = 0;
          each((_x, _y, h) => {
            if (h === want) n += 1;
          });
          return n;
        },
        box: (test: (hex: string) => boolean) => {
          const b = { x0: Infinity, x1: -1, y0: Infinity, y1: -1 };
          each((x, y, h) => {
            if (!test(h)) return;
            b.x0 = Math.min(b.x0, x);
            b.x1 = Math.max(b.x1, x);
            b.y0 = Math.min(b.y0, y);
            b.y1 = Math.max(b.y1, y);
          });
          if (b.x1 < 0) return null;
          return { w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, cx: (b.x0 + b.x1 + 1) / 2 - size / 2, cy: (b.y0 + b.y1 + 1) / 2 - size / 2 };
        },
      };
    });
    expect(preview).toHaveLength(bake.length);
    bake.forEach((disc, i) => expectSameDisc(preview[i], disc, `v49 pip ${i}`));
    return { bake, preview, cells: out };
  }
  /** Dark enough to be the symbol's ink or its anti-aliased edge. */
  const dark = (hex: string) => Number.parseInt(hex.slice(1, 3), 16) < 0x60;
  const rules = (text: string, cost: string | null = null) => card("m15", cost, text);
  /** A disc's own colour spans it but for the anti-aliased rim. */
  const expectDisc = (cell: Cell, bg: string, size: number) => {
    const box = cell.box((h) => h === bg);
    expect(box, bg).not.toBeNull();
    for (const side of [box!.w, box!.h]) {
      expect(side, `${bg} disc`).toBeGreaterThanOrEqual(size - 2);
      expect(side, `${bg} disc`).toBeLessThanOrEqual(size);
    }
    expect(Math.abs(box!.cx) + Math.abs(box!.cy), `${bg} disc centred in its cell`).toBeLessThanOrEqual(1);
  };

  it("#1 a pip in the rules text is FLAT on the M15-era style; the cost row keeps its shadow", async () => {
    const { symbolStyle, inlineSymbolStyle } = await import("@/lib/cards/symbol-style");
    expect(inlineSymbolStyle(symbolStyle("modern")).discShadow).toBeNull();
    expect(symbolStyle("modern").discShadow).toEqual({ left: 0.06, down: 0.07, colorHex: "#111" });
    for (const style of Object.values(SYMBOL_STYLES)) expect(inlineSymbolStyle(style).discShadow, style.id).toBeNull();

    const { bake, preview, cells: [, inline] } = await cells(rules("{G}: Draw a card.", "{G}"), 6);
    expect(bake.map((d) => d.shadow)).toEqual([[-4, 5, "#111"], null]);
    expect(preview[1].shadow).toBeNull();
    // The PNG: nothing as dark as a shadow round the inline disc — the 6 px
    // margin all round it holds the text box's ground alone (the stand-in
    // frame's grey), where the old shadow lay 3–4 px left and down.
    expectDisc(inline, "#93b483", 60);
    for (let i = 0; i < inline.size + 12; i += 1) {
      for (const [x, y] of [[i, inline.size + 9], [i, inline.size + 7], [2, i], [0, i]] as const) {
        expect(dark(inline.hex(Math.min(x, inline.size + 11), Math.min(y, inline.size + 11))), `no shadow at ${x},${y}`).toBe(false);
      }
    }
  }, 60_000);

  it("#2 Phyrexian: a disc 1.2× a plain pip's, the symbol 0.90 of it — cost and rules text", async () => {
    const { manaGemSpec, pipDiscPx, pipRisePx, pipScale, LARGE_PIP_SCALE, PHYREXIAN_GLYPH_OF_DISC } = await import("@/lib/cards/mana-gem");
    expect([LARGE_PIP_SCALE, PHYREXIAN_GLYPH_OF_DISC]).toEqual([1.2, 0.91]);
    for (const c of ["w", "u", "b", "r", "g"]) expect(pipScale(`${c}p`), c).toBe(1.2);
    // Not the hybrids or the twobrids (their own measuring task), nor {C/P}.
    for (const other of ["g", "7", "wu", "2w", "cw", "s", "e", "untap", "tap", "cp"]) expect(pipScale(other), other).toBe(1);
    expect([pipDiscPx("gp", 73), pipDiscPx("gp", 60), pipRisePx("gp", 60), pipRisePx("g", 60)]).toEqual([88, 72, 6, 0]);
    expect(manaGemSpec("gp", 73, SYMBOL_STYLES.modern)).toEqual({ kind: "solid", suffix: "gp", discPx: 88, bg: "#93b483", ink: INK, glyphPx: 80 });

    const { bake, cells: [, , plain, phy] } = await cells(rules("{2}{G/P}: Draw a card.", "{2}{G/P}"));
    // Cost: 73 beside 88; the larger disc's shadow is its own size's.
    expect(bake.slice(0, 2).map((d) => [d.size, d.shadow])).toEqual([[73, [-4, 5, "#111"]], [88, [-5, 6, "#111"]]]);
    // Rules text: 60 beside 72, the larger disc 6 px higher (same centre).
    expect([plain.size, phy.size]).toEqual([60, 72]);
    expect(bake[2].lineTop! - bake[3].lineTop!).toBe(6);
    expect(bake[3].y + 36).toBe(bake[2].y + 30);
    // The PNG: the green disc 72 px across, the symbol 0.90 of it tall
    // (the prints: 0.913 ± 0.018) and centred.
    expectDisc(phy, "#93b483", 72);
    expectDisc(plain, "#beb9b2", 60);
    const ink = phy.box(dark)!;
    expect(ink.h / 72).toBeGreaterThan(0.88);
    expect(ink.h / 72).toBeLessThan(0.93);
    expect(Math.abs(ink.cx)).toBeLessThan(1.5);
    expect(Math.abs(ink.cy)).toBeLessThan(2.5);
  }, 60_000);

  it("#3 two-colour Phyrexian: a split disc on the larger size, a Phyrexian symbol in each half", async () => {
    const { manaGemSpec, pipScale, drawsManaGem } = await import("@/lib/cards/mana-gem");
    const { getManaCodepoint } = await import("@/lib/render/card-fonts");
    expect(pipScale("gup")).toBe(1.2);
    expect(manaGemSpec("gup", 73, SYMBOL_STYLES.modern)).toEqual({
      kind: "split",
      suffix: "gup",
      discPx: 88,
      ink: INK,
      background: "linear-gradient(135deg, #93b483 50%, #b5cde3 50%)",
      halfPx: 40,
      top: { suffix: "p", bg: "#93b483", topPx: 8, leftPx: 9 },
      bottom: { suffix: "p", bg: "#b5cde3", topPx: 38, leftPx: 39 },
    });
    for (const style of Object.values(SYMBOL_STYLES)) expect(drawsManaGem("gup", style), style.id).toBe(true);

    const { bake, cells: [split] } = await cells(rules("{G/U/P}: Draw a card."));
    expect(bake[0].size).toBe(72);
    expect(bake[0].glyphs.map((g) => g.glyph)).toEqual([getManaCodepoint("p"), getManaCodepoint("p")]);
    // The PNG: green up-left, blue down-right, ink in both halves — each
    // symbol 0.40–0.50 of the disc tall (the prints: 0.453 ± 0.051) and
    // 0.14–0.20 of it off the centre along the diagonal (0.169 ± 0.029).
    expect(split.hex(14, 36)).toBe("#93b483");
    expect(split.hex(58, 36)).toBe("#b5cde3");
    const half = (upLeft: boolean) => {
      const b = { x0: Infinity, x1: -1, y0: Infinity, y1: -1 };
      for (let y = 0; y < 72; y += 1) {
        for (let x = 0; x < 72; x += 1) {
          if (x + y < 72 !== upLeft || !dark(split.hex(x, y))) continue;
          b.x0 = Math.min(b.x0, x);
          b.x1 = Math.max(b.x1, x);
          b.y0 = Math.min(b.y0, y);
          b.y1 = Math.max(b.y1, y);
        }
      }
      return { h: (b.y1 - b.y0 + 1) / 72, cx: ((b.x0 + b.x1 + 1) / 2 - 36) / 72, cy: ((b.y0 + b.y1 + 1) / 2 - 36) / 72 };
    };
    for (const [h, sign] of [[half(true), -1], [half(false), 1]] as const) {
      expect(h.h).toBeGreaterThan(0.4);
      expect(h.h).toBeLessThan(0.5);
      expect(h.cx * sign).toBeGreaterThan(0.14);
      expect(h.cx * sign).toBeLessThan(0.2);
      expect(h.cy * sign).toBeGreaterThan(0.14);
      expect(h.cy * sign).toBeLessThan(0.2);
    }
  }, 60_000);

  it("#4 untap: a white arrow on a near-black disc, the arrow 0.63 of the disc", async () => {
    const { manaGemSpec, UNTAP_GEM } = await import("@/lib/cards/mana-gem");
    expect(UNTAP_GEM).toEqual({ bg: "#211f23", ink: "#ffffff", glyphOfDisc: 0.9 });
    for (const style of Object.values(SYMBOL_STYLES)) {
      expect(manaGemSpec("untap", 60, style), style.id).toEqual({ kind: "solid", suffix: "untap", discPx: 60, bg: "#211f23", ink: "#ffffff", glyphPx: 54 });
    }
    const { cells: [untap, tap] } = await cells(rules("{Q}, {T}: Draw a card."));
    // The PNG: the disc's own colour edge to edge, the arrow pure white.
    expectDisc(untap, "#211f23", 60);
    const arrow = untap.box((h) => h === "#ffffff")!;
    expect(arrow.h / 60).toBeGreaterThan(0.61);
    expect(arrow.h / 60).toBeLessThan(0.66);
    expect(arrow.w / 60).toBeGreaterThan(0.59);
    expect(arrow.w / 60).toBeLessThan(0.66);
    expect(untap.count(INK)).toBe(0);
    // {T} beside it is unchanged: the grey disc, the dark arrow.
    expect(tap.count("#beb9b2")).toBeGreaterThan(1500);
    expect(tap.count(INK)).toBeGreaterThan(300);
    expect(tap.count("#ffffff")).toBe(0);
  }, 60_000);

  it("#5 snow: a WHITE flake with a thin dark outline, 0.92 of its grey disc", async () => {
    const { manaGemSpec, SNOW_GEM } = await import("@/lib/cards/mana-gem");
    const { SNOW_FLAKE_PATH, SNOW_FLAKE_BOX } = await import("@/lib/cards/snow-flake-path");
    expect(SNOW_GEM).toEqual({ flakeOfDisc: 0.94, fill: "#ffffff", outlineOfDisc: 0.062, fillOfDisc: 0.012 });
    expect(SNOW_FLAKE_BOX).toEqual([1, 33.2, 999, 1008.8]);
    const spec = manaGemSpec("s", 60, SYMBOL_STYLES.modern);
    expect(spec).toEqual({
      kind: "solid",
      suffix: "s",
      discPx: 60,
      bg: "#beb9b2",
      ink: INK,
      glyphPx: 44,
      flake: { sizePx: 56, viewBox: "-75.453 -54.453 1150.906 1150.906", d: SNOW_FLAKE_PATH, outlineWidth: 152.906, fillWidth: 29.595, fill: "#ffffff" },
    });

    const { bake, cells: [snow, generic] } = await cells(rules("{S}{2}: Draw a card."));
    expect(bake[0].glyphs).toEqual([]);
    expect(bake[0].flake?.paths.map((p) => [p.fill, p.stroke, p.strokeWidth, p.join, p.mitre])).toEqual([
      [INK, INK, 152.906, "miter", 2.5],
      ["#ffffff", "#ffffff", 29.595, "miter", 2.5],
    ]);
    // The PNG: the grey disc of a generic pip; on it white petals (more
    // white than ink — a white flake, not a line drawing) inside a dark
    // outline 0.90–0.94 of the disc across (the prints: 0.921 ± 0.009).
    expectDisc(snow, "#beb9b2", 60);
    expectDisc(generic, "#beb9b2", 60);
    const flake = snow.box((h) => h === "#ffffff" || dark(h))!;
    // (Mean of its width and height, as the prints were measured: the
    // drawing is a little wider than tall.)
    expect((flake.w + flake.h) / 2 / 60).toBeGreaterThan(0.9);
    expect((flake.w + flake.h) / 2 / 60).toBeLessThan(0.94);
    expect(flake.w).toBeGreaterThanOrEqual(flake.h);
    expect(Math.abs(flake.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(flake.cy)).toBeLessThanOrEqual(1);
    const [white, ink] = [snow.count("#ffffff"), snow.count(INK)];
    expect(white, `white ${white}, ink ${ink}`).toBeGreaterThan(600);
    expect(white, `white ${white}, ink ${ink}`).toBeGreaterThan(ink * 1.2);
    // The outline is thin: along the row through the flake's middle, the
    // first run of dark pixels in from its left tip is 2–5 px.
    let run = 0;
    for (let x = 0; x < 30 && run < 9; x += 1) {
      if (dark(snow.hex(x, 31))) run += 1;
      else if (run > 0) break;
    }
    expect(run).toBeGreaterThanOrEqual(2);
    expect(run).toBeLessThanOrEqual(5);
  }, 60_000);

  it("#6 energy: the bare symbol — no disc, no shadow — 0.89 of a text pip's disc, in a pip's cell", async () => {
    const { manaGemSpec, ENERGY_GEM, pipScale } = await import("@/lib/cards/mana-gem");
    expect(ENERGY_GEM).toEqual({ glyphOfDisc: 1.04 });
    expect(pipScale("e")).toBe(1);
    expect(manaGemSpec("e", 60, SYMBOL_STYLES.modern)).toEqual({ kind: "solid", suffix: "e", discPx: 60, bg: null, ink: INK, glyphPx: 62 });

    // In the cost row too: no disc, and no shadow though the row has one.
    const { bake, preview, cells: [, , energy, generic] } = await cells(rules("{E}{2}: Draw a card.", "{E}{2}"), 2);
    expect(bake.map((d) => [d.size, d.background, d.shadow])).toEqual([
      [73, null, null],
      [73, "#beb9b2", [-4, 5, "#111"]],
      [60, null, null],
      [60, "#beb9b2", null],
    ]);
    expect(preview[0].shadow).toBeNull();
    // A pip's cell: the {2} after it starts where it does after a {G}.
    const twin = await bakeDiscs(rules("{G}{2}: Draw a card.", "{G}{2}"));
    expect(bake.map((d) => [d.x, d.y])).toEqual(twin.map((d) => [d.x, d.y]));
    // The PNG: not one pixel of a disc; the symbol 0.87–0.92 of the cell
    // tall (the prints: 0.895 ± 0.012) and 0.84–0.91 wide (0.883 ± 0.016).
    expect(energy.count("#beb9b2")).toBe(0);
    expect(generic.count("#beb9b2")).toBeGreaterThan(1500);
    const ink = energy.box(dark)!;
    expect(ink.h / 60).toBeGreaterThan(0.87);
    expect(ink.h / 60).toBeLessThan(0.92);
    expect(ink.w / 60).toBeGreaterThan(0.84);
    expect(ink.w / 60).toBeLessThan(0.91);
  }, 60_000);
});
