import { describe, expect, it } from "vitest";
import { BRAND_MARK_GEOMETRY, brandMarkWidthPct } from "@/lib/cards/collector-layout";
import { copyrightFace, copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { footerArtistLine } from "@/lib/cards/card-display";
import { isRenderStale } from "@/lib/cards/layout-version";
import { drawsManaGem, manaGemSpec, symbolImagePathsIn } from "@/lib/cards/mana-gem";
import { COST_PIP_GAP, costRowHdPx, costRowWidthPct } from "@/lib/cards/render-tiers";
import { metricsFor } from "@/lib/cards/rules-layout";
import { fitStatSizePct, statWidthEm } from "@/lib/cards/stat-fit";
import {
  DEFAULT_COST_GAP_DISCS,
  ORIGINAL_COST_GAP_PX,
  ORIGINAL_DISC_PX,
  ORIGINAL_SYMBOL_FOLDER,
  ORIGINAL_SYMBOL_LETTERS,
  SYMBOL_STYLES,
  costPipGap,
  costPipGapPx,
  discShadowCss,
  inlineSymbolStyle,
  originalSymbolPath,
  styledSuffix,
  symbolImagePath,
  symbolStyleOf,
} from "@/lib/cards/symbol-style";
import { footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { faceOf } from "@/lib/cards/type-faces";
import {
  ALPHA_ARTIST_SIZE_PCT,
  ALPHA_COPYRIGHT_SIZE_PCT,
  ALPHA_COST_DISC_PCT,
  ALPHA_PT_SIZE_PCT,
  ALPHA_TITLE_SIZE_PCT,
  ALPHA_TYPE_SIZE_PCT,
  RULES_SIZE_PX,
  rulesPxToPct,
} from "@/lib/cards/typography";
import manifestJson from "@/lib/frames/frame-manifest.json";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { ALPHA_TWO_LINE_FOOTER_FROM } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The 1993 frame's PROFILE (TODO 4.10c, layout v48): `agclassic` and
// `alphaland` at the sizes, faces and rows of the Alpha / Beta prints (proof
// 3, 118 scans): name Beleren 72 px, type line MPlantin 70, the printed
// `Illus.` credit MPlantin 70, the P/T MPlantin 84 against its right end,
// flat 72 px cost discs 84 px apart with the 1993 symbols as images, the ©
// slot on the black border. What the BAKE draws from it is
// tests/unit/render/alpha-1993-bake.test.tsx.
// ---------------------------------------------------------------------------

const alpha = getFrameProfile("agclassic");
const land = getFrameProfile("alphaland");
const PAIR = [alpha, land];
const px = (pct: number) => pct * 1500;
const KEYS = ["w", "u", "b", "r", "g", "c", "a", "m"];

describe("the 1993 frame's sizes are the prints', as constants", () => {
  it("name 72, type line 70, credit 70, P/T 84, discs 72 — all even, so the 750 px bake draws exactly half", () => {
    expect([ALPHA_TITLE_SIZE_PCT, ALPHA_TYPE_SIZE_PCT, ALPHA_ARTIST_SIZE_PCT, ALPHA_PT_SIZE_PCT, ALPHA_COST_DISC_PCT].map(px).map((v) => Number(v.toFixed(6)))).toEqual([72, 70, 70, 84, 72]);
    for (const p of PAIR) {
      expect(p.title.sizePct).toBe(ALPHA_TITLE_SIZE_PCT);
      expect(p.type.sizePct).toBe(ALPHA_TYPE_SIZE_PCT);
      expect(p.footer!.sizePct).toBe(ALPHA_ARTIST_SIZE_PCT);
      expect(p.pt!.sizePct).toBe(ALPHA_PT_SIZE_PCT);
      expect(p.costSizePct).toBe(ALPHA_COST_DISC_PCT);
      // The rules text keeps the shared ladder.
      expect(p.rules.sizePct).toBe(rulesPxToPct(RULES_SIZE_PX.standard));
    }
  });

  it("faces: Beleren for the name, MPlantin — the printed face — for the type line, the credit and the P/T; no font file is added", () => {
    for (const p of PAIR) {
      expect(faceOf(p, "name").id).toBe("display");
      expect(faceOf(p, "typeLine").id).toBe("body");
      expect(faceOf(p, "footer").id).toBe("body");
      expect(faceOf(p, "stat").id).toBe("body");
      expect(faceOf(p, "mark").id).toBe("display");
    }
  });

  it("name and type line are measured (they shrink, then take ONE ellipsis) and sit on the prints' baselines through `dy`", () => {
    for (const p of PAIR) {
      for (const slot of [p.title, p.type]) {
        expect(slot.fit).toBe("measured");
        expect(slot.dy).toBeGreaterThan(0);
      }
      // The owner's left margin (round 4, "B2"): the art window's edge.
      expect((p.title.rect.leftPct / 100) * 1500).toBeCloseTo(178, 0);
      expect(p.type.rect.leftPct).toBe(p.title.rect.leftPct);
      // The band ends where the prints end the last disc (1364.9 ± 1.0 px).
      expect(((p.title.rect.leftPct + p.title.rect.widthPct) / 100) * 1500).toBeCloseTo(1365, 0);
    }
    // A long name shrinks instead of being cut by the renderer.
    const long = fitTitleBand(alpha, "Personal Incarnation of the Northern Paladin", "{3}{W}{W}{W}")!;
    expect(long.sizePct).toBeLessThan(ALPHA_TITLE_SIZE_PCT);
    const short = fitTitleBand(alpha, "Juggernaut", "{4}")!;
    expect(short.sizePct).toBe(ALPHA_TITLE_SIZE_PCT);
    // "Land" prints a pixel under the other cards' type line: the land's
    // band is 5 px lower (its wider art border) and its text 4 px back up.
    expect(px(alpha.type.dy! - land.type.dy!)).toBeCloseTo(4, 6);
    expect(((land.type.rect.topPct - alpha.type.rect.topPct) / 100) * 2100).toBeCloseTo(5.25, 2);
  });
});

describe("the footer — the printed credit, one line with the P/T", () => {
  it("is `Illus. <artist>` in mixed case, from the strip's left, in the 2026-09-25 embossed ink", () => {
    for (const p of PAIR) {
      const footer = p.footer!;
      expect(footerArtistLine(footer, "Douglas Schuler")).toBe("Illus. Douglas Schuler");
      expect(footerArtistLine(footer, null)).toBe("Illus. Unknown");
      expect(footer.uppercase).toBeUndefined();
      expect(footer.letterSpacingEm).toBeUndefined();
      expect(footer.align).toBeUndefined();
      // Never a © of our making, never a Wizards line.
      expect(footerArtistLine(footer, "Ada")).not.toMatch(/©|Wizards/);
      // Starts at 151.4 px; its box ends before the widest P/T's ink.
      expect((footer.rect.leftPct / 100) * 1500).toBeCloseTo(151.4, 0);
      expect(((footer.rect.leftPct + footer.rect.widthPct) / 100) * 1500).toBeLessThanOrEqual((p.pt!.inkSpanPct!.leftPct / 100) * 1500);
    }
    // Ink untouched: dark on the white frame, embossed silver elsewhere; the
    // land's one silver on every key.
    expect(footerInk(alpha.footer!, "w")).toEqual({ colorHex: alpha.footer!.colorHex, shadowCss: undefined });
    for (const k of KEYS.filter((k) => k !== "w")) {
      expect(footerInk(alpha.footer!, k).shadowCss, k).toBe("0.035em 0.035em 0 rgba(0,0,0,0.75)");
      expect(footerInk(alpha.footer!, k), k).toEqual(slotInk(alpha.pt!, k));
    }
    expect(slotInk(alpha.pt!, "a").colorHex).toBe("#7e888c");
    expect(new Set(["w", "u", "b", "r", "g", "c", "m"].map((k) => footerInk(land.footer!, k).colorHex))).toEqual(new Set(["#b0b4b4"]));
  });

  it("the P/T is set against its RIGHT end, as the prints set every value: two digits grow to the left at full size", () => {
    for (const p of PAIR) {
      const pt = p.pt!;
      expect(pt.align).toBe("end");
      expect(pt.endKerned).toBe(true);
      expect(pt.font).toBe("body");
      // The pen's end: 1380.6 px — a one-digit pair then covers the prints'
      // 1270–1378 px (MPlantin's digits: 0.552 em, bearings 0.043–0.065).
      const right = ((pt.rect.leftPct + pt.rect.widthPct) / 100) * 1500;
      expect(right).toBeCloseTo(1380.6, 0);
      expect(right - statWidthEm("3/3", "body") * 84).toBeCloseTo(1264.5, 0);
      for (const value of ["3/3", "1/1", "10/10", "12/12", "20/20"]) expect(fitStatSizePct(pt, value), value).toBe(ALPHA_PT_SIZE_PCT);
      // A value that would run into the credit's box shrinks.
      expect(fitStatSizePct(pt, "*+1/*+1")).toBeLessThan(ALPHA_PT_SIZE_PCT);
      // Inside the strip (the land's ends at 1984.5 px).
      expect(((pt.rect.topPct + pt.rect.heightPct) / 100) * 2100).toBeLessThanOrEqual(1984.5);
    }
  });
});

describe("the © slot — the black border under the frame", () => {
  it("display: the pipglyph.com mark at its standard size, ending where the border mark ended (3.5 % in), its standard white", () => {
    for (const p of PAIR) {
      expect(p.brandMark).toBeUndefined();
      const slot = p.copyrightSlot!;
      expect(slot.endPct).toBe(96.5);
      expect(slot.sizePct).toBe(ALPHA_COPYRIGHT_SIZE_PCT);
      expect(ALPHA_COPYRIGHT_SIZE_PCT).toBe(BRAND_MARK_GEOMETRY.fontPct);
      expect(slot.darkMarkKeys).toBeUndefined();
      // On the 100 px band under the frame (rows 2000–2100).
      expect((slot.baselinePct / 100) * 2100).toBeGreaterThan(2040);
      expect((slot.baselinePct / 100) * 2100).toBeLessThan(2075);
      for (const k of KEYS) {
        const layout = copyrightSlotLayout(p, k, { kind: "display" });
        expect(layout, k).toMatchObject({ kind: "brand", ink: { kind: "light" } });
        if (layout?.kind !== "brand") throw new Error("unreachable");
        expect(layout.anchor.rightPct).toBe(96.5);
        expect(layout.anchor.widthPct).toBeCloseTo(brandMarkWidthPct(1), 9);
      }
    }
  });

  it("a clean download: the card's footer text there, MPlantin, right-aligned on the same end, silver on the black — or nothing", () => {
    expect(copyrightFace(alpha.copyrightSlot!).id).toBe("body");
    const text = copyrightSlotLayout(alpha, "w", { kind: "download", footerText: "  Proxy — not for sale  " });
    expect(text).toMatchObject({ kind: "text", text: "Proxy — not for sale", colorHex: "#b0b4b4", sizePct: ALPHA_COPYRIGHT_SIZE_PCT });
    if (text?.kind !== "text") throw new Error("unreachable");
    expect(text.xPct + text.widthPct).toBeCloseTo(96.5, 9);
    expect(copyrightSlotLayout(alpha, "w", { kind: "download", footerText: "  " })).toEqual({ kind: "none" });
    expect(copyrightSlotLayout(alpha, "w", { kind: "download", footerText: null })).toEqual({ kind: "none" });
    // A long one is cut with ONE ellipsis at 62 % of the card's width.
    const long = copyrightSlotLayout(alpha, "b", { kind: "download", footerText: "A very long custom footer line that goes on and on and on, past any border".repeat(2) });
    if (long?.kind !== "text") throw new Error("unreachable");
    expect(long.text.endsWith("…")).toBe(true);
    expect(long.widthPct).toBeLessThanOrEqual(62 + 1e-6);
    expect(long.xPct + long.widthPct).toBeCloseTo(96.5, 9);
  });

  it("`endPct` is the 1993 pair's alone: the 1997 slot stays centred, the 2003 slot starts at its left end", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      const slot = getFrameProfile(t).copyrightSlot;
      if (slot) expect(slot.endPct !== undefined, t).toBe(t === "agclassic" || t === "alphaland");
    }
  });
});

