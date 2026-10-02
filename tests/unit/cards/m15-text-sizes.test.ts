import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { DISPLAY_BASELINE_BELOW_CENTRE_EM, getFrameProfile, type FrameProfile, type TextSlot } from "@/lib/cards/template-layout";
import {
  ADVENTURE_PANEL_COST_PCT,
  ADVENTURE_PANEL_PCT,
  COST_DISC_PCT,
  RULES_SIZE_PX,
  SET_SYMBOL_BOX_PCT,
  SET_SYMBOL_BOX_PCT_THIN_BAR,
  TITLE_SIZE_PCT,
  TYPE_SIZE_PCT,
  ptToPct,
  rulesPxToPct,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.20, layout v32: every M15-era frame (lib/cards/m15-family.ts) prints
// its name, type line, pips and set symbol at the ONE set of display sizes
// in lib/cards/typography.ts. The rects stay where v24–v31 verified them; a
// band whose text grew keeps its baseline through TextSlot.dy, and only the
// Card Conjurer masters' type line moves onto the prints' baseline. Split and
// battle stay out (TODO 4.21), and so does every other frame: their profiles
// are byte-identical to layout v31's. The same numbers on real bakes:
// tests/unit/render/m15-text-baselines-bake.test.tsx.
// ---------------------------------------------------------------------------

const FAMILY = new Set<string>(M15_FAMILY_TEMPLATES);
const FULL_ART_BASICS = ["m15fullartland", "fullartland"] as const;
/** The layout-v31 sizes each family band grew from (fractions of the width). */
const V31 = {
  m15Title: 0.05,
  m15Type: 0.0435,
  mseTitle: 0.0427, // planeswalker, saga, flip
  mseType: 0.0347, // planeswalker, saga, flip, the ZNR hedron / textless frames
  tokenType: 0.034,
} as const;
/** The whole px the bake moves a band's text by (fpx: Math.round). */
const px = (dy: number | undefined, width: number) => Math.round((dy ?? 0) * width) + 0;

const buf = readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf"));
const font: { ascender: number; descender: number; unitsPerEm: number } = opentype.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

describe("one M15-era display size (layout v32)", () => {
  it("prints every family frame's name and type line at TITLE_SIZE_PCT / TYPE_SIZE_PCT — both halves of a flip or aftermath", () => {
    // v32's 23, plus 4.49 (b)'s two text-box tokens, 4.34's borderless
    // land, 4.48 / 4.50's six full-art tokens, 4.33's two borderless
    // planeswalkers and 4.52's emblem.
    expect(M15_FAMILY_TEMPLATES).toHaveLength(35);
    for (const t of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(t);
      expect(p.title.sizePct, t).toBe(TITLE_SIZE_PCT);
      expect(p.type.sizePct, t).toBe(TYPE_SIZE_PCT);
      if (p.secondFace) {
        expect(p.secondFace.title.sizePct, t).toBe(TITLE_SIZE_PCT);
        expect(p.secondFace.type.sizePct, t).toBe(TYPE_SIZE_PCT);
      }
    }
    expect(["flip", "aftermath"].every((t) => getFrameProfile(t).secondFace)).toBe(true);
  });

  it("prints the adventure panel at Card Conjurer's name2 / type2 / mana2 (62 / 62 / 60 px)", () => {
    const panel = getFrameProfile("adventure").adventure!;
    expect(panel.title.sizePct).toBe(ADVENTURE_PANEL_PCT);
    expect(panel.type.sizePct).toBe(ADVENTURE_PANEL_PCT);
    expect(panel.costSizePct).toBe(ADVENTURE_PANEL_COST_PCT);
    for (const slot of [panel.title, panel.type]) {
      expect(slot.fit).toBe("measured");
      // The panel keeps centring its text on its bars (dy is front-face only).
      expect(slot.dy).toBeUndefined();
    }
  });

  it("draws M15's pip disc wherever a family frame draws a cost — planeswalker, saga and flip included", () => {
    for (const t of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(t);
      if (p.hideCost) continue;
      expect(p.costSizePct ?? p.title.sizePct, t).toBe(COST_DISC_PCT);
      if (p.secondFace?.costSizePct) expect(p.secondFace.costSizePct, t).toBe(COST_DISC_PCT);
    }
    // The planeswalker's disc no longer follows its (grown) name.
    expect(getFrameProfile("m15pw").costSizePct).toBe(COST_DISC_PCT);
  });

  it("sizes the set symbol from Card Conjurer's box: M15's 86 px, the planeswalker's and saga's 80 px", () => {
    // Flip and aftermath take M15's box too (CC's packFlip / aftermath use
    // 0.041 H), so every family frame outside the thin-bar pair is 86 px.
    const box: Partial<Record<FrameTemplate, number | undefined>> = {
      m15pw: SET_SYMBOL_BOX_PCT_THIN_BAR,
      // 4.33's borderless planeswalkers keep m15pw's symbol box.
      m15borderlesspw: SET_SYMBOL_BOX_PCT_THIN_BAR,
      m15borderlesspwtall: SET_SYMBOL_BOX_PCT_THIN_BAR,
      saga: SET_SYMBOL_BOX_PCT_THIN_BAR,
    };
    expect(SET_SYMBOL_BOX_PCT_THIN_BAR).toBe(0.0533);
    for (const t of M15_FAMILY_TEMPLATES) {
      const want = t in box ? box[t] : SET_SYMBOL_BOX_PCT;
      expect(getFrameProfile(t).symbolSizePct, t).toBe(want);
    }
    // CC's planeswalker / saga box is 0.0381 of the height — the pw symbolRect's.
    expect(0.0533 / 1.4).toBeCloseTo(0.0381, 4);
    expect(getFrameProfile("m15pw").symbolRect!.heightPct / 100).toBeCloseTo(0.038, 6);
  });

  it("fits every family band by its measured width — except the print-verified full-art basics", () => {
    for (const t of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(t);
      const want = (FULL_ART_BASICS as readonly string[]).includes(t) ? undefined : "measured";
      expect(p.title.fit, `${t} title`).toBe(want);
      expect(p.type.fit, `${t} type`).toBe(want);
    }
  });
});

describe("baselines (TextSlot.dy)", () => {
  it("keepBaseline's constant is Beleren Bold's: its baseline sits (ascender − descender) / 2 below the line box's centre", () => {
    // Both renderers centre the band's line box (line-height normal: the
    // hhea box) in the rect, so the baseline is centre + this × size.
    expect(font.unitsPerEm).toBe(2048);
    expect(DISPLAY_BASELINE_BELOW_CENTRE_EM).toBe((font.ascender + font.descender) / 2 / font.unitsPerEm);
    expect(DISPLAY_BASELINE_BELOW_CENTRE_EM).toBeCloseTo(0.3333, 4);
  });

  /** The dy that keeps a band's baseline once it grows from `from`. */
  const kept = (from: number, to: number) => -DISPLAY_BASELINE_BELOW_CENTRE_EM * (to - from);
  /** The token type band's move up onto CC's pill, 0.46 %H, in card widths. */
  const TOKEN_PILL_LIFT = (0.46 / 100) * (7 / 5);
  /** The prints' type baseline on Card Conjurer's M15 masters: 4.2 px up at HD. */
  const CC_TYPE_PRINT_DY = -0.0028;
  /** The 2014–19 token prints' type baseline (TODO 4.49 (d)): 4 px down at HD
   *  from the band rule on CC's pill (1796 → 1800; fifteen prints, mean
   *  1800.4) — on CC's own, un-moved pill. */
  const TOKEN_CC_TYPE_PRINT_DY = 0.0027;
  /** The same on the textless masters since the re-cut moved the pill and
   *  its band 8 px down: those 8 px back up, the baseline stays at 1800. */
  const TOKEN_TYPE_PRINT_DY = TOKEN_CC_TYPE_PRINT_DY - 8 / 1500;
  /** The 2014–19 text-box token prints' type baseline (TODO 4.49 (b)): 1500
   *  px at HD, 8 px higher against the pill than the textless prints'. */
  const TOKEN_TEXT_TYPE_PRINT_DY = -8 / 1500;

  // Every family front face: [template, title dy, type dy]. `undefined`: the
  // band is centred as before (no dy).
  const cc = kept(V31.m15Type, TYPE_SIZE_PCT) + CC_TYPE_PRINT_DY;
  const base = { title: kept(V31.m15Title, TITLE_SIZE_PCT), type: kept(V31.m15Type, TYPE_SIZE_PCT) };
  const mse = { title: kept(V31.mseTitle, TITLE_SIZE_PCT), type: kept(V31.mseType, TYPE_SIZE_PCT) };
  const TABLE: [FrameTemplate, number | undefined, number | undefined][] = [
    // The Card Conjurer M15 masters: name kept, type line on the prints'.
    ["m15", base.title, cc],
    ["m15land", base.title, cc],
    ["m15snowland", base.title, cc],
    ["m15artifact", base.title, cc],
    ["m15snow", base.title, cc],
    ["m15devoid", base.title, cc],
    ["m15borderless", base.title, cc],
    ["m15borderlessartifact", base.title, cc],
    // 4.34's land: the same pack, its type line on the same prints'
    // baseline (its bars sit where the spells' do, ±1 px, on 14 prints).
    ["m15borderlessland", base.title, cc],
    // The planeswalker: its name centred on CC's plate (v27's relation to
    // the pips); its type line in M15's slot, on the prints' baseline.
    ["m15pw", undefined, cc],
    // 4.33's borderless planeswalkers: m15pw's slots (the tall one's type
    // band 138 px higher, its text on the same baseline in the band).
    ["m15borderlesspw", undefined, cc],
    ["m15borderlesspwtall", undefined, cc],
    // The tokens: the name's baseline kept; the type line's kept through its
    // band's move up onto CC's pill (82.6 → 82.14 %H), then onto the prints'
    // (TODO 4.49 (d)) from the re-cut pill's band (82.52 %H).
    ["m15token", base.title, kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_TYPE_PRINT_DY],
    ["m15tokenartifact", base.title, kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_TYPE_PRINT_DY],
    // The text-box tokens (TODO 4.49 (b)): CC's token band (on CC's own
    // pill, not the textless re-cut's) on its re-cut pill, 292 px up, and the
    // text 8 px higher to the prints' 1500.
    [
      "m15tokentext",
      base.title,
      kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
    ],
    [
      "m15tokenartifacttext",
      base.title,
      kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
    ],
    // The emblem (TODO 4.52): a new template on Card Conjurer's master, set
    // straight onto its prints' baselines — the name 3 px up from the band
    // rule (193 → 190 px), "Emblem" 2 px up from the pill-centred band
    // (1498 → 1496 px), measured on TFDN #24 / #25, TBLB #30, TDSK #17 and
    // TFRA #16.
    ["emblem", -3 / 1500, -2 / 1500],
    // The full-art tokens (TODO 4.48 / 4.50): new, set on the M20 prints'
    // baselines from CC's boxes — the name 4 px up, the type line 6 / 5 / 6
    // px up from its pill's centre (textless / regular / tall).
    ["m20token", -4 / 1500, -6 / 1500],
    ["m20tokentext", -4 / 1500, -5 / 1500],
    ["m20tokentall", -4 / 1500, -6 / 1500],
    ["m20tokenartifact", -4 / 1500, -6 / 1500],
    ["m20tokenartifacttext", -4 / 1500, -5 / 1500],
    ["m20tokenartifacttall", -4 / 1500, -6 / 1500],
    // Adventure (layout v38, TODO 4.21a): a Card Conjurer master whose bars
    // are CC's M15 bars — the name kept, the type line on the prints' like
    // the other CC-framed M15 profiles.
    ["adventure", base.title, cc],
    // MSE-framed: baselines kept (their print offsets are TODO 4.21's).
    ["extendedart", base.title, base.type],
    ["expeditionland", base.title, base.type],
    ["nyx", base.title, base.type],
    // Aftermath (v38): a CC master; its text slots stay as print-matched in
    // 0.22 / v32 (baselines kept).
    ["aftermath", base.title, base.type],
    ["saga", mse.title, mse.type],
    // Flip (layout v38, TODO 4.21a): packFlip.js's bars, the name and type
    // line set onto C18 #134 / CM2 #71's baselines from CC's box centres
    // (−9.2 px and −4.9 px at HD).
    ["flip", -9.2 / 1500, -4.9 / 1500],
    ["fullart", base.title, mse.type],
    ["m15textless", base.title, mse.type],
    ["m15textlessland", base.title, mse.type],
    // Already at the family's sizes on print-verified slots: untouched.
    ["m15fullartland", 0, 0],
    ["fullartland", 0, 0],
  ];

  it("covers every family frame", () => {
    expect(TABLE.map(([t]) => t).sort()).toEqual([...M15_FAMILY_TEMPLATES].sort());
  });

  it.each(TABLE)("%s: the name and type line move by the dy that keeps (or corrects) their baseline", (t, title, type) => {
    const p = getFrameProfile(t);
    for (const [slot, want] of [
      [p.title, title],
      [p.type, type],
    ] as const) {
      if (want === undefined) expect(slot.dy).toBeUndefined();
      else expect(slot.dy).toBeCloseTo(want, 12);
    }
    // Second faces keep centring their text in their bars.
    if (p.secondFace) {
      expect(p.secondFace.title.dy).toBeUndefined();
      expect(p.secondFace.type.dy).toBeUndefined();
    }
  });

  it("moves each band by these whole pixels in the bake (HD 1500 / default 750)", () => {
    const at = (t: FrameTemplate) => {
      const p = getFrameProfile(t);
      return [px(p.title.dy, 1500), px(p.type.dy, 1500), px(p.title.dy, 750), px(p.type.dy, 750)];
    };
    // Measured on bakes of every family slot at df4f3d7 and here: every kept
    // baseline lands within 1 px of v31's at both sizes (the preview, which
    // translates by the exact dy, lands on it).
    expect(at("m15")).toEqual([-2, -5, -1, -3]);
    expect(at("m15pw")).toEqual([0, -5, 0, -3]);
    expect(at("extendedart")).toEqual([-2, -1, -1, 0]);
    expect(at("saga")).toEqual([-5, -5, -3, -3]);
    // Flip (v38): onto the prints — −9.2 / −4.9 px at HD, half at 750.
    expect(at("flip")).toEqual([-9, -5, -5, -2]);
    // Adventure (v38): CC's type-line print offset, as m15.
    expect(at("adventure")).toEqual([-2, -5, -1, -3]);
    // The token's type text: −6 / −3 px for its size, +10 / +5 for its
    // band's lift — where v31 drew it — +4 / +2 onto the prints' baseline
    // (TODO 4.49 (d)) and −8 / −4 back up from the band, which rides the
    // re-cut pill 8 / 4 px lower: the text stays where it was.
    expect(at("m15token")).toEqual([-2, 0, -1, 0]);
    // The text-box token's: CC's band moved with its pill, +4 / +2 onto the
    // prints' baseline, then 8 / 4 px higher (TODO 4.49 (b)) — no pull-back:
    // its band does not ride the textless re-cut (its master has its own,
    // TOKEN_REGULAR_RECUT).
    expect(at("m15tokentext")).toEqual([-2, 0, -1, 0]);
    expect(at("fullart")).toEqual([-2, -5, -1, -3]);
    expect(at("aftermath")).toEqual([-2, -1, -1, 0]);
    expect(at("m15fullartland")).toEqual([0, 0, 0, 0]);
    // The full-art tokens: whole px at both sizes, onto the prints'.
    expect(at("m20token")).toEqual([-4, -6, -2, -3]);
    expect(at("m20tokentext")).toEqual([-4, -5, -2, -2]);
    expect(at("m20tokentall")).toEqual([-4, -6, -2, -3]);
  });

  it("lands the Card Conjurer masters' type line 4.2 px higher than a kept baseline, on the prints' (1259.6 px at HD)", () => {
    const kept15 = getFrameProfile("extendedart").type.dy!;
    for (const t of [
      "m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15pw",
      "m15borderlesspw", "m15borderlesspwtall",
    ]) {
      expect((getFrameProfile(t).type.dy! - kept15) * 1500, t).toBeCloseTo(-4.2, 9);
    }
    // Only on masters from the frames bucket (Card Conjurer's), and only on
    // M15's type bar: not on the M15 base the MSE-framed spreads share.
    const ccTemplates = new Set(Object.keys(manifest.files).map((key) => key.split("/")[0]));
    for (const t of M15_FAMILY_TEMPLATES) {
      if (Math.abs(getFrameProfile(t).type.dy! - cc) > 1e-12) continue;
      expect(ccTemplates.has(t), t).toBe(true);
    }
  });

  it("keeps the planeswalker's name centred on its plate, level with its pips (v27), and its type line in M15's slot", () => {
    const pw = getFrameProfile("m15pw");
    const m15 = getFrameProfile("m15");
    expect(pw.title.dy).toBeUndefined();
    expect(pw.title.rect).toEqual({ topPct: 4.18, leftPct: 8.5, widthPct: 80, heightPct: 4.4 });
    // Name caps centre ≈ line-box centre + (baseline offset − cap height / 2):
    // Beleren's caps are 1434 / 2048 em. At 80 px (was 64) it moves < 1 px.
    const capsCentre = (sizePct: number) =>
      ((pw.title.rect.topPct + pw.title.rect.heightPct / 2) / 100) * 2100 +
      (DISPLAY_BASELINE_BELOW_CENTRE_EM - 1434 / 2048 / 2) * sizePct * 1500;
    expect(Math.abs(capsCentre(TITLE_SIZE_PCT) - capsCentre(V31.mseTitle))).toBeLessThan(1);
    expect(pw.type).toEqual({ ...m15.type, dy: pw.type.dy });
  });
});

describe("the full-art basics (4.39) and the frames outside the family", () => {
  it("leave the full-art basics' print-verified name and type line as they were: same size, no dy, the old fit path", () => {
    for (const t of FULL_ART_BASICS) {
      const p = getFrameProfile(t);
      expect(p.title.sizePct).toBe(0.0533);
      expect(p.type.sizePct).toBe(0.0453);
      for (const slot of [p.title, p.type]) {
        expect(slot.dy ?? 0).toBe(0);
        expect(slot.fit).toBeUndefined();
      }
    }
  });

  /** Every text slot of a profile, front, second face and adventure panel. */
  const slots = (p: FrameProfile): TextSlot[] =>
    [
      p.title,
      p.type,
      p.rules,
      p.footer,
      p.secondFace?.title,
      p.secondFace?.type,
      p.secondFace?.rules,
      p.adventure?.title,
      p.adventure?.type,
      p.adventure?.rules,
    ].filter((s): s is TextSlot => Boolean(s));

  it("sets TextSlot.dy / fit only on family frames", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (FAMILY.has(t)) continue;
      for (const slot of slots(getFrameProfile(t))) {
        expect(slot.dy, t).toBeUndefined();
        expect(slot.fit, t).toBeUndefined();
      }
    }
  });

  // sha256 of JSON.stringify(getFrameProfile(t)) at layout v31 (df4f3d7).
  // Layout v32 re-bakes the family only (its template scope), so every
  // other frame must draw exactly as before — split and battle included
  // (their sizes ship with TODO 4.21). A change here needs its own layout
  // bump; then update the digest.
  const V31_DIGESTS: Record<string, string> = {
    agclassic: "a5da9f64d06ac75912fb88a93120f67bec0cfb3e6c68208f1948ec32a3a66fc9",
    alphaland: "587111b4d222186562d9bf060d2cd9980cd54b5d7c61a97e2f9c52a266456c8c",
    alphatoken: "54b3301696e3a7d772dcdc1a86241010a32395822b66e2d996bf86501f9e427e",
    battle: "529a249c675f8ec5bbd89956ce433308844180e3c5c214e120fb74b9e300e609",
    split: "43801d93b7c4e70505e4562174231f8f887fa2ba0acf0f66534410b2d7667c0d",
    lotr: "2541c98b09237643cc6ef8d761fdff42f85ffc8d8dc842322e45915e8f62771b",
    lotrscroll: "45a76201319b406e6e6e3612ec875beeadf94315ee6f127af60b2cc0648e1882",
    avatar: "18b37fde1037dfccc0041e515a4f80246a9cbe0ed3e3277ca9a88014394a703a",
    bloomburrow: "736ecedbf0f59adbf31506777ef976bf18ce0b5ff549696201cefb1aa1250bfd",
    bloomanime: "86e5e9d3da194ee1ccfbe5e0654e1401024f303c54a0a912dee5e792d206705f",
    tarkirdraconic: "50b8b1038a077ea11b977b57e330f17ba97cef36ff660f9bca457784f4b04ecc",
    tarkirghostfire: "06c8b3c2433722bd026f6858eddb845b737d1b122aa5cb24cb73a9a8cdc4ddac",
    tarkirdragon: "02795eab0669bceb9882301ae017cbd5cf9289362c80b00c5067786a743189fd",
    retro: "764ab0efea4f4d679221f7f57ec3e0d7b036d0b29d5147d369ca31aa04009736",
    retroland: "73fecd74789647af365d2afb33f7ddce0dd2c6958a4a1d97b0e03e595c5e5c5e",
    modern: "06e6cd0351408015bfd7715f945c03f50e8fe9fef36915df006fae8e0c5f56e7",
    modernland: "84c510944cc37e2f818cf127ea36b36d01c12613714b1c741a0cc7bca5d49777",
  };

  // Layout v33 (TODO 3.29) gave every profile's rules box a named HD-px
  // ceiling (RULES_SIZE_PX) in place of its point literal — the prints' 9 /
  // 8 / 7.5 pt at 63 mm rounded up to 76 / 68 / 64 px. Each maps back to
  // the one v31 literal it replaced on these frames, so the rest of each
  // profile is still held to its v31 digest byte for byte.
  const V31_RULES_SIZE = new Map<number, number>([
    [rulesPxToPct(RULES_SIZE_PX.standard), ptToPct(9)],
    [rulesPxToPct(RULES_SIZE_PX.reduced), ptToPct(8)],
    [rulesPxToPct(RULES_SIZE_PX.compact), ptToPct(7.5)],
    [rulesPxToPct(RULES_SIZE_PX.reduced, "landscape"), ptToPct(8, "landscape")],
  ]);
  const asAtV31 = (p: FrameProfile): FrameProfile => {
    const size = (slot: TextSlot): TextSlot => {
      const v31 = V31_RULES_SIZE.get(slot.sizePct);
      expect(v31, `rules size ${slot.sizePct}`).toBeDefined();
      // v33 also pads split's two rules boxes past the textbox border they
      // hold (the text moves, no slot does); no other frame outside the
      // family carries a rules padding.
      const { padPx, ...rest } = slot;
      if (padPx) {
        expect(p.label).toBe("Split");
        expect(padPx).toEqual({ left: 57, right: 54, top: 18, bottom: 18 });
      }
      return { ...rest, sizePct: v31! };
    };
    return {
      ...p,
      rules: size(p.rules),
      ...(p.secondFace ? { secondFace: { ...p.secondFace, rules: size(p.secondFace.rules) } } : {}),
      ...(p.adventure ? { adventure: { ...p.adventure, rules: size(p.adventure.rules) } } : {}),
    };
  };

  it("leaves every frame outside the family byte-identical to layout v31 but for its v33 rules ceiling (and split's rules padding)", () => {
    const outside = FRAME_TEMPLATE_VALUES.filter((t) => !FAMILY.has(t));
    expect([...outside].sort()).toEqual(Object.keys(V31_DIGESTS).sort());
    for (const t of outside) {
      const digest = createHash("sha256").update(JSON.stringify(asAtV31(getFrameProfile(t)))).digest("hex");
      expect(digest, t).toBe(V31_DIGESTS[t]);
    }
  });
});
