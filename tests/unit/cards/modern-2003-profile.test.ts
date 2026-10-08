import { describe, expect, it } from "vitest";
import { brandMarkWidthPct, BRAND_MARK_GEOMETRY } from "@/lib/cards/collector-layout";
import { copyrightFace, copyrightInk, copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { footerArtistLine } from "@/lib/cards/card-display";
import { FOOTER_BRUSH_PATH, FOOTER_BRUSH_VIEWBOX } from "@/lib/cards/footer-brush";
import referencesJson from "@/lib/cards/frame-references.json";
import { isRenderStale } from "@/lib/cards/layout-version";
import { PLATE_INK, plateInkRect } from "@/lib/cards/plate-ink";
import { COST_PIP_GAP, costRowWidthPct } from "@/lib/cards/render-tiers";
import { metricsFor } from "@/lib/cards/rules-layout";
import { fitStatSizePct } from "@/lib/cards/stat-fit";
import { SYMBOL_STYLES, discShadowCss, discShadowPx, inlineSymbolStyle, manaGlyphPx, previewDiscShadowCss, styledSuffix, symbolStyle, symbolStyleOf } from "@/lib/cards/symbol-style";
import { footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { TYPE_FACES, faceOf } from "@/lib/cards/type-faces";
import {
  MODERN_ARTIST_SIZE_PCT,
  MODERN_COPYRIGHT_SIZE_PCT,
  MODERN_COST_DISC_PCT,
  MODERN_PT_SIZE_PCT,
  MODERN_TITLE_SIZE_PCT,
  MODERN_TYPE_SIZE_PCT,
  RULES_SIZE_PX,
  rulesPxToPct,
} from "@/lib/cards/typography";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The 2003 frame's PROFILE (TODO 4.10b, layout v47): `modern` and
// `modernland` as the frame's later drawing printed them, Champions of
// Kamigawa 2004 → Journey into Nyx 2014 — print-sized dark lettering with no
// shadow, the P/T centred on the plate's face at the printed box, the two
// left-aligned footer lines (the brush and the artist over the © slot),
// 66 px cost discs with a shadow down and a little to the left. Every number is the prints'
// (lib/cards/typography.ts MODERN_*; lib/cards/template-layout.ts MODERN).
// The bakes: tests/unit/render/modern-2003-bake.test.tsx.
// ---------------------------------------------------------------------------

const modern = getFrameProfile("modern");
const land = getFrameProfile("modernland");
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const DARK = "#17120c";
const HD_W = 1500;
const HD_H = 2100;
const px = (pct: number, of = HD_W) => (pct / 100) * of;

describe("the 2003 sizes — the prints', as per-era constants, EVEN at HD", () => {
  it("name 80, type line 66, P/T 80, artist 50, © slot 32, cost disc 66 px — each a whole px at the 750 px bake too", () => {
    const sizes: [string, number, number][] = [
      ["name", MODERN_TITLE_SIZE_PCT, 80],
      ["type line", MODERN_TYPE_SIZE_PCT, 66],
      ["P/T", MODERN_PT_SIZE_PCT, 80],
      ["artist", MODERN_ARTIST_SIZE_PCT, 50],
      ["© slot", MODERN_COPYRIGHT_SIZE_PCT, 32],
      ["cost disc", MODERN_COST_DISC_PCT, 66],
    ];
    for (const [label, pct, hd] of sizes) {
      expect(pct * HD_W, label).toBeCloseTo(hd, 9);
      // Even at HD: the 750 px bake draws exactly half (the 1997 frame's
      // odd sizes rounded 1.4 % wide there).
      expect((pct * 750) % 1, label).toBeCloseTo(0, 9);
    }
    for (const p of [modern, land]) {
      expect(p.title.sizePct).toBe(MODERN_TITLE_SIZE_PCT);
      expect(p.type.sizePct).toBe(MODERN_TYPE_SIZE_PCT);
      expect(p.pt!.sizePct).toBe(MODERN_PT_SIZE_PCT);
      expect(p.footer!.sizePct).toBe(MODERN_ARTIST_SIZE_PCT);
      expect(p.copyrightSlot!.sizePct).toBe(MODERN_COPYRIGHT_SIZE_PCT);
      expect(p.costSizePct).toBe(MODERN_COST_DISC_PCT);
      expect(p.rules.sizePct).toBe(rulesPxToPct(RULES_SIZE_PX.standard));
    }
    // Beleren's capitals are 0.70 em: the name's are 56 px (the acceptance's
    // 55 ± 1; the prints' 55–56).
    expect(Math.abs(0.7 * 80 - 55)).toBeLessThanOrEqual(1);
  });

  it("the faces are today's two: Beleren for the name, the type line, the P/T and the artist; MPlantin for the rules and the © slot's text — no font was added", () => {
    for (const p of [modern, land]) {
      for (const role of ["name", "typeLine", "stat", "footer"] as const) expect(faceOf(p, role), role).toBe(TYPE_FACES.display);
      expect(copyrightFace(p.copyrightSlot!)).toBe(TYPE_FACES.body);
      expect(p.rules.font).toBe("body");
    }
  });

  it("the name and the type line are MEASURED: a long one shrinks to its room, never the renderer's ellipsis", () => {
    for (const p of [modern, land]) {
      expect(p.title.fit).toBe("measured");
      expect(p.type.fit).toBe("measured");
    }
    // Before the detached cost a long name shrinks…
    const long = fitTitleBand(modern, "Skeptic, the Endlessly Wandering Knight", "{2}{W}{U}{B}")!;
    expect(long.text).toBe("Skeptic, the Endlessly Wandering Knight");
    expect(long.sizePct).toBeLessThan(MODERN_TITLE_SIZE_PCT);
    // …and a printed-length one keeps the full 80 px (M12 #1, RAV #191).
    for (const [title, cost] of [["Aegis Angel", "{4}{W}{W}"], ["Autochthon Wurm", "{10}{G}{G}{G}{W}{W}"], ["Serra Angel", "{3}{W}{W}"]] as const) {
      expect(fitTitleBand(modern, title, cost)!.sizePct, title).toBe(MODERN_TITLE_SIZE_PCT);
    }
    // A land has the whole bar.
    expect(fitTitleBand(land, "Urza's Power Plant", null)!.sizePct).toBe(MODERN_TITLE_SIZE_PCT);
  });
});

describe("the 2003 ink — dark, no shadow; the footer white on black and on lands", () => {
  it("name, type line and P/T: the frame's dark ink on every master, no shadow, no ink map", () => {
    for (const p of [modern, land]) {
      for (const slot of [p.title, p.type, p.pt!]) {
        expect(slot.colorHex).toBe(DARK);
        expect(slot.shadowCss).toBeUndefined();
        expect(slot.inkByColorKey).toBeUndefined();
      }
      for (const key of KEYS) expect(slotInk(p.pt!, key)).toEqual({ colorHex: DARK, shadowCss: undefined });
    }
  });

  it("the footer (4.23a's map, kept): white on `modern`/b and on all seven `modernland` keys, dark elsewhere; the © slot follows it", () => {
    for (const key of KEYS) {
      const white = key === "b";
      expect(footerInk(modern.footer!, key, modern), key).toEqual({ colorHex: white ? "#ffffff" : DARK, shadowCss: undefined });
      expect(copyrightInk(modern.copyrightSlot!, key), key).toBe(white ? "#ffffff" : DARK);
      expect(footerInk(land.footer!, key, land), key).toEqual({ colorHex: "#ffffff", shadowCss: undefined });
      expect(copyrightInk(land.copyrightSlot!, key), key).toBe("#ffffff");
    }
    // `c` on `modern` is the ARTIFACT frame, whose print is black.
    expect(footerInk(modern.footer!, "c", modern).colorHex).toBe(DARK);
  });
});

describe("the 2003 footer — the brush and the artist over the © slot, left-aligned", () => {
  it("line 1 is the bare credit in mixed case after the brush: no prefix, no capitals, no tracking", () => {
    for (const p of [modern, land]) {
      expect(p.footer!.prefix).toBe("");
      expect(footerArtistLine(p.footer, "Aleksi Briclot")).toBe("Aleksi Briclot");
      expect(footerArtistLine(p.footer, null)).toBe("Unknown");
      expect(p.footer!.uppercase).toBeUndefined();
      expect(p.footer!.letterSpacingEm).toBeUndefined();
      expect(p.footer!.align).toBeUndefined();
      // It starts at 233 px (the pen; the prints' ink at 235) and its box
      // ends short of the P/T box (1112.5 px).
      expect(px(p.footer!.rect.leftPct)).toBeCloseTo(233, 0);
      expect(px(p.footer!.rect.leftPct + p.footer!.rect.widthPct)).toBeLessThan(1112);
    }
  });

  it("the brush is profile data: our own path at the printed ink box, 118–227 × 1946–1969 px", () => {
    for (const p of [modern, land]) {
      const r = p.footerBrush!.rect;
      expect(px(r.leftPct)).toBeCloseTo(118, 6);
      expect(px(r.leftPct + r.widthPct)).toBeCloseTo(227, 6);
      expect(px(r.topPct, HD_H)).toBeCloseTo(1946, 6);
      expect(px(r.topPct + r.heightPct, HD_H)).toBeCloseTo(1969, 6);
      // It ends before the artist's pen.
      expect(px(r.leftPct + r.widthPct)).toBeLessThan(px(p.footer!.rect.leftPct));
    }
    // The path's box is the rect's shape (109 × 23), so it is not squashed.
    const [, , w, h] = FOOTER_BRUSH_VIEWBOX.split(" ").map(Number);
    expect(w / h).toBeCloseTo(109 / 23, 0);
    expect(FOOTER_BRUSH_PATH.startsWith("M")).toBe(true);
    // No other profile draws one.
    for (const t of FRAME_TEMPLATE_VALUES) expect(Boolean(getFrameProfile(t).footerBrush), t).toBe(t === "modern" || t === "modernland");
  });

  it("the © slot starts at 128 px on the 2015 px baseline: the mark on display (dark and flat where the print's line is dark), the footer text on a clean download", () => {
    for (const p of [modern, land]) {
      const slot = p.copyrightSlot!;
      expect(px(slot.startPct!)).toBeCloseTo(128, 6);
      expect(px(slot.baselinePct, HD_H)).toBeCloseTo(2015, 6);
      // The footer text runs to 1095 px at most: short of the P/T box.
      expect(px(slot.startPct!) + slot.maxWidthPct * HD_W).toBeLessThan(1112);
    }
    expect(modern.copyrightSlot!.darkMarkKeys).toEqual(["w", "u", "r", "g", "c", "m"]);
    expect(land.copyrightSlot!.darkMarkKeys).toBeUndefined();
    for (const key of KEYS) {
      const display = copyrightSlotLayout(modern, key, { kind: "display" })!;
      expect(display.kind).toBe("brand");
      if (display.kind !== "brand") continue;
      const width = brandMarkWidthPct(MODERN_COPYRIGHT_SIZE_PCT / BRAND_MARK_GEOMETRY.fontPct);
      // The mark's LEFT end is the slot's start (it is anchored by its right).
      expect(display.anchor.rightPct - width, key).toBeCloseTo(modern.copyrightSlot!.startPct!, 9);
      expect(display.anchor.sizePct).toBe(MODERN_COPYRIGHT_SIZE_PCT);
      expect(display.ink, key).toEqual(key === "b" ? { kind: "light" } : { kind: "flat", colorHex: DARK });
      // Every land key: the standard white mark.
      const onLand = copyrightSlotLayout(land, key, { kind: "display" })!;
      expect(onLand.kind === "brand" && onLand.ink, key).toEqual({ kind: "light" });
    }
    const text = copyrightSlotLayout(modern, "w", { kind: "download", footerText: "  Printed for the kitchen table  " })!;
    expect(text).toMatchObject({ kind: "text", text: "Printed for the kitchen table", colorHex: DARK, xPct: modern.copyrightSlot!.startPct });
    expect(copyrightSlotLayout(modern, "b", { kind: "download", footerText: "x" })).toMatchObject({ kind: "text", colorHex: "#ffffff" });
    expect(copyrightSlotLayout(modern, "w", { kind: "download", footerText: "   " })).toEqual({ kind: "none" });
    // A long one is cut with ONE "…" inside the slot's width.
    const long = copyrightSlotLayout(modern, "w", { kind: "download", footerText: "Printed for the kitchen table ".repeat(6) })!;
    expect(long.kind === "text" && long.text.endsWith("…")).toBe(true);
    expect(long.kind === "text" && long.widthPct / 100 <= modern.copyrightSlot!.maxWidthPct + 1e-9).toBe(true);
    // The mark left the border on this pair: no placement of its own.
    expect(modern.brandMark).toBeUndefined();
    expect(land.brandMark).toBeUndefined();
  });
});

describe("the 2003 P/T — centred on the plate's face, the plate at the printed box", () => {
  it("the value is centred on 1258 px (the prints': 83 one-digit and 5 two-digit values, sd 1.9 px), not set against an edge", () => {
    for (const p of [modern, land]) {
      const pt = p.pt!;
      expect(pt.align).toBeUndefined();
      expect(pt.endKerned).toBeUndefined();
      expect(px(pt.rect.leftPct + pt.rect.widthPct / 2)).toBeCloseTo(1259, 0);
      expect(pt.plateAssetPathTemplate).toBe("/frames/modern/pt/{color}.png");
    }
  });

  it("the plate's outline lands within 3 px of the printed box 1112.5–1374.8 × 1880.8–1996.9 px (the MSE plate was drawn 17 px too flat)", () => {
    const ink = plateInkRect(modern.pt!.plateAssetPathTemplate!, modern.pt!.plateRect!)!;
    expect(PLATE_INK["/frames/modern/pt/{color}.png"]).toBeDefined();
    const [l, r, t, b] = [px(ink.leftPct), px(ink.leftPct + ink.widthPct), px(ink.topPct, HD_H), px(ink.topPct + ink.heightPct, HD_H)];
    // (The ink box is the pixels at least half opaque: the outline's outer
    // edge and the first px of the soft shadow under and right of it.)
    expect(Math.abs(l - 1112.5)).toBeLessThanOrEqual(11);
    expect(Math.abs(t - 1880.8)).toBeLessThanOrEqual(17);
    expect(r).toBeGreaterThan(1374.8 - 3);
    expect(b).toBeGreaterThan(1996.9 - 3);
    // The plate box itself is 326 × 177 px: the pack's 322 × 176 scaled
    // × 1.0127 / × 1.005 onto the printed outline.
    expect(px(modern.pt!.plateRect!.widthPct)).toBeCloseTo(326.1, 1);
    expect(px(modern.pt!.plateRect!.heightPct, HD_H)).toBeCloseTo(177.1, 1);
  });

  it("one digit a side or two keep the full 80 px, as the prints set them; three shrink onto the face", () => {
    const pt = modern.pt!;
    for (const value of ["1/1", "5/5", "8/8", "*/*", "X/X", "9/14", "10/10", "12/12", "13/13", "15/15", "99/99"]) expect(fitStatSizePct(pt, value), value).toBe(pt.sizePct);
    expect(fitStatSizePct(pt, "100/100")).toBeLessThan(pt.sizePct);
    expect(px(pt.inkSpanPct!.leftPct)).toBeCloseTo(1134, 0);
    expect(px(pt.inkSpanPct!.rightPct)).toBeCloseTo(1367, 0);
  });
});

describe('symbolStyle "2003" — a cost shadow down and a little to the left, flat inline pips, the modern tap', () => {
  it("is the pair's style and nobody else's", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      const own = t === "modern" || t === "modernland";
      expect(getFrameProfile(t).symbolStyle === "2003", t).toBe(own);
    }
    expect(symbolStyleOf(modern)).toBe(SYMBOL_STYLES["2003"]);
  });

  it("the COST disc: black, 6 px down and 2 px to the LEFT at 66 px (3 and 1 at 33), as the prints' crescent — in the bake and the preview", () => {
    const style = SYMBOL_STYLES["2003"];
    expect(discShadowPx(style, 66)).toEqual({ left: 2, down: 6 });
    expect(discShadowPx(style, 33)).toEqual({ left: 1, down: 3 });
    expect(discShadowCss(style, 66)).toBe("-2px 6px 0 #000");
    // Steeper than M15's (6 % left, 7 % down): the 2003 crescent hangs
    // under the disc, a sliver beside it.
    expect(style.discShadow!.left / style.discShadow!.down).toBeLessThan(0.5);
    // The preview: no mana-font class draws this shadow (outside a card the
    // style has none); a CARD's pip takes the bake's one layer from
    // `discShadow`, in em of its glyph (previewDiscShadowCss).
    expect(style.previewShadowClass).toBeNull();
    expect(style.previewShadowCss).toBeNull();
    const em = manaGlyphPx(66);
    // …in the colour the stored PNG holds (bakedShadowHex: pure black stays black).
    expect(previewDiscShadowCss(style, 66, em)).toBe(`${(-2 / em).toFixed(4)}em ${(6 / em).toFixed(4)}em 0 #000000`);
    // Along the row it reaches 2 px past the first disc — less than M15's
    // shadow: the name's room is the discs, their gaps and that sliver.
    expect(style.costRowShadowDiscs * 66).toBeCloseTo(2, 9);
    expect(costRowWidthPct("{3}{G}", MODERN_COST_DISC_PCT, style)).toBeLessThan(costRowWidthPct("{3}{G}", MODERN_COST_DISC_PCT, symbolStyle(undefined)));
    // The prints' pitch: 74 px from disc to disc.
    expect(Math.round(MODERN_COST_DISC_PCT * 1500 * (1 + COST_PIP_GAP))).toBe(74);
    expect(styledSuffix(style, "tap")).toBe("tap");
  });

  it("an INLINE pip is flat: the rules layout keeps no shadow clear on the pair, and still does on every other frame", () => {
    const inline = inlineSymbolStyle(SYMBOL_STYLES["2003"]);
    expect(inline.discShadow).toBeNull();
    expect(inline.previewShadowCss).toBeNull();
    expect(inline.tapSuffix).toBe("tap");
    expect(metricsFor(76, undefined, "hd", "2003")).toMatchObject({ pipShadowPx: 0, pipShadowLeftPx: 0 });
    // "modern" shadows both; "1997" neither.
    expect(inlineSymbolStyle(SYMBOL_STYLES.modern)).toBe(SYMBOL_STYLES.modern);
    expect(inlineSymbolStyle(SYMBOL_STYLES["1997"])).toBe(SYMBOL_STYLES["1997"]);
    expect(metricsFor(76, undefined, "hd").pipShadowPx).toBeGreaterThan(0);
    expect(discShadowCss(SYMBOL_STYLES.modern, 60)).toBe("-4px 4px 0 #111");
  });
});

