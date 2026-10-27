import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { COST_ROW_PRINT_TEMPLATES, NYX_GEOMETRY_TEMPLATES, ZNR_HEDRON_TEMPLATES } from "@/lib/cards/layout-version";
import { DISPLAY_BASELINE_BELOW_CENTRE_EM, getFrameProfile, type FrameProfile, type TextSlot } from "@/lib/cards/template-layout";
import {
  CC_M15_COST_DISC_PCT,
  ADVENTURE_PANEL_COST_PCT,
  ADVENTURE_PANEL_PCT,
  COST_DISC_PCT,
  RULES_SIZE_PX,
  SET_SYMBOL_BOX_PCT,
  SET_SYMBOL_BOX_PCT_THIN_BAR,
  SPLIT_COST_DISC_PCT,
  SPLIT_SET_SYMBOL_BOX_PCT,
  SPLIT_TITLE_SIZE_PCT,
  SPLIT_TYPE_SIZE_PCT,
  TITLE_SIZE_PCT,
  TOKEN_ARCH_TITLE_SIZE_PCT,
  TYPE_SIZE_PCT,
  displayPct,
  ptToPct,
  rulesPxToPct,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.20, layout v32: every M15-era frame (lib/cards/m15-family.ts) prints
// its name, type line, pips and set symbol at the ONE set of display sizes
// in lib/cards/typography.ts. The rects stay where v24–v31 verified them; a
// band whose text grew keeps its baseline through TextSlot.dy, and only the
// Card Conjurer masters' type line moves onto the prints' baseline. The
// battle joined with its Card Conjurer master (TODO 4.21b, layout v43) — the
// family's one LANDSCAPE member, so a member's size is
// displayPct(constant, its orientation). Split stays out with print sizes of
// its own (the SPLIT_* constants), and so does every other frame: their
// profiles are byte-identical to layout v31's. The same numbers on real
// bakes: tests/unit/render/m15-text-baselines-bake.test.tsx, and the
// landscape pair's in tests/unit/render/landscape-v43-bake.test.tsx.
// ---------------------------------------------------------------------------

const FAMILY = new Set<string>(M15_FAMILY_TEMPLATES);
/** The 2014–19 arch tokens: their name is its prints' (TODO 4.53, v59). */
const ARCH_TOKENS = new Set<string>(["m15token", "m15tokentext", "m15tokenartifact", "m15tokenartifacttext", "m15tokentall", "m15tokenartifacttall"]);
/** Their name's dy: 1 px up at HD from the band-centred 90 px line onto the
 *  prints' baseline (TOKEN_ARCH_TITLE_PRINT_DY). */
const ARCH_TITLE_DY = -1 / 1500;
/** A family constant (a fraction of a PORTRAIT card's width) as `t` carries
 *  it: the same px on the page, × 5/7 on the landscape battle. */
const sized = (t: FrameTemplate, pct: number) =>
  getFrameProfile(t).orientation === "landscape" ? displayPct(pct, "landscape") : pct;
// …and the older full-art basic designs (TODO 4.40 / 4.41): the same CC
// title and type slots (FULL_ART_BASIC), print-checked on their own bars.
const FULL_ART_BASICS = ["m15fullartland", "fullartland", "m15fullartlandzen", "m15fullartlandsnc", "m15fullartlandthb"] as const;
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
    // planeswalkers, 4.52's emblem, 5.1a / 5.1b's nine double-faced bodies
    // and 4.21b's battle — 4.5c's Vehicle frame, 4.7's Nyx dress — and the
    // station frame's two (TODO 4.27a) — and 4.25's three Universes Beyond
    // frames.
    // …and extended art's land dress (TODO 4.7, owner Round 63) — and
    // 4.40 / 4.41's three older full-art basics, and the Spacecraft's
    // extended-art and borderless dresses (4.27a step 2).
    // …and TODO 5.7's four borderless double-faced bodies.
    // …and TODO 5.5 (b)'s double-faced saga front and back.
    // …and TODO 4.51's six Nyx dresses of the full-art tokens.
    // …and TODO 4.55's two tall-box arch tokens.
    // …and TODO 4.27's Prepare frame.
    // …and TODO 4.11 wave 1's 2015 Expeditions.
    // …and TODO 4.11's Lord of the Rings scroll (with its own bump, v62).
    // …and TODO 4.11's Lord of the Rings ring (with its own bump, v65).
    // …and TODO 4.11's MUL Tarkir dragon wings (with its own bump, v67).
    // …and TODO 4.11's Tarkir: Dragonstorm draconic and ghostfire (with
    // their own bump, v68).
    // …and TODO 4.11's Avatar elemental and Bloomburrow woodland (with their
    // own bump, v69).
    // …and TODO 4.11 / 4.35's Bloomburrow anime (with its own bump, v70).
    expect(M15_FAMILY_TEMPLATES).toHaveLength(82);
    for (const t of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(t);
      // The 2014–19 arch token's name is its prints' small capitals (TODO
      // 4.53, layout v59): TOKEN_ARCH_TITLE_SIZE_PCT, the capital size.
      expect(p.title.sizePct, t).toBe(sized(t, ARCH_TOKENS.has(t) ? TOKEN_ARCH_TITLE_SIZE_PCT : TITLE_SIZE_PCT));
      expect(p.type.sizePct, t).toBe(sized(t, TYPE_SIZE_PCT));
      if (p.secondFace) {
        expect(p.secondFace.title.sizePct, t).toBe(sized(t, TITLE_SIZE_PCT));
        expect(p.secondFace.type.sizePct, t).toBe(sized(t, TYPE_SIZE_PCT));
      }
    }
    expect(["flip", "aftermath"].every((t) => getFrameProfile(t).secondFace)).toBe(true);
    // The battle (the one landscape member): 80 / 68 px on its 2100 px
    // card, the portrait cards' px — not the bare constants, which would
    // draw them 1.4× the size.
    const battle = getFrameProfile("battle");
    expect(battle.orientation).toBe("landscape");
    expect(Math.round(battle.title.sizePct * 2100)).toBe(80);
    expect(Math.round(battle.type.sizePct * 2100)).toBe(68);
    expect(battle.title.sizePct).not.toBe(TITLE_SIZE_PCT);
  });

  it("keeps split out of the family at the prints' own sizes — 76 / 53 / 68 px and a 48 px symbol box, on BOTH halves", () => {
    // TODO 4.21b: a split half prints every line smaller than a regular
    // card (MH2 #123 / #60, TSR #161 / #186 against MH2 #50 / #118 on the
    // same scans): the design's 80 px name came out 3–6 % wide on ten
    // names, Card Conjurer's 60 px type line 13 % wide ("Sorcery" 201 px
    // against the prints' 177–178).
    expect(FAMILY.has("split")).toBe(false);
    const split = getFrameProfile("split");
    expect(split.orientation).toBe("landscape");
    expect(SPLIT_TITLE_SIZE_PCT * 2100).toBeCloseTo(76, 9);
    expect(SPLIT_TYPE_SIZE_PCT * 2100).toBeCloseTo(53, 9);
    expect(SPLIT_COST_DISC_PCT * 2100).toBeCloseTo(68, 9);
    expect(SPLIT_SET_SYMBOL_BOX_PCT * 2100).toBeCloseTo(48, 9);
    for (const face of [split, split.secondFace!]) {
      expect(face.title.sizePct).toBe(SPLIT_TITLE_SIZE_PCT);
      expect(face.type.sizePct).toBe(SPLIT_TYPE_SIZE_PCT);
      expect(face.costSizePct).toBe(SPLIT_COST_DISC_PCT);
      // Both halves take their size, text and room from the measured fit.
      expect(face.title.fit).toBe("measured");
      expect(face.type.fit).toBe("measured");
      // …on their bars' own rows: no dy, no costDy.
      expect(face.title.dy).toBeUndefined();
      expect(face.type.dy).toBeUndefined();
    }
    expect(split.costDy).toBeUndefined();
    expect(split.symbolSizePct).toBe(SPLIT_SET_SYMBOL_BOX_PCT);
    expect(split.setSymbolFit).toBe("ink-height");
    // Smaller than the family's on every line.
    expect(SPLIT_TITLE_SIZE_PCT).toBeLessThan(displayPct(TITLE_SIZE_PCT, "landscape"));
    expect(SPLIT_TYPE_SIZE_PCT).toBeLessThan(displayPct(TYPE_SIZE_PCT, "landscape"));
    expect(SPLIT_COST_DISC_PCT).toBeLessThan(displayPct(COST_DISC_PCT, "landscape"));
    expect(SPLIT_SET_SYMBOL_BOX_PCT).toBeLessThan(displayPct(SET_SYMBOL_BOX_PCT, "landscape"));
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
      // Layout v61 (TODO 3.34): the CC-framed M15 profiles and the walkers
      // print the 70 px disc; flip, aftermath and the MSE-framed showcases
      // keep v32's 72.75.
      // (The Lord of the Rings scroll took the CC M15 row with its own bump,
      // v63 / TODO 4.11; the Zendikar Rising hedron its prints' 70 px disc
      // with its Card Conjurer rebuild, v63; the LOTR ring the CC M15 row
      // with its own, v65; the Theros constellation its prints' 70 px disc
      // with its text correction, v66; the MUL Tarkir dragon wings the CC M15
      // row with their own, v67; the Tarkir: Dragonstorm pair the 70 px disc
      // with theirs, v68; the Avatar elemental and Bloomburrow woodland the
      // CC M15 row with theirs, v69.)
      const disc =
        COST_ROW_PRINT_TEMPLATES.includes(t) ||
        t === "lotrscroll" ||
        t === "lotr" ||
        t === "tarkirdragon" ||
        t === "tarkirdraconic" ||
        t === "tarkirghostfire" ||
        t === "avatar" ||
        t === "bloomburrow" ||
        t === "bloomanime" ||
        ZNR_HEDRON_TEMPLATES.includes(t) ||
        NYX_GEOMETRY_TEMPLATES.includes(t)
          ? CC_M15_COST_DISC_PCT
          : COST_DISC_PCT;
      expect(p.costSizePct ?? p.title.sizePct, t).toBe(sized(t, disc));
      if (p.secondFace?.costSizePct) expect(p.secondFace.costSizePct, t).toBe(sized(t, COST_DISC_PCT));
    }
    // The battle's: the family's 72.75 px disc on its landscape card (4.20
    // had pinned 71 px on the MSE profile).
    expect(getFrameProfile("battle").costSizePct! * 2100).toBeCloseTo(72.75, 9);
    // The planeswalker's disc no longer follows its (grown) name.
    expect(getFrameProfile("m15pw").costSizePct).toBe(CC_M15_COST_DISC_PCT);
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
      // The double-faced saga front (TODO 5.5 (b)): the saga's box.
      sagadfcfront: SET_SYMBOL_BOX_PCT_THIN_BAR,
      // …and its back (5.5 (b) PR 2).
      sagadfcback: SET_SYMBOL_BOX_PCT_THIN_BAR,
    };
    expect(SET_SYMBOL_BOX_PCT_THIN_BAR).toBe(0.0533);
    for (const t of M15_FAMILY_TEMPLATES) {
      const want = t in box ? box[t] : sized(t, SET_SYMBOL_BOX_PCT);
      expect(getFrameProfile(t).symbolSizePct, t).toBe(want);
    }
    // The battle's: CC's 86 px box on the landscape card, with the family's
    // ink fit.
    expect(getFrameProfile("battle").symbolSizePct! * 2100).toBeCloseTo(SET_SYMBOL_BOX_PCT * 1500, 9);
    expect(getFrameProfile("battle").setSymbolFit).toBe("ink");
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
    ["m15vehicle", base.title, cc],
    ["m15nyx", base.title, cc],
    // The station frame (TODO 4.27a): m15artifact's and m15land's bands.
    ["m15station", base.title, cc],
    // Its dresses (TODO 4.27a step 2): extendedart's and the borderless
    // artifact frame's slots.
    ["extendedartstation", base.title, cc],
    ["m15borderlessstation", base.title, cc],
    ["m15stationland", base.title, cc],
    // The Universes Beyond frames (TODO 4.25): their M15 twins' rows.
    ["m15ub", base.title, cc],
    ["m15ubartifact", base.title, cc],
    ["m15ubland", base.title, cc],
    ["m15snow", base.title, cc],
    ["m15devoid", base.title, cc],
    ["m15borderless", base.title, cc],
    ["m15borderlessartifact", base.title, cc],
    // 4.34's land: the same pack, its type line on the same prints'
    // baseline (its bars sit where the spells' do, ±1 px, on 14 prints).
    ["m15borderlessland", base.title, cc],
    // The planeswalker: its name centred on CC's plate (v27's relation to
    // the pips), then 4 HD px up onto the prints' rows with the pips (layout
    // v60); its type line in M15's slot, on the prints' baseline.
    ["m15pw", -4 / 1500, cc],
    // 4.33's borderless planeswalkers: m15pw's slots (the tall one's type
    // band 138 px higher, its text on the same baseline in the band).
    ["m15borderlesspw", -4 / 1500, cc],
    ["m15borderlesspwtall", -4 / 1500, cc],
    // The tokens: the name on the prints' baseline in its own size (TODO
    // 4.53, layout v59: 1 px up from the band-centred 90 px line); the type
    // line's kept through its band's move up onto CC's pill (82.6 → 82.14
    // %H), then onto the prints' (TODO 4.49 (d)) from the re-cut pill's band
    // (82.52 %H).
    ["m15token", ARCH_TITLE_DY, kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_TYPE_PRINT_DY],
    ["m15tokenartifact", ARCH_TITLE_DY, kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_TYPE_PRINT_DY],
    // The text-box tokens (TODO 4.49 (b)): CC's token band (on CC's own
    // pill, not the textless re-cut's) on its re-cut pill, 292 px up, and the
    // text 8 px higher to the prints' 1500.
    [
      "m15tokentext",
      ARCH_TITLE_DY,
      kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
    ],
    [
      "m15tokenartifacttext",
      ARCH_TITLE_DY,
      kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
    ],
    // The tall-box tokens (TODO 4.55): the text box's band and text, 238 px
    // up with the pill — the same dy (the prints' baseline 1263, 1 px under
    // the band's 1262).
    [
      "m15tokentall",
      ARCH_TITLE_DY,
      kept(V31.tokenType, TYPE_SIZE_PCT) + TOKEN_PILL_LIFT + TOKEN_CC_TYPE_PRINT_DY + TOKEN_TEXT_TYPE_PRINT_DY,
    ],
    [
      "m15tokenartifacttall",
      ARCH_TITLE_DY,
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
    // TODO 4.51: the Nyx dress — the same slots as its plain twin.
    ["m20tokennyx", -4 / 1500, -6 / 1500],
    ["m20tokennyxtext", -4 / 1500, -5 / 1500],
    ["m20tokennyxtall", -4 / 1500, -6 / 1500],
    ["m20tokenartifactnyx", -4 / 1500, -6 / 1500],
    ["m20tokenartifactnyxtext", -4 / 1500, -5 / 1500],
    ["m20tokenartifactnyxtall", -4 / 1500, -6 / 1500],
    // Adventure (layout v38, TODO 4.21a): a Card Conjurer master whose bars
    // are CC's M15 bars — the name kept, the type line on the prints' like
    // the other CC-framed M15 profiles.
    ["adventure", base.title, cc],
    // The Prepare frame (TODO 4.27): its masters are M15's above the type
    // bar, so the CC-framed M15 profile's lines.
    ["prepare", base.title, cc],
    // The transform bodies (TODO 5.1a): CC's 'Transform' packs are the M15
    // skeleton (the bands within 1–4 px of the prints), so each face is the
    // registry's m15 entry's baselines — the name kept, the type line on
    // the prints' (the back's white ink and the indicator's indent move no
    // baseline).
    ["m15dfcfront", base.title, cc],
    ["m15dfcback", base.title, cc],
    ["m15dfcbackleft", base.title, cc],
    ["m15dfclandfront", base.title, cc],
    ["m15dfclandback", base.title, cc],
    // …and the modal bodies (5.1b), on the same skeleton.
    ["m15mdfcfront", base.title, cc],
    ["m15mdfcback", base.title, cc],
    // The borderless double-faced bodies (TODO 5.7): m15borderless's slots.
    ["m15borderlessdfcfront", base.title, cc],
    ["m15borderlessdfcback", base.title, cc],
    ["m15borderlessmdfcfront", base.title, cc],
    ["m15borderlessmdfcback", base.title, cc],
    ["m15mdfclandfront", base.title, cc],
    ["m15mdfclandback", base.title, cc],
    // The extended-art frame (layout v58, TODO 4.7): Card Conjurer's
    // extended pack, M15's bars — the CC type line.
    ["extendedart", base.title, cc],
    // …and its land dress (owner Round 63): the same pack's land frames.
    ["extendedartland", base.title, cc],
    // The Lord of the Rings scroll (layout v62, TODO 4.11): Card Conjurer's
    // 'Scroll' pack, the M15 pack's text layout — the CC type line.
    ["lotrscroll", base.title, cc],
    // The Expeditions (TODO 4.11 wave 1, layout v64): Card Conjurer's two
    // Expedition packs — the name 2 px above M15's (186 px, the prints'),
    // the type line on its own band centred for its baseline (no dy: 1794
    // on ZNE's bar, 1798 on EXP's).
    ["expeditionland", base.title - 2 / 1500, 0],
    ["expeditionlandbfz", base.title - 2 / 1500, 0],
    // The ring (layout v65): the M15 pack's text layout under the pack's
    // lower bar — the name moves with its RECT (10.4 px), its dy is M15's;
    // the type line on the CC baseline + 2 px (the prints' 1261).
    ["lotr", base.title, cc + 2 / 1500],
    // The MUL Tarkir dragon wings (layout v67): the M15 pack's text layout on
    // the pack's own bars — the name and the type band move with their
    // RECTS (7 / 4.5 px up), the dys are M15's name and the CC type line.
    ["tarkirdragon", base.title, cc],
    // The Tarkir draconic (layout v68): M15's slots on its MSE master — the
    // name M15's, the type line on the CC baseline + 2 px (MSE's type bar 2 px
    // lower than the CC M15 master's; print's 1263).
    ["tarkirdraconic", base.title, cc + 2 / 1500],
    // The Tarkir ghostfire (layout v68): its own bars at the family's sizes —
    // each band's baseline kept from its old print-measured size (0.0535 /
    // 0.0445), the type line 2 px up onto TDM #399–408's 1158.
    ["tarkirghostfire", kept(0.0535, TITLE_SIZE_PCT), kept(0.0445, TYPE_SIZE_PCT) - 2 / 1500],
    // The Avatar elemental and Bloomburrow woodland (layout v69): M15's slots
    // on their MSE masters — the name M15's (print's 188–188.5 px, ours 189),
    // the type line the CC baseline (print's 1259–1260, ours 1260).
    ["avatar", base.title, cc],
    ["bloomburrow", base.title, cc],
    // The Bloomburrow anime (layout v70): its own layout on M15's slots — the
    // name band's RECT 25 px up (print's baseline 164; its dy M15's), the
    // type line the CC baseline (print's 1261, ours 1260).
    ["bloomanime", base.title, cc],
    // The Theros constellation (TODO 4.11, layout v66): MSE-framed, its name
    // 2 px up onto THB #258–268's baseline; its type line rides the band,
    // whose RECT moves 10 px down (the text's dy is M15's).
    ["nyx", base.title - 2 / 1500, base.type],
    // Aftermath (v38): a CC master; its text slots stay as print-matched in
    // 0.22 / v32 (baselines kept).
    ["aftermath", base.title, base.type],
    // Saga (TODO 4.21c): a CC master. The name keeps its baseline (already
    // the prints', 185 px); the type line moves onto the prints' — 9.3 px
    // down at HD (DOM #21 / #42 / #90 / #122 / #173: 1854–1857 px).
    ["saga", mse.title, (mse.type ?? 0) + 9.3 / 1500],
    // The double-faced saga front (TODO 5.5 (b)): the saga's bars.
    ["sagadfcfront", mse.title, (mse.type ?? 0) + 9.3 / 1500],
    // …and its back (5.5 (b) PR 2): the same bars.
    ["sagadfcback", mse.title, (mse.type ?? 0) + 9.3 / 1500],
    // Flip (layout v38, TODO 4.21a): packFlip.js's bars, the name and type
    // line set onto C18 #134 / CM2 #71's baselines from CC's box centres
    // (−9.2 px and −4.9 px at HD).
    ["flip", -9.2 / 1500, -4.9 / 1500],
    // The battle (layout v43, TODO 4.21b): a new master, set straight onto
    // the nine MOM prints' baselines from its bars' own faces — the name 2
    // px below the pill-centred line (158.4 px on the prints), "Battle —
    // Siege" 2 px below the bar-centred one. Fractions of ITS 2100 px width.
    ["battle", 2 / 2100, 2 / 2100],
    // The Zendikar Rising hedron showcase (TODO 4.11, layout v63): the
    // CC-framed slots, its type line 5.6 px lower on the 2014–22 prints'.
    ["fullart", base.title, cc + 5.6 / 1500],
    // The textless promo pair (layout v58): CC 'Magic Fest Promos', the m15
    // entry's slots (its type line is never drawn: `textless`).
    ["m15textless", base.title, cc],
    ["m15textlessland", base.title, cc],
    // Already at the family's sizes on print-verified slots: untouched.
    ["m15fullartland", 0, 0],
    ["fullartland", 0, 0],
    // …and the older designs (TODO 4.40 / 4.41), measured on their own prints.
    ["m15fullartlandzen", 0, 0],
    ["m15fullartlandsnc", 0, 0],
    ["m15fullartlandthb", 0, 0],
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
    // The walker's name: 4 / 2 px up onto the prints' rows (layout v60).
    expect(at("m15pw")).toEqual([-4, -5, -2, -3]);
    expect(at("extendedart")).toEqual([-2, -5, -1, -3]);
    // Saga (4.21c): the name kept, the type line 9.3 px lower onto the
    // prints (−5.3 + 9.3 = +4 at HD, +2 at 750).
    expect(at("saga")).toEqual([-5, 4, -3, 2]);
    // Flip (v38): onto the prints — −9.2 / −4.9 px at HD, half at 750.
    expect(at("flip")).toEqual([-9, -5, -5, -2]);
    // Adventure (v38): CC's type-line print offset, as m15.
    expect(at("adventure")).toEqual([-2, -5, -1, -3]);
    // The token's type text: −6 / −3 px for its size, +10 / +5 for its
    // band's lift — where v31 drew it — +4 / +2 onto the prints' baseline
    // (TODO 4.49 (d)) and −8 / −4 back up from the band, which rides the
    // re-cut pill 8 / 4 px lower: the text stays where it was.
    // The name (TODO 4.53, v59): 1 px up at HD onto the prints' baseline,
    // 0 at 750 (the half pixel rounds away).
    expect(at("m15token")).toEqual([-1, 0, 0, 0]);
    // The text-box token's: CC's band moved with its pill, +4 / +2 onto the
    // prints' baseline, then 8 / 4 px higher (TODO 4.49 (b)) — no pull-back:
    // its band does not ride the textless re-cut (its master has its own,
    // TOKEN_REGULAR_RECUT).
    expect(at("m15tokentext")).toEqual([-1, 0, 0, 0]);
    // The ZNR hedron (v63): the CC type slot 5.6 / 2.8 px lower.
    expect(at("fullart")).toEqual([-2, 1, -1, 0]);
    expect(at("aftermath")).toEqual([-2, -1, -1, 0]);
    expect(at("m15fullartland")).toEqual([0, 0, 0, 0]);
    // The full-art tokens: whole px at both sizes, onto the prints'.
    expect(at("m20token")).toEqual([-4, -6, -2, -3]);
    expect(at("m20tokentext")).toEqual([-4, -5, -2, -2]);
    expect(at("m20tokentall")).toEqual([-4, -6, -2, -3]);
    // The battle, on its landscape widths (HD 2100 / default 1050): 2 px
    // down at HD, 1 px at the default — whole px at both, so the bake and
    // the preview (which translates by the exact dy) move the text alike.
    const battle = getFrameProfile("battle");
    expect([px(battle.title.dy, 2100), px(battle.type.dy, 2100), px(battle.title.dy, 1050), px(battle.type.dy, 1050)]).toEqual([2, 2, 1, 1]);
    expect(battle.title.dy! * 2100).toBeCloseTo(2, 9);
    expect(battle.type.dy! * 2100).toBeCloseTo(2, 9);
  });

  it("lands the Card Conjurer masters' type line 4.2 px higher than a kept baseline, on the prints' (1259.6 px at HD)", () => {
    // (The kept baseline's reference was expeditionland's until TODO 4.11
    // wave 1 re-sourced it: nyx keeps M15's.)
    const kept15 = getFrameProfile("nyx").type.dy!;
    for (const t of [
      "m15", "m15land", "m15snowland", "m15artifact", "m15vehicle", "m15nyx", "m15ub", "m15ubartifact", "m15ubland", "m15snow", "m15devoid", "m15borderless", "m15borderlessartifact", "m15borderlessland", "m15pw",
      // The station frame (TODO 4.27a): cut from the published m15artifact /
      // m15land masters, so their type bar.
      "m15station", "m15stationland",
      "m15borderlesspw", "m15borderlesspwtall",
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback",
      "m15mdfcfront", "m15mdfcback", "m15mdfclandfront", "m15mdfclandback",
      // The borderless double-faced bodies (TODO 5.7).
      "m15borderlessdfcfront", "m15borderlessdfcback", "m15borderlessmdfcfront", "m15borderlessmdfcback",
      // The extended-art frame and the textless promo pair (layout v58).
      "extendedart", "extendedartland", "m15textless", "m15textlessland",
    ]) {
      expect((getFrameProfile(t).type.dy! - kept15) * 1500, t).toBeCloseTo(-4.2, 9);
    }
    // Only on masters from the frames bucket (Card Conjurer's), and only on
    // M15's type bar: not on the M15 base the MSE-framed spreads share.
    // (The Avatar elemental and Bloomburrow woodland, layout v69, and the
    // Bloomburrow anime, v70, are MSE masters in git whose own type bars put
    // print's baseline on the CC one:
    // measured on TLA / BLB, not inherited from a CC master.)
    const ccTemplates = new Set(Object.keys(manifest.files).map((key) => key.split("/")[0]));
    const MSE_ON_CC_BASELINE = new Set(["avatar", "bloomburrow", "bloomanime"]);
    for (const t of M15_FAMILY_TEMPLATES) {
      if (Math.abs(getFrameProfile(t).type.dy! - cc) > 1e-12) continue;
      expect(ccTemplates.has(t) || MSE_ON_CC_BASELINE.has(t), t).toBe(true);
    }
    for (const t of MSE_ON_CC_BASELINE) expect(ccTemplates.has(t), t).toBe(false);
  });

  it("keeps the planeswalker's name rect centred on its plate (v27), its text 4 px up with the pips (v60), and its type line in M15's slot", () => {
    const pw = getFrameProfile("m15pw");
    const m15 = getFrameProfile("m15");
    expect(pw.title.dy).toBe(-4 / 1500);
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

  const RETRO_1997 = new Set<string>(["retro", "retroland"]);
  // The 2003 pair (TODO 4.10b): measured name and type line; only the type
  // line needs a nudge onto its printed baseline.
  const MODERN_2003 = new Set<string>(["modern", "modernland"]);
  const ALPHA_1993 = new Set<string>(["agclassic", "alphaland"]);
  it("sets TextSlot.dy only on family frames, and the measured fit on them, on split's two halves and on the 1997 and 2003 pairs' name and type line", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (FAMILY.has(t)) continue;
      const p = getFrameProfile(t);
      for (const slot of slots(p)) {
        if (RETRO_1997.has(t) && (slot === p.title || slot === p.type)) {
          expect(slot.fit, t).toBe("measured");
          expect(slot.dy, t).toBeGreaterThan(0);
          continue;
        }
        // The 1993 pair (TODO 4.10c): measured name and type line, each
        // lowered onto its printed baseline.
        if (ALPHA_1993.has(t) && (slot === p.title || slot === p.type)) {
          expect(slot.fit, t).toBe("measured");
          expect(slot.dy, t).toBeGreaterThan(0);
          continue;
        }
        if (MODERN_2003.has(t) && (slot === p.title || slot === p.type)) {
          expect(slot.fit, t).toBe("measured");
          if (slot === p.type) expect(slot.dy, t).toBeGreaterThan(0);
          else expect(slot.dy, t).toBeUndefined();
          continue;
        }
        expect(slot.dy, t).toBeUndefined();
        // Split (TODO 4.21b) is the one frame outside the family whose
        // names and type lines are measured — both halves, at its own
        // sizes; its rules and footer are not display bands.
        const measured = t === "split" && [p.title, p.type, p.secondFace?.title, p.secondFace?.type].includes(slot);
        expect(slot.fit, t).toBe(measured ? "measured" : undefined);
      }
    }
  });

  // sha256 of JSON.stringify(getFrameProfile(t)) at layout v31 (df4f3d7).
  // Layout v32 re-bakes the family only (its template scope), so every
  // other frame must draw exactly as before. A change here needs its own
  // layout bump; then update the digest. Split and battle left the list
  // with theirs (layout v43, TODO 4.21b: Card Conjurer masters and new
  // profiles — the battle in the family, split pinned by the test above and
  // tests/unit/cards/fixtures/profiles-base.json).
  const V31_SPLIT_DIGEST = "43801d93b7c4e70505e4562174231f8f887fa2ba0acf0f66534410b2d7667c0d";
  const V31_DIGESTS: Record<string, string> = {
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
  ]);
  const asAtV31 = (p: FrameProfile): FrameProfile => {
    const size = (slot: TextSlot): TextSlot => {
      const v31 = V31_RULES_SIZE.get(slot.sizePct);
      expect(v31, `rules size ${slot.sizePct}`).toBeDefined();
      // No frame in the list carries a rules padding (split's, v33's one,
      // left with its Card Conjurer profile).
      expect(slot.padPx, p.label).toBeUndefined();
      return { ...slot, sizePct: v31! };
    };
    return {
      ...p,
      rules: size(p.rules),
      ...(p.secondFace ? { secondFace: { ...p.secondFace, rules: size(p.secondFace.rules) } } : {}),
      ...(p.adventure ? { adventure: { ...p.adventure, rules: size(p.adventure.rules) } } : {}),
    };
  };

  // Layout v44 (TODO 4.23a) gave the 2003 pair's footer an ink map (white on
  // the black frame and on lands) and moved nothing: without it each of the
  // two is still its v31 self, byte for byte.
  // (Since TODO 4.10b the pair is no longer in the v31 digests at all: its
  // own bump rebuilt both profiles — tests/unit/cards/modern-2003-profile.test.ts.)
  const V44_FOOTER_INK = new Set<string>([]);
  const withoutV44FooterInk = (t: string, p: FrameProfile): FrameProfile => {
    if (!V44_FOOTER_INK.has(t)) {
      expect(p.footer?.inkByColorKey, t).toBeUndefined();
      return p;
    }
    expect(p.footer?.inkByColorKey, t).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inkByColorKey, ...footer } = p.footer!;
    return { ...p, footer };
  };

  it("leaves every frame outside the family byte-identical to layout v31 but for its v33 rules ceiling — split aside, which moved with its own bump (v43)", () => {
    // (The 1997 pair left its v31 self with its own bump too: TODO 4.10a,
    // layout v46 — tests/unit/cards/retro-1997-profile.test.ts.)
    // …and the 2003 pair with TODO 4.10b.
    // …and the 1993 pair with TODO 4.10c (layout v48 —
    // tests/unit/cards/alpha-1993-profile.test.ts).
    // (The Lord of the Rings scroll joined the family with its Card Conjurer
    // re-source, layout v62 / TODO 4.11: off this list — and the ring with
    // its own, layout v65, and the MUL Tarkir dragon wings with theirs, v67,
    // and the Tarkir: Dragonstorm draconic and ghostfire with theirs, v68,
    // and the Avatar elemental and Bloomburrow woodland with theirs, v69,
    // and the Bloomburrow anime with its own, v70.)
    const REBUILT = new Set<string>(["split", "retro", "retroland", "modern", "modernland", "agclassic", "alphaland"]);
    const outside = FRAME_TEMPLATE_VALUES.filter((t) => !FAMILY.has(t) && !REBUILT.has(t));
    expect([...outside].sort()).toEqual(Object.keys(V31_DIGESTS).sort());
    for (const t of outside) {
      const digest = createHash("sha256").update(JSON.stringify(asAtV31(withoutV44FooterInk(t, getFrameProfile(t))))).digest("hex");
      expect(digest, t).toBe(V31_DIGESTS[t]);
    }
    // Split is outside the family and no longer its v31 self.
    expect(FAMILY.has("split")).toBe(false);
    expect(createHash("sha256").update(JSON.stringify(getFrameProfile("split"))).digest("hex")).not.toBe(V31_SPLIT_DIGEST);
  });
});
