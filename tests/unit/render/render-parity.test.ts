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

  it("hands the profile's keyline to every set symbol in both renderers; the bake draws it as copies", () => {
    // Both call sites (inline in the type band, and symbolRect's box).
    expect(PREVIEW.match(/keyline=\{layout\.setSymbolKeyline\}/g)).toHaveLength(2);
    expect(BAKE.match(/keyline=\{layout\.setSymbolKeyline\}/g)).toHaveLength(2);
    expect(SET_SYMBOL).toContain("textShadow: keyline");
    // A multi-layer keyline never reaches Satori as a text-shadow (librsvg
    // keeps one layer): offset copies under the glyph.
    expect(BAKE).toContain("const copies = textShadowCopies(keyline, fontSize);");
  });

  it("sizes every set symbol from lib/cards/set-symbol-size.ts in both renderers (layout v32)", () => {
    // One size + drawn width per card, from the same helper and inputs.
    expect(PREVIEW).toContain("setSymbolSize(layout, setSymbolSource(setIconUrl, setIconCode))");
    expect(BAKE).toContain("setSymbolSize(layout, setSymbolSource(card.setIconUrl, card.setIconCode))");
    // Both call sites draw at it — the preview in cqw, the bake in whole px —
    // and the preview lays a glyph out at the table's advance, the width the
    // bake reserves for a centred type line (setSymbolDrawnPx; the bake-only
    // fontkit measure is gone).
    expect(PREVIEW.match(/size=\{cqw\(setSymbol\.sizePct\)\}/g)).toHaveLength(2);
    expect(PREVIEW.match(/width=\{cqw\(setSymbol\.drawnWidthPct\)\}/g)).toHaveLength(2);
    expect(BAKE.match(/fontSize=\{fpx\(setSymbol\.sizePct, width\)\}/g)).toHaveLength(2);
    expect(BAKE).toContain("setSymbolDrawnPx(setSymbol, width)");
    expect(BAKE).not.toContain("keyruneAdvancePx");
    // The type line's fit reserves the symbol as drawn — the same width and
    // ink start in both (fitTypeLineBand; its old path's box × 1.3 reads the
    // same box), and both pull a measured band's inline symbol by the same
    // amount (inlineSymbolPullPct) and never shrink it.
    for (const src of [PREVIEW, BAKE]) {
      expect(src).toContain("symbolWidthPct: setSymbol.drawnWidthPct,");
      expect(src).toContain("symbolInkLeftPct: setSymbol.inkLeftPct,");
      expect(src).toContain("const symbolPull = inlineSymbolPullPct(layout, setSymbol);");
    }
    expect(PREVIEW).toContain('? { flexShrink: 0, ...(symbolPull ? { marginLeft: `-${cqw(symbolPull)}` } : {}) }');
    expect(BAKE).toContain("? { flexShrink: 0, ...(symbolPull ? { marginLeft: -Math.round(symbolPull * width) } : {}) }");
    expect(PREVIEW).toContain("style={inlineSymbolStyle}");
    expect(BAKE).toContain("wrap={inlineSymbolWrap}");
    expect(read("lib/cards/render-tiers.ts")).toContain("setSymbolBoxPct(layout) * 1.3");
    // No renderer re-derives the size on its own.
    for (const src of [PREVIEW, BAKE]) expect(src).not.toMatch(/symbolSizePct \?\?/);
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

describe("text dy (TextSlot.dy, TODO 4.20)", () => {
  it("moves the front-face name and type line text — and nothing else — in both renderers", () => {
    // The preview translates by dy in cqw, the bake by the whole px: the
    // same mechanism as costDy (tests/unit/render/text-dy-bake.test.tsx
    // measures it on a real bake, the preview's twin in
    // tests/unit/components/text-dy-preview.test.tsx).
    // Both from slotTextDy (a shrunk measured line also keeps its baseline),
    // at the size each draws: the preview's fit, the bake's whole px.
    expect(PREVIEW).toContain("const dy = slotTextDy(slot, drawnSizePct);");
    expect(PREVIEW).toContain("return dy ? { transform: `translateY(${cqw(dy)})` } : {};");
    expect(BAKE).toContain("const dyPct = slotTextDy(slot, drawnSizePct);");
    expect(BAKE).toContain("const dy = dyPct ? fpx(dyPct, cardWidth) : 0;");
    expect(BAKE).toContain("return dy ? { transform: `translate(0px, ${dy}px)` } : {};");
    // The name, the type line and each half of a split type line.
    expect(PREVIEW).toContain("...textDy(layout.title, titleSizePct)");
    expect(PREVIEW.match(/\.\.\.textDy\(layout\.title\)/g)).toHaveLength(1);
    expect(PREVIEW).toContain("...textDy(layout.type, typeSizePct)");
    expect(PREVIEW.match(/\.\.\.textDy\(slot\)/g)).toHaveLength(2);
    expect(BAKE).toContain("...textDyBake(layout.title, width, titleSlot.sizePct)");
    expect(BAKE).toContain("...textDyBake(layout.type, width, typeSlot.sizePct)");
    expect(BAKE.match(/\.\.\.textDyBake\(slot, cardWidth\)/g)).toHaveLength(1);
    // Nowhere else: a second face and the adventure panel keep centring
    // their text in the rect.
    expect(PREVIEW.match(/textDy\(/g)).toHaveLength(6);
    expect(BAKE.match(/textDyBake\(/g)).toHaveLength(4);
  });
});

describe("display-font lines", () => {
  it("hand every title, type line and display footer to displayLine in both renderers", () => {
    // Satori places a word after a space at unkerned advances (TODO 4.31):
    // a single-line Beleren text must reach either renderer as one run.
    for (const src of [BAKE, PREVIEW]) {
      expect(src).not.toMatch(/>\s*\{(title|safeTitle|name|typeLine)\}\s*<\/span>/);
    }
    expect(PREVIEW).toMatch(/\{slotLine\(\s*layout\.footer\.font,\s*\w+\.artistCredit/);
    expect(PREVIEW).toContain("{slotLine(layout.footer.font, footerWatermark)}");
    // The bake's footer (FooterBake, which also draws the outline copies)
    // takes the same artist line and custom mark through slotLine.
    expect(BAKE).toMatch(/artist: card\.artistCredit\?\.trim\(\) \? `Art: \$\{card\.artistCredit\}` : "Art: Unknown"/);
    expect(BAKE).toContain("const line = slotLine(slot.font, artist);");
    expect(BAKE).toContain("const mark = watermarkText ? slotLine(slot.font, watermarkText) : null;");
    // The name: whole, or as fitted (fitTitleBand: before a detached cost,
    // and anywhere on a measured slot, TODO 4.20).
    expect(BAKE).toContain("{displayLine(titleFit ? titleFit.text : title)}");
    expect(PREVIEW).toContain("{displayLine(titleFit ? titleFit.text : safeTitle)}");
    // The type line as fitted (cut with a "…" only past the floor, the same
    // string in both): the front's, the adventure panel's, a second face's.
    expect(BAKE).toContain("{displayLine(typeText)}");
    expect(BAKE).toContain("const typeText = typeFit ? typeFit.text : typeLine;");
    expect(PREVIEW).toContain("{displayLine(typeFit.text)}");
    for (const src of [PREVIEW, BAKE]) {
      expect(src.match(/\{displayLine\(typeFit \? typeFit\.text : typeLine\)\}/g)).toHaveLength(1);
      expect(src.match(/\{displayLine\(lineSizes\.typeText\)\}/g)).toHaveLength(1);
      // The second face's name, and the adventure panel's (as fitted).
      expect(src.match(/\{displayLine\(lineSizes\.titleText\)\}/g)).toHaveLength(1);
      expect(src.match(/\{displayLine\(titleFit \? titleFit\.text : name\)\}/g)).toHaveLength(1);
      expect(src).not.toMatch(/\{displayLine\((typeLine|name)\)\}/);
    }
  });

  it("centre the bake's token title and type line on their kerned width, with no filler span", () => {
    // Satori sizes a text node unkerned and draws it kerned: a centred band
    // must hand its line to alignedText (display-line-bake.test.ts measures
    // it), and must not add the empty span + gap the preview never renders.
    // The band's per-colour ink (bandTextStyle, TODO 4.31) is spread after
    // it: colour + shadow only, so the kerned-width margin stands.
    // The title, the type line and each half of a split type line (TODO
    // 3.24; its right half centres).
    // The text's dy (TextSlot.dy, TODO 4.20) is spread last: a transform,
    // which leaves the margin alone.
    expect(BAKE.match(/style=\{\{\s*\.\.\.alignedText\(/g)).toHaveLength(3);
    expect(BAKE).toMatch(
      /\.\.\.alignedText\(band, line, fpx\(slot\.sizePct, cardWidth\), bandWidth\(band, cardWidth\)\),\n\s*\.\.\.ink,\n\s*\.\.\.textDyBake\(slot, cardWidth\),\n/,
    );
    // The name centres as it is drawn: fitted text at the fitted size.
    expect(BAKE).toMatch(
      /\.\.\.alignedText\(titleSlot, displayLine\(titleFit \? titleFit\.text : title\), fpx\(titleSlot\.sizePct, width\),[^\n]*\n\s*\.\.\.titleInk,\n/,
    );
    expect(BAKE).toMatch(/\.\.\.alignedText\(typeSlot, displayLine\(typeText\),[^\n]*\n\s*\.\.\.typeInk,\n/);
    // A measured title band with no inline cost draws no filler either
    // (layout v32): the preview has none, and the name's room is the band.
    expect(BAKE).toContain('isAligned(layout.title) || layout.title.fit === "measured" ? null : (');
    expect(BAKE).toContain("isAligned(typeSlot) ? null : (");
  });
});

describe("planeswalker ability rows", () => {
  /** A renderer's rows component, up to its closing brace. */
  const fn = (src: string, name: string) => {
    const start = src.indexOf(`function ${name}(`);
    return src.slice(start, src.indexOf("\n}\n", start));
  };
  const BAKE_ROWS = fn(BAKE, "LoyaltyRowsBake");
  const PREVIEW_ROWS = fn(PREVIEW, "LoyaltyRows");

  it("draw one row layout, one badge box and the layout's lines from lib/cards/loyalty-rows in both renderers", () => {
    // Content-sized rows (TODO 3.13): the shared layout, never equal flex rows,
    // from the one profile call (rules box, size, leading, loyalty shield).
    for (const src of [BAKE, PREVIEW]) expect(src).toContain("layoutProfileLoyaltyRows(layout, ");
    // Every row value in whole px of the renderer's target (layout v33): the
    // bake's own, the preview the HD bake's (in cqw).
    expect(BAKE_ROWS).toContain("loyaltyRowsDrawing(rowsLayout, target)");
    expect(PREVIEW_ROWS).toContain('loyaltyRowsDrawing(rowsLayout, "hd")');
    expect(PREVIEW_ROWS).toContain("height: `${rowFractions[i] * 100}%`");
    // One badge box (TODO 3.3: the preview's was 1.6 em, the bake's 1.5),
    // from LOYALTY_ROW through loyaltyRowPx — never an em literal here.
    expect(BAKE_ROWS).toContain("width: a.badgeWidth,");
    expect(BAKE_ROWS).toContain("height: a.badgeHeight,");
    expect(PREVIEW_ROWS).toContain("width: hdCqw(a.badgeWidth),");
    expect(PREVIEW_ROWS).toContain("height: hdCqw(a.badgeHeight),");
    for (const rows of [BAKE_ROWS, PREVIEW_ROWS]) {
      expect(rows).not.toMatch(/\* (1\.6|1\.5|2\.3|0\.22|0\.4)\b/);
      expect(rows).not.toContain("LOYALTY_ROW.");
      // The text starts where the rail ends; each ability's column is the
      // width its lines were broken for — the last one short of the loyalty
      // shield when it would reach it (TODO 4.19) — and they are the
      // layout's own lines, never wrapped by the renderer.
      expect(rows).toMatch(/marginRight: (hdCqw\()?a\.rail - a\.padX - a\.badgeWidth/);
      expect(rows).toMatch(/width: (hdCqw\()?draw\.text\[i\]\.column/);
      expect(rows).toMatch(/<RulesLines(Bake)? blocks=\{rowsLayout\.text\[i\]\.blocks\} metrics=\{draw\.text\[i\]\.metrics\}/);
      expect(rows).not.toContain("RulesBody");
    }
  });
});

describe("saga chapter rail (layout v33: correctness only)", () => {
  const fn = (src: string, name: string) => {
    const start = src.indexOf(`function ${name}(`);
    return src.slice(start, src.indexOf("\n}\n", start));
  };
  const BAKE_RAIL = fn(BAKE, "ChapterBake");
  const PREVIEW_RAIL = fn(PREVIEW, "ChapterRail");

  it("draws the intro and every chapter as lib/cards/saga-rail.ts's lines in both renderers, at today's anatomy", () => {
    // One layout call each (the same resolution of face_content / rules).
    for (const src of [BAKE, PREVIEW]) {
      expect(src).toContain("layoutSagaRail(layout.chapters, sagaContent.intro, sagaContent.chapters)");
    }
    expect(BAKE_RAIL).toContain("sagaRailPx(slot, target)");
    expect(PREVIEW_RAIL).toContain('sagaRailPx(slot, "hd")');
    for (const rail of [BAKE_RAIL, PREVIEW_RAIL]) {
      // Real pips, reminder italics, U+2212 — never the raw text (DOM #122
      // baked "Add {R}{R}." as literal braces).
      expect(rail).not.toMatch(/\{(ch\.text|intro|bakeText\(intro\))\}/);
      expect(rail).toMatch(/<RulesLines(Bake)? blocks=\{rail\.intro\} metrics=\{metrics\.intro\}/);
      expect(rail).toMatch(/<RulesLines(Bake)? blocks=\{ch\.blocks\} metrics=\{metrics\.chapter\}/);
      // The badge box the lines were broken beside, in both.
      expect(rail).toMatch(/width: (hdCqw\()?sagaBadgeWidthPx\(ch\.marker, px\)/);
      // Equal rows, as v32 drew them (owner decision 2026-09-28; TODO 4.21).
      expect(rail).toContain("flex: 1,");
      expect(rail).not.toMatch(/\* (0\.9|1\.7|1\.12|0\.32|0\.6|0\.82|1\.22|1\.2)\b/);
    }
  });
});

describe("the name's fit", () => {
  it("takes its text, size and width from fitTitleBand in both renderers, with the cost the band draws", () => {
    // fitTitleBand keeps fitDetachedCostTitle for every slot without the
    // measured flag (tests/unit/cards/title-band.test.ts).
    expect(PREVIEW).toContain("fitTitleBand(layout, safeTitle, showCost ? face.cost : null, orientationFromAspect(aspect))");
    expect(BAKE).toContain("fitTitleBand(layout, title, showCost ? card.cost : null, orientation)");
    expect(BAKE).toContain('const orientation: CardOrientation = layout.orientation === "landscape" ? "landscape" : "portrait";');
    expect(PREVIEW).not.toContain("fitDetachedCostTitle(");
    expect(BAKE).not.toContain("fitDetachedCostTitle(");
    // ...joined for one kerned run like every display line (displayLine).
    expect(PREVIEW).toContain("{displayLine(titleFit ? titleFit.text : safeTitle)}");
    expect(BAKE).toContain("{displayLine(titleFit ? titleFit.text : title)}");
    // A measured name the fit shrank shows at the stored HD bake's whole
    // px; the old path (modern) at its fitted size.
    expect(PREVIEW).toContain("slot={titleFit ? { ...layout.title, sizePct: titleSizePct } : layout.title}");
    expect(PREVIEW).toMatch(
      /layout\.title\.fit === "measured"\s*\? measuredLinePreviewPct\(titleFit\.sizePct, layout\.title\.sizePct, orientationFromAspect\(aspect\)\)\s*: titleFit\.sizePct;/,
    );
    expect(PREVIEW).toContain("maxWidth: cqw(titleFit.widthPct)");
    expect(BAKE).toContain("maxWidth: Math.round(titleFit.widthPct * width)");
    // The bake sets a shrunk name at the whole pixel below its fitted size.
    expect(BAKE).toContain("Math.floor(titleFit.sizePct * width) / width");
  });
});

describe("the measured fits (TODO 4.20, layout v32)", () => {
  /** A renderer's component, up to its closing brace. */
  const fn = (src: string, name: string) => {
    const start = src.indexOf(`function ${name}(`);
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  it("size, cut and cap the type line from fitTypeLineBand, with the drawn set symbol, in both renderers", () => {
    for (const src of [PREVIEW, BAKE]) {
      expect(src).not.toContain("fitSingleLineSizePct(");
      expect(src).not.toContain("fitTypeLine(");
      expect(src.match(/fitTypeLineBand\(\{/g)).toHaveLength(2); // the type band, the adventure panel
    }
    expect(PREVIEW).toMatch(
      /fitTypeLineBand\(\{\s*layout,\s*text: typeLine,\s*symbolWidthPct: setSymbol\.drawnWidthPct,\s*symbolInkLeftPct: setSymbol\.inkLeftPct,\s*orientation: orientationFromAspect\(aspect\),/,
    );
    expect(BAKE).toMatch(
      /fitTypeLineBand\(\{\s*layout,\s*text: typeLine,\s*symbolWidthPct: setSymbol\.drawnWidthPct,\s*symbolInkLeftPct: setSymbol\.inkLeftPct,\s*orientation,/,
    );
    // The span's max-width is the fit's room in both.
    expect(PREVIEW).toContain("...(typeFit.widthPct !== null ? { maxWidth: cqw(typeFit.widthPct) } : {}),");
    expect(BAKE).toContain("...(typeFit?.widthPct != null ? { maxWidth: Math.round(typeFit.widthPct * width) } : {}),");
    // A measured line that shrank is set at measuredLinePx: the whole pixel
    // below its fit, never below the floor's.
    expect(BAKE).toContain(
      "typeMeasured && typeFitPct < layout.type.sizePct\n        ? measuredLinePx(typeFitPct, layout.type.sizePct, width, orientation) / width",
    );
    expect(BAKE).toContain('? measuredLinePx(titleFit.sizePct, layout.title.sizePct, width, orientation) / width');
  });

  it("fit the adventure panel's name before its cost and its type line to its bar, in both renderers", () => {
    const panel = fn(PREVIEW, "AdventurePanel");
    const bake = fn(BAKE, "AdventureBake");
    for (const src of [panel, bake]) {
      expect(src).toMatch(/fitTitleBand\(\s*\{ title: slot\.title, costSizePct: slot\.costSizePct \},\s*name,\s*showCost \? \w+\.cost : null,\s*\)/);
      expect(src).toContain('slot.type.fit === "measured"');
      expect(src).toContain("fitTypeLineBand({ layout: { type: slot.type }, text: typeLine, symbolWidthPct: null })");
      // The pips keep the panel's disc whatever the name does.
      expect(src).toMatch(/\(slot\.costSizePct \?\? slot\.title\.sizePct/);
    }
    expect(panel).toContain("maxWidth: cqw(titleFit.widthPct)");
    expect(bake).toContain("maxWidth: Math.round(titleFit.widthPct * cardWidth)");
    expect(bake).toContain("measuredLinePx(fitted, base, cardWidth) / cardWidth");
    expect(panel).toContain("maxWidth: cqw(typeFit.widthPct)");
    expect(bake).toContain("maxWidth: Math.round(typeFit.widthPct * cardWidth)");
  });

  it("floor a second face at the card's own orientation, and gap its name and cost only when it prints one", () => {
    const panel = fn(PREVIEW, "SecondFacePanel");
    const bake = fn(BAKE, "SecondFaceBake");
    expect(panel).toContain("orientation: orientationFromAspect(aspect),");
    expect(bake).toContain("const orientation = orientationFromAspect(aspect);");
    // A `fitLines` face's shrunk lines at measuredLinePx in the bake.
    expect(bake).toContain("slot.fitLines ? measuredLinePx(fitted, base, cardWidth, orientation) : fpx(fitted, cardWidth)");
    expect(bake).toContain("fontSize: linePx(lineSizes.titleSizePct, slot.title.sizePct),");
    expect(bake).toContain("fontSize: linePx(lineSizes.typeSizePct, slot.type.sizePct),");
    // The preview draws the name alone when there is no cost; the bake's
    // filler span must not take a gap from it.
    expect(bake).toContain("...(slot.fitLines && showCost ? { gap: fpx(NAME_COST_GAP_PCT, cardWidth) } : {}),");
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

describe("edge-to-edge and full-art pieces (TODO 3.23 / 3.24)", () => {
  it("resolve from the same shared helpers in both renderers", () => {
    // The basic-land symbol slot, the footer on the art and the split type
    // line all come from lib/ — the renderers only draw them.
    expect(BAKE).toContain("basicSymbolFor(layout, basicLandFace, card.watermark)");
    expect(PREVIEW).toContain("basicSymbolFor(layout, basicLandFace, face.watermark)");
    expect(BAKE).toContain("footerInk(layout.footer, masterKey, layout)");
    expect(PREVIEW).toContain("footerInk(layout.footer, masterKey, layout)");
    for (const src of [BAKE, PREVIEW]) {
      expect(src).toContain("layout.type.split ? splitTypeLine(typeLine) : null");
      expect(src).toContain("fitSplitTypeSizePct({");
      expect(src).toContain("basicSymbolBox(plan.slot.rect");
      expect(src).toContain("BRAND_MARK_PILL.padXPct * scale");
      // A slot or a textless frame suppresses the rules-box watermark; a
      // textless frame skips the rules layout and every rules layer.
      expect(src).toMatch(/effectiveWatermark &&\s*!textless &&\s*!basicSymbolPlan &&/);
      expect(src).toMatch(/const drawsRulesBox =\s*!textless &&/);
      expect(src).toMatch(/\{textless \? null : layout\.type\.split && typeSplit \?/);
    }
  });

  it("paint the disc under the frame and the symbol above it (the bake paints in DOM order)", () => {
    const disc = BAKE.indexOf("BasicSymbolDiscBake({ plan: basicSymbolPlan");
    const frame = BAKE.indexOf("src={frameDataUrl}");
    const symbol = BAKE.indexOf("BasicSymbolBake({\n            plan: basicSymbolPlan");
    expect(disc).toBeGreaterThan(0);
    expect(disc).toBeLessThan(frame);
    expect(symbol).toBeGreaterThan(frame);
    // The preview's z-order: art 0 < disc 1 < frame 5 < symbol 10.
    expect(PREVIEW).toMatch(/data-testid="basic-symbol-disc"[\s\S]{0,200}zIndex: 1,/);
    expect(PREVIEW).toMatch(/data-testid="basic-symbol"\n[\s\S]{0,200}zIndex: 10,/);
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
    // Our card-art bucket (the legacy project host is always ours), so the
    // media guard (0127) lets each through to the fetch.
    const art = (name: string) =>
      `https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-art/11111111-1111-4111-8111-111111111111/${name}.png`;
    const fetched: string[] = [];
    vi.doMock("@/lib/render/art-source", () => ({
      TRANSPARENT_PIXEL_DATA_URL: "data:image/gif;base64,TRANSPARENT",
      resolveRenderableImage: async (url: string) => {
        fetched.push(url);
        return url === art("ok")
          ? "data:image/png;base64,REAL"
          : url === art("refused")
            ? "data:image/gif;base64,TRANSPARENT"
            : url === art("down")
              ? url
              : null;
      },
    }));
    const { resolveBakeArt } = await import("@/lib/cards/bake-render");
    expect(await resolveBakeArt(null)).toEqual({ ok: true, artUrl: null });
    expect(await resolveBakeArt(art("ok"))).toEqual({
      ok: true,
      artUrl: "data:image/png;base64,REAL",
    });
    for (const url of [art("refused"), art("down"), art("gone")]) {
      expect((await resolveBakeArt(url)).ok, url).toBe(false);
    }
    // Art the live preview won't draw (migration 0127: an outside host,
    // Scryfall, another bucket) is refused before any fetch — never baked
    // art-less, never fetched.
    fetched.length = 0;
    for (const url of [
      "https://ok.example/art.png",
      "https://cards.scryfall.io/art_crop/front/1/2/x.jpg",
      "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/profile-media/11111111-1111-4111-8111-111111111111/a.png",
    ]) {
      expect(await resolveBakeArt(url), url).toMatchObject({ ok: false });
    }
    expect(fetched).toEqual([]);
    vi.doUnmock("@/lib/render/art-source");
  });
});

describe("rules text (layout v33, TODO 3.29)", () => {
  /** A renderer's component, up to its closing brace. */
  const fn = (src: string, name: string) => {
    const start = src.indexOf(`function ${name}(`);
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  it("lay every rules box out through lib/cards/rules-box.ts, clear of the same drawn badges", () => {
    for (const src of [BAKE, PREVIEW]) {
      // The main box, the adventure page and a second face: one layout each.
      expect(src).toMatch(/mainRulesLayout\(\{/);
      expect(src).toMatch(/adventureRulesLayout\(\{/);
      expect(src).toMatch(/secondFaceRulesLayout\(\{/);
      // Every drawn stat badge, gated as the renderer draws it.
      expect(src).toMatch(/pt: showPT,\s*loyalty: showLoyalty,\s*defense: showDefense,\s*secondFacePt: Boolean\(layout\.secondFace\?\.pt/);
      // The old estimate, its walker fit rect and the wrapping flavor block
      // are gone.
      expect(src).not.toContain("fitRulesSizePct");
      expect(src).not.toContain("fitRect");
      expect(src).not.toMatch(/function Flavor(Block|Bake)\(/);
    }
  });

  it("draw the layout's lines — never wrap them — in both renderers", () => {
    const bake = fn(BAKE, "RulesBoxBake") + fn(BAKE, "RulesBoxLineBake");
    const preview = fn(PREVIEW, "RulesBox") + fn(PREVIEW, "RulesBoxLine");
    // The bake at its own target (the 750 px or the HD bake), the preview at
    // the HD bake's px in cqw.
    expect(bake).toContain("rulesDraw(layout, target)");
    expect(BAKE).toContain("rulesTargetFor(width, orientation)");
    expect(preview).toContain('rulesDraw(layout, "hd")');
    expect(preview).toContain("cqw(px / RULES_HD_WIDTH[layout.orientation])");
    for (const src of [bake, preview]) {
      expect(src).toContain('flexWrap: "nowrap"');
      expect(src).toContain('whiteSpace: "nowrap"');
      expect(src).toContain("flexShrink: 0");
      expect(src).toContain("rulesWordText(item.v)");
      // Word gaps are margins after the first run, never a container gap.
      expect(src).toMatch(/ri > 0 \? \{ marginLeft: /);
      expect(src).not.toMatch(/\bgap:/);
      expect(src).not.toContain('flexWrap: "wrap"');
    }
    // Each word's line height is its line box.
    expect(bake).toContain("lineHeight: d.lineHeight");
    expect(preview).toContain("lineHeight: hd(d.linePx)");
  });
});

describe("rules-box backdrop", () => {
  it("is drawn by ONE rule in both renderers (drawsRulesBackdrop — 4.33's empty walker window)", () => {
    for (const src of [BAKE, PREVIEW]) {
      expect(src).toContain('import { drawsRulesBackdrop } from "@/lib/cards/rules-backdrop";');
      expect(src.match(/drawsRulesBackdrop\(layout\.rules, \{/g)).toHaveLength(1);
      // The old inline condition (text only) is gone from both.
      expect(src).not.toMatch(/layout\.rules\.backdropHex &&\s*hasRulesContent &&/);
    }
    // Neither draws it under ability rows; the preview's hint rows count as rows.
    expect(BAKE).toContain("rowsDrawn: Boolean(layout.loyaltyRows) && loyaltyAbilities.length > 0,");
    expect(PREVIEW).toContain(
      "rowsDrawn: Boolean(layout.loyaltyRows) && (loyaltyAbilities.length > 0 || hintRowsLayout !== null),",
    );
  });
});