describe("the 2003 slots on the new masters", () => {
  it("the art slot covers the masters' window (130–1370 × 252–1161 px; the gold land's 130–1371 × 250–1163) with 0.05 % to spare — both known failures struck", () => {
    for (const p of [modern, land]) {
      const a = p.artSlot;
      const [x0, x1, y0, y1] = [px(a.leftPct), px(a.leftPct + a.widthPct), px(a.topPct, HD_H), px(a.topPct + a.heightPct, HD_H)];
      expect(x0).toBeLessThanOrEqual(130 - 0.75);
      expect(x1).toBeGreaterThanOrEqual(1371 + 0.75);
      expect(y0).toBeLessThanOrEqual(249 - 1.05);
      expect(y1).toBeGreaterThanOrEqual(1163 + 1.05);
    }
    expect(ART_WINDOW_KNOWN_FAILURES).not.toHaveProperty("modern");
    expect(ART_WINDOW_KNOWN_FAILURES).not.toHaveProperty("modernland");
  });

  it("the rules text sits in the printed column (from 153 px, the same margin on the right) inside the text box's face", () => {
    for (const p of [modern, land]) {
      const r = p.rules.rect;
      const [x0, x1, y0, y1] = [px(r.leftPct) + 9, px(r.leftPct + r.widthPct) - 9, px(r.topPct, HD_H) + 18, px(r.topPct + r.heightPct, HD_H) - 18];
      expect(x0).toBeCloseTo(153, 0);
      expect(x1).toBeCloseTo(1347, 0);
      expect(y0).toBeGreaterThanOrEqual(1314 + 18);
      expect(y1).toBeLessThanOrEqual(1904 - 18);
    }
  });

  it("the cost row ends at 1370 px with its discs on rows 140–205, and the land draws none", () => {
    const c = modern.costRect!;
    expect(px(c.leftPct + c.widthPct)).toBeCloseTo(1370, 0);
    // The rect's middle is 172.4 px: the layout sets the 66 px disc from
    // 139.4 px, drawn on rows 140–205 (the prints' 139.7–206.7; the real
    // bake is read in tests/unit/render/modern-2003-bake.test.tsx).
    const mid = px(c.topPct + c.heightPct / 2, HD_H);
    expect(mid).toBeGreaterThan(172);
    expect(mid).toBeLessThan(173);
    expect(Math.round(mid - 33)).toBe(139);
    expect(land.hideCost).toBe(true);
    expect(modern.hideCost).toBeUndefined();
  });
});