describe('symbolStyle "original" — flat discs, the 1993 drawings, the tilted T', () => {
  const style = SYMBOL_STYLES.original;

  it("is the pair's style, and only theirs", () => {
    for (const t of FRAME_TEMPLATE_VALUES) expect(symbolStyleOf(getFrameProfile(t)).id === "original", t).toBe(t === "agclassic" || t === "alphaland");
  });

  it("flat in the cost and in the rules text, in both shadow models", () => {
    expect(style.discShadow).toBeNull();
    expect(discShadowCss(style, 72)).toBeUndefined();
    expect(inlineSymbolStyle(style)).toBe(style);
    expect(style.costRowShadowDiscs).toBe(0);
    expect(style.previewShadowClass).toBeNull();
    expect(metricsFor(76, undefined, "hd", "original")).toMatchObject({ pipShadowPx: 0, pipShadowLeftPx: 0 });
    // …and the inline disc is every style's 0.785 em (the era design: it
    // does not move).
    expect(metricsFor(76, undefined, "hd", "original").pipPx).toBe(metricsFor(76, undefined, "hd").pipPx);
    expect(metricsFor(76, undefined, "hd").pipShadowPx).toBeGreaterThan(0);
  });

  it("72 px discs 84 px apart (the prints: 72.6 ± 1.0 and 83.2 ± 1.3) — a wider gap than every other style's 0.12", () => {
    expect([ORIGINAL_DISC_PX, ORIGINAL_COST_GAP_PX]).toEqual([72, 12]);
    expect(costPipGap(style)).toBeCloseTo(12 / 72, 12);
    expect(costPipGapPx(style, 72)).toBe(12);
    expect(costPipGapPx(style, 36)).toBe(6);
    expect(costRowHdPx(ALPHA_COST_DISC_PCT, "portrait", style)).toEqual({ discPx: 72, gapPx: 12, cardWidthPx: 1500 });
    for (const other of ["modern", "1997", "2003"] as const) {
      expect(costPipGap(SYMBOL_STYLES[other]), other).toBe(DEFAULT_COST_GAP_DISCS);
      expect(DEFAULT_COST_GAP_DISCS).toBe(COST_PIP_GAP);
    }
    // The name's room counts the wider gap: three discs and two gaps.
    expect(costRowWidthPct("{2}{W}{W}", ALPHA_COST_DISC_PCT, style) * 1500).toBeGreaterThanOrEqual(3 * 72 + 2 * 12);
    expect(costRowWidthPct("{2}{W}{W}", ALPHA_COST_DISC_PCT, style) * 1500).toBeLessThan(3 * 72 + 2 * 12 + 8);
  });

  it("the five colour symbols are frames-bucket IMAGES — the whole pip — and every other symbol is the font's", () => {
    expect([...ORIGINAL_SYMBOL_LETTERS]).toEqual(["w", "u", "b", "r", "g"]);
    for (const c of ORIGINAL_SYMBOL_LETTERS) {
      const path = originalSymbolPath(c);
      expect(path).toBe(`/frames/${ORIGINAL_SYMBOL_FOLDER}/${c}.png`);
      expect(symbolImagePath(style, c)).toBe(path);
      expect(symbolImagePath(style, c.toUpperCase())).toBe(path);
      expect(manaGemSpec(c, 72, style)).toEqual({ kind: "image", suffix: c, path });
      expect(drawsManaGem(c, style)).toBe(true);
      // Published: the manifest lists the PNG and its WebP sibling.
      const files = (manifestJson as { files: Record<string, { width: number; height: number }> }).files;
      expect(files[`${ORIGINAL_SYMBOL_FOLDER}/${c}.png`], c).toMatchObject({ width: 216, height: 216 });
      expect(files[`${ORIGINAL_SYMBOL_FOLDER}/${c}.webp`], c).toBeDefined();
    }
    for (const other of ["c", "x", "0", "7", "s", "wu", "2w", "wp", "untap"]) {
      expect(symbolImagePath(style, other), other).toBeNull();
      expect(manaGemSpec(other, 72, style), other).toEqual(manaGemSpec(other, 72, SYMBOL_STYLES.modern));
    }
    // No other style draws an image.
    for (const other of ["modern", "1997", "2003"] as const) expect(SYMBOL_STYLES[other].symbolImages).toBeNull();
  });

  it("{T} is the era's first tap symbol — Revised's tilted T (mana-font tap-3ed), a glyph on the grey disc", () => {
    expect(styledSuffix(style, "tap")).toBe("tap-3ed");
    expect(manaGemSpec("tap", 72, style)).toMatchObject({ kind: "solid", suffix: "tap-3ed" });
    expect(styledSuffix(style, "untap")).toBe("untap");
  });

  it("symbolImagePathsIn names exactly the images a card's text draws — what the bake warms", () => {
    expect(symbolImagePathsIn(["{2}{W}{W}", "{T}: Add {G}.", null, undefined], style).sort()).toEqual([originalSymbolPath("g"), originalSymbolPath("w")]);
    expect(symbolImagePathsIn(["{4}", "{T}: Draw a card. {W/U} {2/G} {C}"], style)).toEqual([]);
    expect(symbolImagePathsIn([JSON.stringify({ chapters: [{ text: "Add {r}{R}." }] })], style)).toEqual([originalSymbolPath("r")]);
    expect(symbolImagePathsIn(["{W}{U}{B}{R}{G}"], SYMBOL_STYLES.modern)).toEqual([]);
  });
});

