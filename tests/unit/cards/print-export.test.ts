import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import {
  BLEED_IN,
  bleedPx,
  bleedPxPerAxis,
  CARD_TRIM_IN,
  cardPrintFilename,
  cardPrintPngHref,
  frameTemplateOf,
  isPrintRequest,
  MPC_BLEED_IN,
  MPC_SAFE_IN,
  parseBleedParam,
  parsePpiParam,
  parsePrintBleedParam,
  parsePrintParam,
  PRINT_800_PPI_PAID_ONLY,
  PRINT_NATIVE_800_TEMPLATES,
  printFrameUpscaledAt800,
  printBleedInches,
  printPixelSize,
  printScale,
  printTurnsPortrait,
} from "@/lib/cards/print-export";

// ---------------------------------------------------------------------------
// The print export's numbers (TODO 6.1a / 6.1b): 2.5 × 3.5 in at the trim,
// 1/8 in of bleed a side — 600 ppi 1500 × 2100 (+75 → 1650 × 2250), 800 ppi
// 2000 × 2800 (+100 → 2200 × 3000); the query parsers the png route reads;
// the file names; and the 800 ppi "upscaled" gate, held to the manifest.
//
// MakePlayingCards (TODO 6.1): MPC's own upload page asks a poker-size card
// (2.5 × 3.5 in) for 822 × 1122 px at 300 dpi — 36 px of bleed a side on
// both axes, scaling with the dpi — so 1644 × 2244 at 600 ppi and 2192 ×
// 2992 at 800, always portrait (makeplayingcards.com/pops/faq-photo.html).
// ---------------------------------------------------------------------------

describe("print sizes", () => {
  it.each([
    [600, false, false, 1500, 2100],
    [600, true, false, 1650, 2250],
    [800, false, false, 2000, 2800],
    [800, true, false, 2200, 3000],
    [800, true, true, 3000, 2200],
  ] as const)("%s ppi, bleed %s, landscape %s → %s × %s", (ppi, bleed, landscape, w, h) => {
    const size = printPixelSize(ppi, { bleed, landscape });
    expect([size.width, size.height]).toEqual([w, h]);
    expect([size.bleedX, size.bleedY]).toEqual(bleed ? [bleedPx(ppi), bleedPx(ppi)] : [0, 0]);
  });

  it("MakePlayingCards: 822 × 1122 at MPC's 300 dpi — 36 px a side on both axes — so 1644 × 2244 at 600 ppi, 2192 × 2992 at 800", () => {
    expect(MPC_BLEED_IN).toEqual({ x: 0.12, y: 0.12 });
    expect(MPC_SAFE_IN).toBe(0.12);
    // MPC's own numbers, at its 300 dpi (and its 900 dpi example: 108 px).
    expect(bleedPxPerAxis(300, "mpc")).toEqual({ x: 36, y: 36 });
    expect(bleedPxPerAxis(900, "mpc")).toEqual({ x: 108, y: 108 });
    expect(printPixelSize(300, { bleed: "mpc" })).toMatchObject({ width: 822, height: 1122 });
    expect(printPixelSize(600, { bleed: "mpc" })).toEqual({ width: 1644, height: 2244, bleedX: 72, bleedY: 72 });
    expect(printPixelSize(800, { bleed: "mpc" })).toEqual({ width: 2192, height: 2992, bleedX: 96, bleedY: 96 });
    // Not the 1/8 in bleed (75 px at 600 ppi).
    expect(printPixelSize(600, { bleed: true })).toMatchObject({ width: 1650, height: 2250 });
  });

  it("MakePlayingCards' file is always PORTRAIT: a landscape card (Battle, Split) is turned into it", () => {
    expect(printTurnsPortrait("mpc")).toBe(true);
    for (const bleed of [false, true, { x: 0.11, y: 0.1 }] as const) expect(printTurnsPortrait(bleed)).toBe(false);
    expect(printPixelSize(600, { bleed: "mpc", landscape: true })).toEqual({ width: 1644, height: 2244, bleedX: 72, bleedY: 72 });
    // The 1/8 in bleed keeps the landscape render landscape (the PDF turns it).
    expect(printPixelSize(600, { bleed: true, landscape: true })).toMatchObject({ width: 2250, height: 1650 });
  });

  it("a bleed per axis: x on the portrait card's left and right, y on its top and bottom — swapped on a landscape render", () => {
    // Card Conjurer's margin geometry (816 × 1110 at 300 dpi: 33 × 30 px).
    const cc = { x: 0.11, y: 0.1 };
    expect(printBleedInches(cc)).toBe(cc);
    expect(printBleedInches(true)).toEqual({ x: BLEED_IN, y: BLEED_IN });
    expect(printBleedInches(false)).toEqual({ x: 0, y: 0 });
    expect(printPixelSize(300, { bleed: cc })).toEqual({ width: 816, height: 1110, bleedX: 33, bleedY: 30 });
    expect(printPixelSize(600, { bleed: cc })).toEqual({ width: 1632, height: 2220, bleedX: 66, bleedY: 60 });
    // Landscape: the card turned — its long side across, its y bleed there.
    expect(printPixelSize(600, { bleed: cc, landscape: true })).toEqual({ width: 2220, height: 1632, bleedX: 60, bleedY: 66 });
    expect(CARD_TRIM_IN).toEqual({ width: 2.5, height: 3.5 });
  });

  it("the bleed is 1/8 in at the resolution, and 800 ppi is the HD layout at 4/3", () => {
    expect(bleedPx(600)).toBe(75);
    expect(bleedPx(800)).toBe(100);
    expect(printScale(600)).toBe(1);
    expect(printScale(800)).toBeCloseTo(4 / 3, 12);
  });
});