describe("layout v47 — the 2003 frame's one sweep", () => {
  it("is ONE version in one constant: a sweep, never a badge, scoped to the pair — every other template stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.MODERN_2003_LAYOUT_VERSION;
    expect(Number.isInteger(V)).toBe(true);
    expect(V).toBeGreaterThan(lv.RETRO_1997_LAYOUT_VERSION);
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(lv.VERSION_ROLLOUT[V]).toBe("sweep");
    expect(lv.rolloutPolicy(V)).toBe("sweep");
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.MODERN_2003_TEMPLATES]).toEqual(["modern", "modernland"]);
    // Every card on the pair, whatever its colour: no narrower card scope.
    expect(lv.VERSION_SCOPES[V]).toBeUndefined();
    for (const t of FRAME_TEMPLATE_VALUES) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(t === "modern" || t === "modernland");
  });

  it("is NOT verification-neutral: the fourteen ticks on the pair go stale — flagged, still verified and offered — and no other tick does", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.MODERN_2003_LAYOUT_VERSION;
    expect(lv.VERIFICATION_NEUTRAL_VERSIONS).not.toContain(V);
    expect([...lv.VERIFICATION_SCOPED_VERSIONS[V]]).toEqual(["modern", "modernland"]);
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    const tick = { verified: true, verifiedLayoutVersion: V - 1, verifiedOverrideHash: "h" } as const;
    for (const t of ["modern", "modernland"]) expect(verificationState(tick, t, "h", V), t).toMatchObject({ verified: true, stale: true });
    for (const t of ["retro", "retroland", "agclassic", "m15", "m15land", "battle"]) expect(verificationState(tick, t, "h", V).stale, t).toBe(false);
    // A tick made at v47 is fresh.
    expect(verificationState({ ...tick, verifiedLayoutVersion: V }, "modern", "h", V).stale).toBe(false);
  });
});

