import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Preview ⇄ bake parity guards (CLAUDE.md: the browser preview and the Satori
// bake must stay pixel-identical). These pin the places the 2026-09-22 audit
// found drifting, plus the pure helpers the OG/oEmbed routes use to size a
// landscape (Battle) render.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const BAKE = read("lib/render/card-image.tsx");
const PREVIEW = read("components/cards/card-preview.tsx");
const SET_SYMBOL = read("components/cards/set-symbol.tsx");

describe("set symbol", () => {
  it("uses ONE rarity ink table in the bake and the preview, with no preview-only gradient", () => {
    expect(BAKE).toContain("const RARITY_SET_SYMBOL_COLOR: Record<Rarity, string> = RARITY_INK;");
    expect(BAKE).not.toMatch(/uncommon: "#9a9aa8"/);
    expect(SET_SYMBOL).toContain("RARITY_INK");
    expect(SET_SYMBOL).not.toContain("ss-grad");
  });
});

describe("watermark", () => {
  it("caps the image width at 86% of the rules box in both renderers", () => {
    expect(PREVIEW).toContain('maxWidth: "86%"');
    expect(BAKE).toContain("maxWidth: Math.round((layout.rules.rect.widthPct / 100) * width * 0.86)");
  });
});

describe("Satori layout traps", () => {
  it("never wraps bake layers in a Fragment", () => {
    // Satori lays a Fragment out as a zero-width flex item, so %-positioned
    // children collapse to x = 0 — the etched finish drew an 18 px gold strip
    // down the card's left edge that way (owner review 2026-09-25). (Satori
    // also ignores `inset`: the foil sheen still uses it and has never baked
    // — TODO 6.5.)
    const code = BAKE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/<>|<\/>|<(React\.)?Fragment\b/);
  });
});

describe("title band", () => {
  it("keeps the same name/cost gap and never truncates the title in the bake only", () => {
    expect(PREVIEW).toContain('gap: "2cqw"');
    expect(BAKE).toContain("gap: fpx(0.02, cardWidth)");
    expect(BAKE).not.toContain(".slice(0, 80)");
  });
});

describe("display-font lines", () => {
  it("hand every title, type line and display footer to displayLine in both renderers", () => {
    // Satori places a word after a space at unkerned advances (TODO 4.31):
    // a single-line Beleren text must reach either renderer as one run.
    for (const src of [BAKE, PREVIEW]) {
      expect(src).not.toMatch(/>\s*\{(title|safeTitle|name|typeLine)\}\s*<\/span>/);
      expect(src).toMatch(/\{slotLine\(\s*layout\.footer\.font,\s*\w+\.artistCredit/);
    }
    expect(BAKE).toContain("{slotLine(layout.footer.font, watermarkText)}");
    expect(PREVIEW).toContain("{slotLine(layout.footer.font, footerWatermark)}");
    expect(BAKE).toContain("{displayLine(title)}");
    expect(PREVIEW).toContain("{displayLine(safeTitle)}");
    expect(BAKE.match(/\{displayLine\(typeLine\)\}/g)).toHaveLength(3);
    expect(PREVIEW.match(/\{displayLine\(typeLine\)\}/g)).toHaveLength(2);
    expect(PREVIEW).toMatch(/\{displayLine\(\s*buildTypeLine\(/);
    expect(BAKE.match(/\{displayLine\(name\)\}/g)).toHaveLength(2);
    expect(PREVIEW.match(/\{displayLine\(name\)\}/g)).toHaveLength(2);
  });

  it("centre the bake's token title and type line on their kerned width, with no filler span", () => {
    // Satori sizes a text node unkerned and draws it kerned: a centred band
    // must hand its line to alignedText (display-line-bake.test.ts measures
    // it), and must not add the empty span + gap the preview never renders.
    expect(BAKE.match(/style=\{alignedText\(/g)).toHaveLength(2);
    expect(BAKE).toContain("isAligned(layout.title) ? null : (");
    expect(BAKE).toContain("isAligned(typeSlot) ? null : (");
  });
});

describe("landscape renders", () => {
  it("report the rotated display size and draw the composite card 7:5", async () => {
    // card-image.tsx pulls fonts/frames lazily, but its module graph is
    // pure at import time apart from server-only, which vitest stubs.
    const { naturalRenderSize, RENDER_PRESETS } = await import("@/lib/render/card-image");
    const portrait = naturalRenderSize(false);
    const landscape = naturalRenderSize(true);
    expect(portrait).toEqual({ width: RENDER_PRESETS.default.width, height: RENDER_PRESETS.default.height });
    expect(landscape).toEqual({ width: portrait.height, height: portrait.width });
    expect(landscape.width).toBeGreaterThan(landscape.height);

    const social = read("lib/og/card-social.tsx");
    expect(social).toContain("export function socialCardBox(landscape: boolean)");
    expect(social).toContain("width={box.width}");
    expect(read("app/api/cards/[id]/og/route.ts")).toContain("landscape: isLandscapeRender(previewData)");
    expect(read("app/api/oembed/route.ts")).toContain("naturalRenderSize(isLandscapeTemplate(card.frame_style))");
  });
});

describe("art guard", () => {
  it("is shared by the save-time bake and the admin sweep", () => {
    expect(read("lib/cards/bake-render.ts")).toContain("export async function resolveBakeArt(");
    // The sweep batch moved out of the route (shared with the compare page's
    // "Re-bake now", TODO 0.20) — the guard must stay in it.
    expect(read("lib/cards/rebake-batch.ts")).toContain("await resolveBakeArt(row.art_url)");
    expect(read("app/api/admin/rebake/route.ts")).toContain("runRebakeBatch(");
    expect(read("app/api/admin/rebake-marked/route.ts")).toContain("runRebakeBatch(");
  });

  it("refuses a missing, refused or unfetchable art and passes a resolved data URL through", async () => {
    vi.doMock("@/lib/render/art-source", () => ({
      TRANSPARENT_PIXEL_DATA_URL: "data:image/gif;base64,TRANSPARENT",
      resolveRenderableImage: async (url: string) =>
        url === "https://ok.example/art.png"
          ? "data:image/png;base64,REAL"
          : url === "https://refused.example/art.png"
            ? "data:image/gif;base64,TRANSPARENT"
            : url === "https://down.example/art.png"
              ? url
              : null,
    }));
    const { resolveBakeArt } = await import("@/lib/cards/bake-render");
    expect(await resolveBakeArt(null)).toEqual({ ok: true, artUrl: null });
    expect(await resolveBakeArt("https://ok.example/art.png")).toEqual({
      ok: true,
      artUrl: "data:image/png;base64,REAL",
    });
    for (const url of ["https://refused.example/art.png", "https://down.example/art.png", "https://gone.example/art.png"]) {
      expect((await resolveBakeArt(url)).ok, url).toBe(false);
    }
    vi.doUnmock("@/lib/render/art-source");
  });
});