describe("query parsing", () => {
  it("ppi: 800 only when asked; anything else is the HD render's 600", () => {
    expect(parsePpiParam("800")).toBe(800);
    for (const value of ["600", null, undefined, "", "1200", "800.0", " 800"]) expect(parsePpiParam(value)).toBe(600);
  });

  it("bleed: 1 or true", () => {
    expect(parseBleedParam("1")).toBe(true);
    expect(parseBleedParam("true")).toBe(true);
    for (const value of ["0", "false", null, "", "yes"]) expect(parseBleedParam(value)).toBe(false);
    // The PDF route's parser knows no MPC (MPC takes images).
    expect(parseBleedParam("mpc")).toBe(false);
  });

  it("the png route's bleed: mpc, 1 / true, or none", () => {
    expect(parsePrintBleedParam("mpc")).toBe("mpc");
    expect(parsePrintBleedParam("1")).toBe(true);
    expect(parsePrintBleedParam("true")).toBe(true);
    for (const value of ["0", "false", null, undefined, "", "MPC", "yes"]) expect(parsePrintBleedParam(value)).toBe(false);
    expect(isPrintRequest({ ppi: 600, bleed: "mpc" })).toBe(true);
  });

  it("a print request is 800 ppi or the bleed — never the plain 600 ppi download", () => {
    expect(isPrintRequest({ ppi: 600, bleed: false })).toBe(false);
    expect(isPrintRequest({ ppi: 800, bleed: false })).toBe(true);
    expect(isPrintRequest({ ppi: 600, bleed: true })).toBe(true);
  });

  it("print=1 asks for the 600 ppi print render without a bleed (TODO 6.15 — the exports)", () => {
    expect(parsePrintParam("1")).toBe(true);
    expect(parsePrintParam("true")).toBe(true);
    for (const value of ["0", "false", null, undefined, "", "yes"]) expect(parsePrintParam(value)).toBe(false);
    expect(isPrintRequest({ ppi: 600, bleed: false, print: true })).toBe(true);
    expect(isPrintRequest({ ppi: 600, bleed: false, print: false })).toBe(false);
  });
});

describe("links and file names", () => {
  it("names the resolution and the bleed", () => {
    expect(cardPrintPngHref("c1", { ppi: 800, bleed: false })).toBe("/api/cards/c1/png?ppi=800&corners=square");
    expect(cardPrintPngHref("c1", { ppi: 600, bleed: true })).toBe("/api/cards/c1/png?ppi=600&corners=square&bleed=1");
    expect(cardPrintFilename("grizzly", { ppi: 800, bleed: false })).toBe("grizzly-800ppi.png");
    expect(cardPrintFilename("grizzly", { ppi: 600, bleed: true })).toBe("grizzly-bleed.png");
    expect(cardPrintFilename("grizzly", { ppi: 800, bleed: true })).toBe("grizzly-800ppi-bleed.png");
  });

  it("names MakePlayingCards' file (TODO 6.1)", () => {
    expect(cardPrintPngHref("c1", { ppi: 600, bleed: "mpc" })).toBe("/api/cards/c1/png?ppi=600&corners=square&bleed=mpc");
    expect(cardPrintPngHref("c1", { ppi: 800, bleed: "mpc" })).toBe("/api/cards/c1/png?ppi=800&corners=square&bleed=mpc");
    expect(cardPrintFilename("grizzly", { ppi: 600, bleed: "mpc" })).toBe("grizzly-mpc.png");
    expect(cardPrintFilename("grizzly", { ppi: 800, bleed: "mpc" })).toBe("grizzly-800ppi-mpc.png");
  });

  it("a print link always names a PRINT render: at 600 ppi without a bleed it says print=1", () => {
    // `ppi=600&corners=square` alone is the plain HD download (the bake's
    // 1600 px art), which the exports used to print from.
    expect(cardPrintPngHref("c1", { ppi: 600, bleed: false })).toBe("/api/cards/c1/png?ppi=600&corners=square&print=1");
    expect(cardPrintFilename("grizzly", { ppi: 600, bleed: false })).toBe("grizzly-print.png");
  });

  it("reads the template off any frame_style shape", () => {
    expect(frameTemplateOf({ template: "m15", finish: "foil" })).toBe("m15");
    for (const value of [null, undefined, "m15", {}, { template: 3 }]) expect(frameTemplateOf(value)).toBeUndefined();
  });
});

describe("800 ppi entitlement and sharpness", () => {
  it("is paid-only (TODO 6.1b [decide], the recommended option)", () => {
    expect(PRINT_800_PPI_PAID_ONLY).toBe(true);
  });

  it("calls every template's 800 ppi frame upscaled until the manifest carries a native (≥ 2000 px) master set", () => {
    const files = (manifest as { files: Record<string, { width: number }> }).files;
    for (const template of PRINT_NATIVE_800_TEMPLATES) {
      const masters = Object.entries(files).filter(([key]) => key.startsWith(`${template}/`) && key.endsWith(".png"));
      expect(masters.length, template).toBeGreaterThan(0);
      for (const [key, entry] of masters) expect(entry.width, key).toBeGreaterThanOrEqual(2000);
    }
    // Today the importer downscales every master once to 1500 × 2100, so
    // none is listed.
    expect(PRINT_NATIVE_800_TEMPLATES.size).toBe(0);
    expect(printFrameUpscaledAt800("m15")).toBe(true);
    expect(printFrameUpscaledAt800(undefined)).toBe(true);
  });
});