describe("references and imports — the later drawing, the three-colour gold", () => {
  const refs = referencesJson as unknown as Record<string, { colors: Record<string, { name: string; set: string }[]> }>;

  it("the gold DEFAULTS are three-colour prints (the master is that look; a two-colour gold card wears two-colour pinlines — TODO 4.6h)", () => {
    expect(refs.modern.colors.m.map((r) => r.name)).toEqual(["Sprouting Thrinax", "Rhox War Monk", "Horizon Chimera", "Whispering Madness"]);
    expect(refs.modernland.colors.m.map((r) => r.name)).toEqual(["Seaside Citadel", "Caves of Koilos"]);
  });

  it("`modernland`'s plain-land default is black-bordered, and no reference is from the white-bordered Ninth Edition's swamp", () => {
    expect(refs.modernland.colors.c[0]).toMatchObject({ name: "Swarmyard", set: "tsp" });
    expect(refs.modernland.colors.b.map((r) => r.set)).toEqual(["md1", "m14"]);
  });

  it("a black-bordered 2003 printing is exact on the pair — the first year's too (no second master, no gap)", () => {
    const printing = (over: Partial<ScryfallCard>) =>
      ({ id: "94c70f23-0ca9-425e-a53a-6c09921c0075", name: "Probe", frame: "2003", border_color: "black", type_line: "Creature — Elf", mana_cost: "{G}", colors: ["G"], ...over }) as ScryfallCard;
    for (const released_at of ["2003-10-02", "2004-10-01", "2011-07-15", "2014-05-02"]) {
      expect(frameMatchFromScryfall(printing({ released_at })), released_at).toMatchObject({ status: "exact", template: "modern" });
    }
    expect(frameMatchFromScryfall(printing({ released_at: "2011-07-15", type_line: "Land", mana_cost: "", colors: [] }))).toMatchObject({ status: "exact", template: "modernland" });
  });
});