describe("layout v48 — the 1993 frame on its prints", () => {
  it("is ONE version in one constant: a sweep, never a badge, scoped to the pair — every other template stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.ALPHA_1993_LAYOUT_VERSION;
    expect(Number.isInteger(V)).toBe(true);
    expect(V).toBeGreaterThan(lv.MODERN_2003_LAYOUT_VERSION);
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(lv.VERSION_ROLLOUT[V]).toBe("sweep");
    expect(lv.rolloutPolicy(V)).toBe("sweep");
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.ALPHA_1993_TEMPLATES]).toEqual(["agclassic", "alphaland"]);
    // Every card on the pair, whatever its colour: no narrower card scope.
    expect(lv.VERSION_SCOPES[V]).toBeUndefined();
    for (const t of FRAME_TEMPLATE_VALUES) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(t === "agclassic" || t === "alphaland");
  });

  it("is NOT verification-neutral: a tick on the pair would go stale (none exists) — and no other template's does", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.ALPHA_1993_LAYOUT_VERSION;
    expect(lv.VERIFICATION_NEUTRAL_VERSIONS).not.toContain(V);
    expect([...lv.VERIFICATION_SCOPED_VERSIONS[V]]).toEqual(["agclassic", "alphaland"]);
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    const tick = { verified: true, verifiedLayoutVersion: V - 1, verifiedOverrideHash: "h" } as const;
    for (const t of ["agclassic", "alphaland"]) expect(verificationState(tick, t, "h", V), t).toMatchObject({ verified: true, stale: true });
    for (const t of ["retro", "retroland", "modern", "modernland", "m15", "battle"]) expect(verificationState(tick, t, "h", V).stale, t).toBe(false);
    expect(verificationState({ ...tick, verifiedLayoutVersion: V }, "agclassic", "h", V).stale).toBe(false);
  });
});

