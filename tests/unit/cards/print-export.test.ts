import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import {
  bleedPx,
  cardPrintFilename,
  cardPrintPngHref,
  frameTemplateOf,
  isPrintRequest,
  parseBleedParam,
  parsePpiParam,
  PRINT_800_PPI_PAID_ONLY,
  PRINT_NATIVE_800_TEMPLATES,
  printFrameUpscaledAt800,
  printPixelSize,
  printScale,
} from "@/lib/cards/print-export";

// ---------------------------------------------------------------------------
// The print export's numbers (TODO 6.1a / 6.1b): 2.5 × 3.5 in at the trim,
// 1/8 in of bleed a side — 600 ppi 1500 × 2100 (+75 → 1650 × 2250), 800 ppi
// 2000 × 2800 (+100 → 2200 × 3000); the query parsers the png route reads;
// the file names; and the 800 ppi "upscaled" gate, held to the manifest.
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
    expect(size.bleed).toBe(bleed ? bleedPx(ppi) : 0);
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
  });

  it("a print request is 800 ppi or the bleed — never the plain 600 ppi download", () => {
    expect(isPrintRequest({ ppi: 600, bleed: false })).toBe(false);
    expect(isPrintRequest({ ppi: 800, bleed: false })).toBe(true);
    expect(isPrintRequest({ ppi: 600, bleed: true })).toBe(true);
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