describe("imports — the 1993 frame is the printing of Alpha → The Dark", () => {
  const printing = (over: Partial<ScryfallCard>) =>
    ({
      id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
      name: "Probe",
      frame: "1993",
      border_color: "black",
      type_line: "Creature — Elf",
      mana_cost: "{G}",
      colors: ["G"],
      ...over,
    }) as ScryfallCard;

  it("a black-bordered printing of 1993–94 (LEA, LEB, ARN, ATQ, LEG, DRK) is exact on the pair", () => {
    for (const released_at of ["1993-08-05", "1993-10-04", "1993-12-17", "1994-03-04", "1994-06-01", "1994-08-08"]) {
      expect(frameMatchFromScryfall(printing({ released_at })), released_at).toMatchObject({ status: "exact", template: "agclassic", signature: "era/1993" });
    }
    expect(frameMatchFromScryfall(printing({ released_at: "1993-08-05", type_line: "Basic Land — Forest", mana_cost: "", colors: [] }))).toMatchObject({
      status: "exact",
      template: "alphaland",
    });
    // A printing with no date is never caught by the dated gap.
    expect(frameMatchFromScryfall(printing({})).status).toBe("exact");
  });

  it("from Fallen Empires (1994-11) the frame prints a second line under a smaller credit: NEAREST, blocked by 4.10h", () => {
    expect(ALPHA_TWO_LINE_FOOTER_FROM).toBe("1994-11-01");
    for (const released_at of ["1994-11-15", "1995-06-03", "1996-06-10", "2022-11-28"]) {
      expect(frameMatchFromScryfall(printing({ released_at })), released_at).toMatchObject({
        status: "nearest",
        template: "agclassic",
        signature: "era/1993+two-line-footer",
        blockedBy: "4.10h",
        gaps: ["two-line-footer"],
      });
    }
    expect(frameMatchFromScryfall(printing({ released_at: "1994-10-31" })).status).toBe("exact");
  });

  it("a white-bordered printing (Unlimited, Revised) names the border first; a later one carries both gaps", () => {
    expect(frameMatchFromScryfall(printing({ released_at: "1993-12-01", border_color: "white" }))).toMatchObject({ status: "nearest", blockedBy: "4.30", gaps: ["border"] });
    expect(frameMatchFromScryfall(printing({ released_at: "1995-04-01", border_color: "white" }))).toMatchObject({
      status: "nearest",
      blockedBy: "4.30",
      gaps: ["border", "two-line-footer"],
    });
    // The other frames never carry the gap.
    for (const frame of ["1997", "2003", "2015"]) {
      expect(frameMatchFromScryfall(printing({ frame, released_at: "1995-04-01" })).gaps ?? [], frame).not.toContain("two-line-footer");
    }
  });
});
