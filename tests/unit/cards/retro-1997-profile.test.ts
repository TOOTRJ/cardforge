import { describe, expect, it } from "vitest";
import { BRAND_MARK_GEOMETRY, brandMarkWidthPct } from "@/lib/cards/collector-layout";
import { BRAND_MARK_LIGHT_INK, BRAND_MARK_LIGHT_SHADOW, copyrightFace, copyrightInk, copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { footerArtistLine } from "@/lib/cards/card-display";
import { isRenderStale } from "@/lib/cards/layout-version";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import { SYMBOL_STYLES, discShadowCss, discShadowPx, styledSuffix, symbolStyleOf } from "@/lib/cards/symbol-style";
import { bandTextStyle, footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { TYPE_FACES, faceOf, facesOf } from "@/lib/cards/type-faces";
import {
  RETRO_ARTIST_SIZE_PCT,
  RETRO_COPYRIGHT_SIZE_PCT,
  RETRO_COST_DISC_PCT,
  RETRO_PT_SIZE_PCT,
  RETRO_TITLE_SIZE_PCT,
  RETRO_TYPE_SIZE_PCT,
  RULES_SIZE_PX,
  rulesPxToPct,
} from "@/lib/cards/typography";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { RETRO_REPRINT_COLOURS_FROM, RETRO_TIMESHIFTED_FROM } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The 1997 frame's PROFILE (TODO 4.10a, layout v46): `retro` and `retroland`
// as the ORIGINAL cards printed them, Mirage 1996 → Scourge 2003 — white
// lettering with a hard black shadow on every colour, the type line and the
// artist line in MPlantin, the centred two-line footer with the © slot, flat
// 73 px discs and the 1997 tap. Every number is the prints'
// (lib/cards/typography.ts RETRO_*; lib/cards/template-layout.ts RETRO).
// The bakes: tests/unit/render/retro-1997-bake.test.tsx.
// ---------------------------------------------------------------------------

const retro = getFrameProfile("retro");
const land = getFrameProfile("retroland");
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const WHITE = "#f0f3ef";
const HD_W = 1500;
const HD_H = 2100;
/** A `<dx>em <dy>em 0 <hex>` shadow as HD px at `sizePx`. */
function shadowPx(css: string | undefined, sizePx: number): { dx: number; dy: number; hex: string } {
  const m = /^([\d.]+)em ([\d.]+)em 0 (#[0-9a-f]{6})$/.exec(css ?? "");
  if (!m) throw new Error(`not a hard em shadow: ${css}`);
  return { dx: Number(m[1]) * sizePx, dy: Number(m[2]) * sizePx, hex: m[3] };
}

describe("the 1997 sizes — per-era constants, never a profile literal", () => {
  it("are the prints' sizes in the faces the site sets them in (HD px)", () => {
    expect(RETRO_TITLE_SIZE_PCT * HD_W).toBeCloseTo(71, 9);
    expect(RETRO_TYPE_SIZE_PCT * HD_W).toBeCloseTo(67, 9);
    expect(RETRO_PT_SIZE_PCT * HD_W).toBeCloseTo(86, 9);
    expect(RETRO_ARTIST_SIZE_PCT * HD_W).toBeCloseTo(58, 9);
    expect(RETRO_COPYRIGHT_SIZE_PCT * HD_W).toBeCloseTo(33, 9);
    expect(RETRO_COST_DISC_PCT * HD_W).toBeCloseTo(73, 9);
    for (const p of [retro, land]) {
      expect(p.title.sizePct).toBe(RETRO_TITLE_SIZE_PCT);
      expect(p.type.sizePct).toBe(RETRO_TYPE_SIZE_PCT);
      expect(p.pt!.sizePct).toBe(RETRO_PT_SIZE_PCT);
      expect(p.footer!.sizePct).toBe(RETRO_ARTIST_SIZE_PCT);
      expect(p.copyrightSlot!.sizePct).toBe(RETRO_COPYRIGHT_SIZE_PCT);
      expect(p.costSizePct).toBe(RETRO_COST_DISC_PCT);
      expect(p.rules.sizePct).toBe(rulesPxToPct(RULES_SIZE_PX.standard));
    }
    // Beleren's capitals at 71 px are the acceptance's 50 ± 1 px; MPlantin's
    // at 67 px the type line's 46 ± 1.
    expect(71 * 0.7).toBeCloseTo(50, 0);
    expect(Math.abs(67 * 0.682 - 46)).toBeLessThanOrEqual(1);
  });

  it("names stay in Beleren, the type line and the artist line are MPlantin (their printed face), the P/T stays Beleren — no new typeface", () => {
    for (const p of [retro, land]) {
      expect(faceOf(p, "name")).toBe(TYPE_FACES.display);
      expect(faceOf(p, "typeLine")).toBe(TYPE_FACES.body);
      expect(faceOf(p, "footer")).toBe(TYPE_FACES.body);
      expect(faceOf(p, "stat")).toBe(TYPE_FACES.display);
      expect(faceOf(p, "mark")).toBe(TYPE_FACES.display);
      expect(copyrightFace(p.copyrightSlot!)).toBe(TYPE_FACES.body);
      // Only faces the repo already has are registered for a render.
      expect(facesOf(p)).toEqual(["display", "body"]);
    }
  });

  it("the name and the type line join the measured fit, on the prints' baselines", () => {
    for (const p of [retro, land]) {
      expect(p.title.fit).toBe("measured");
      expect(p.type.fit).toBe("measured");
      // Baseline = the rect's centre + the face's baseline below its line
      // box's centre + dy: 163 px (name) and 1229 px (type line) ± 1.
      const baseline = (slot: typeof p.title, face: typeof TYPE_FACES.display) =>
        ((slot.rect.topPct + slot.rect.heightPct / 2) / 100) * HD_H + face.baselineBelowCentreEm * slot.sizePct * HD_W + (slot.dy ?? 0) * HD_W;
      expect(Math.abs(baseline(p.title, TYPE_FACES.display) - 163.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(baseline(p.type, TYPE_FACES.body) - 1229)).toBeLessThanOrEqual(1);
      // The cost's discs are centred on the band: row 137, the prints'.
      expect(((p.title.rect.topPct + p.title.rect.heightPct / 2) / 100) * HD_H).toBeCloseTo(137, 0);
      // …and the last disc ends where the prints' does (1383 px).
      expect(((p.title.rect.leftPct + p.title.rect.widthPct) / 100) * HD_W).toBeCloseTo(1383, 0);
    }
    // A long name shrinks by its measured width instead of an estimate.
    const long = fitTitleBand(retro, "Asmoranomardicadaistinaculdacar", "{4}{R}{R}")!;
    expect(long.sizePct).toBeLessThan(RETRO_TITLE_SIZE_PCT);
    expect(long.text).toBe("Asmoranomardicadaistinaculdacar");
    expect(fitTitleBand(retro, "Shivan Dragon", "{4}{R}{R}")!.sizePct).toBe(RETRO_TITLE_SIZE_PCT);
  });
});

describe("the 1997 ink — white with a hard black shadow on EVERY key", () => {
  it("name, type line, P/T and artist line: #f0f3ef and the prints' offsets (HD px, ± 1)", () => {
    for (const p of [retro, land]) {
      for (const key of KEYS) {
        const title = bandTextStyle(p.title, key);
        const type = bandTextStyle(p.type, key);
        const pt = slotInk(p.pt!, key);
        const artist = footerInk(p.footer!, key, p);
        for (const ink of [title, type]) expect(ink.color, key).toBe(WHITE);
        expect(pt.colorHex, key).toBe(WHITE);
        expect(artist.colorHex, key).toBe(WHITE);
        // Right / down: name + 5 / + 3, type line + 4.5 / + 3.3, artist line
        // + 3.5 / + 3.5, the P/T about twice the name's (+ 6.7 / + 5.7).
        const want = [
          [title.textShadow, 71, 5, 3],
          [type.textShadow, 67, 4.5, 3.3],
          [artist.shadowCss, 58, 3.5, 3.5],
          [pt.shadowCss, 86, 6.7, 5.7],
        ] as const;
        for (const [css, size, dx, dy] of want) {
          const s = shadowPx(css, size);
          expect(Math.abs(s.dx - dx), `${key} ${css}`).toBeLessThan(0.05);
          expect(Math.abs(s.dy - dy), `${key} ${css}`).toBeLessThan(0.05);
          // The prints' ranges: + 3 to + 5 / + 3, the P/T + 6 to + 7 / + 5 to + 6.
          expect(s.hex).toBe("#181311");
        }
      }
      // The shadows are per-key INK, never the band's own: a band-level
      // shadow would emboss the pips beside the name.
      expect(p.title.shadowCss).toBeUndefined();
      expect(p.type.shadowCss).toBeUndefined();
      // The rules stay dark on the light text box.
      expect(p.rules.colorHex).toBe("#17120c");
    }
  });
});

describe("the 1997 footer — the centred two lines of Exodus 1998 on", () => {
  it("line 1: `Illus. <artist>` in MPlantin, mixed case, centred on 748 px with its baseline at 1933 px, ending before the P/T", () => {
    for (const p of [retro, land]) {
      const f = p.footer!;
      expect(f.prefix).toBe("Illus. ");
      expect(f.align).toBe("center");
      expect(f.uppercase).toBeUndefined();
      expect(f.letterSpacingEm).toBeUndefined();
      expect(footerArtistLine(f, "Donato Giancola")).toBe("Illus. Donato Giancola");
      const centre = ((f.rect.leftPct + f.rect.widthPct / 2) / 100) * HD_W;
      expect(Math.abs(centre - 748)).toBeLessThanOrEqual(1);
      const baseline = ((f.rect.topPct + f.rect.heightPct / 2) / 100) * HD_H + TYPE_FACES.body.baselineBelowCentreEm * 58;
      expect(Math.abs(baseline - 1933)).toBeLessThanOrEqual(1);
      // Its box ends where the P/T's ink may start.
      expect(((f.rect.leftPct + f.rect.widthPct) / 100) * HD_W).toBeLessThanOrEqual((p.pt!.inkSpanPct!.leftPct / 100) * HD_W + 0.5);
    }
  });

  it("line 2, the © slot: centred under line 1, baseline 1976 px; black on the white frame, white on every other and on every land", () => {
    for (const p of [retro, land]) {
      const slot = p.copyrightSlot!;
      expect(Math.abs((slot.centerPct / 100) * HD_W - 748)).toBeLessThanOrEqual(1);
      expect((slot.baselinePct / 100) * HD_H).toBeCloseTo(1976, 6);
      // The border mark is not this pair's any more.
      expect(p.brandMark).toBeUndefined();
    }
    for (const key of KEYS) {
      expect(copyrightInk(retro.copyrightSlot!, key), key).toBe(key === "w" ? "#17120c" : WHITE);
      expect(copyrightInk(land.copyrightSlot!, key), key).toBe(WHITE);
    }
    expect(retro.copyrightSlot!.darkMarkKeys).toEqual(["w"]);
    expect(land.copyrightSlot!.darkMarkKeys).toBeUndefined();
  });

  it("on DISPLAY the slot holds the pipglyph.com mark, centred, at the printed line's em — flat dark on the white frame, the standard white elsewhere", () => {
    for (const key of KEYS) {
      const layout = copyrightSlotLayout(retro, key, { kind: "display" })!;
      if (layout.kind !== "brand") throw new Error("expected the mark");
      const { anchor } = layout;
      expect(anchor.sizePct).toBe(RETRO_COPYRIGHT_SIZE_PCT);
      const scale = RETRO_COPYRIGHT_SIZE_PCT / BRAND_MARK_GEOMETRY.fontPct;
      expect(anchor.widthPct).toBeCloseTo(brandMarkWidthPct(scale), 12);
      // Centred on the slot.
      expect(anchor.rightPct - anchor.widthPct / 2).toBeCloseTo(retro.copyrightSlot!.centerPct, 9);
      expect(anchor.baselinePct).toBeCloseTo((1976 / 2100) * 100, 9);
      // Its line box's top: the baseline less the display face's ascent.
      expect(((anchor.baselinePct - anchor.topPct) / 100) * HD_H).toBeCloseTo(TYPE_FACES.display.ascentEm * 33, 6);
      expect(layout.ink).toEqual(key === "w" ? { kind: "flat", colorHex: "#17120c" } : { kind: "light" });
      // A crowned twin's key reads as its plain master.
      expect(copyrightSlotLayout(retro, `${key}-legendary`, { kind: "display" })).toEqual(layout);
    }
    expect(BRAND_MARK_LIGHT_INK).toBe("rgba(255,255,255,0.82)");
    expect(BRAND_MARK_LIGHT_SHADOW).toBe("0 1px 3px rgba(0,0,0,0.8)");
    // The whole mark stays on the frame: its ink ends above the frame's
    // bottom edge (2019 px), inside the footer strip.
    const mark = copyrightSlotLayout(retro, "r", { kind: "display" })!;
    if (mark.kind !== "brand") throw new Error("expected the mark");
    expect((mark.anchor.baselinePct / 100) * HD_H + TYPE_FACES.display.descentEm * 33).toBeLessThan(2008);
  });

  it("on a paid CLEAN DOWNLOAD the slot prints the card's footer text — centred, MPlantin 33 px, the line's printed ink — or nothing", () => {
    const text = "Red Jester's Cube 2026";
    for (const key of KEYS) {
      const layout = copyrightSlotLayout(retro, key, { kind: "download", footerText: `  ${text} ` })!;
      if (layout.kind !== "text") throw new Error("expected the footer text");
      expect(layout.text).toBe(text);
      expect(layout.face).toBe(TYPE_FACES.body);
      expect(layout.sizePct).toBe(RETRO_COPYRIGHT_SIZE_PCT);
      expect(layout.colorHex).toBe(key === "w" ? "#17120c" : WHITE);
      expect(layout.widthPct).toBeCloseTo(rulesTextWidthEm(text) * RETRO_COPYRIGHT_SIZE_PCT * 100, 9);
      expect(layout.xPct + layout.widthPct / 2).toBeCloseTo(retro.copyrightSlot!.centerPct, 9);
      expect(layout.baselinePct).toBeCloseTo((1976 / 2100) * 100, 9);
      expect(layout.lineHeight).toBeCloseTo(TYPE_FACES.body.ascentEm + TYPE_FACES.body.descentEm, 12);
    }
    for (const none of [null, undefined, "", "   "]) expect(copyrightSlotLayout(retro, "r", { kind: "download", footerText: none })).toEqual({ kind: "none" });
    // Forty W's: cut with ONE "…" at the slot's width (half the card).
    const cut = copyrightSlotLayout(retro, "r", { kind: "download", footerText: "W".repeat(40) })!;
    if (cut.kind !== "text") throw new Error("expected the footer text");
    expect(cut.text.endsWith("…")).toBe(true);
    expect(cut.text.match(/…/g)).toHaveLength(1);
    expect(cut.widthPct).toBeLessThanOrEqual(retro.copyrightSlot!.maxWidthPct * 100 + 1e-9);
    expect(cut.widthPct).toBeGreaterThan(retro.copyrightSlot!.maxWidthPct * 100 - 4);
  });

  it("no other profile has the slot — but the 2003 pair (TODO 4.10b): their mark stays on the border and their footer keeps its own custom text", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const has = ["retro", "retroland", "modern", "modernland"].includes(template);
      expect(Boolean(getFrameProfile(template).copyrightSlot), template).toBe(has);
      if (!has) expect(copyrightSlotLayout(getFrameProfile(template), "w", { kind: "display" }), template).toBeNull();
    }
  });
});

describe('symbolStyle "1997" — flat discs, the 1997 tap', () => {
  it("is the pair's style: no shadow in either renderer or either shadow model, {T} = mana-font's tap-4ed", () => {
    for (const p of [retro, land]) {
      const style = symbolStyleOf(p);
      expect(style).toBe(SYMBOL_STYLES["1997"]);
      expect(style.discShadow).toBeNull();
      expect(style.previewShadowClass).toBeNull();
      expect(style.previewShadowCss).toBeNull();
      expect(style.costRowShadowDiscs).toBe(0);
      expect(discShadowPx(style, 73)).toEqual({ left: 0, down: 0 });
      expect(discShadowCss(style, 73)).toBeUndefined();
      expect(styledSuffix(style, "tap")).toBe("tap-4ed");
      // Every other symbol is the font's own drawing.
      for (const suffix of ["w", "u", "b", "r", "g", "2", "x", "untap"]) expect(styledSuffix(style, suffix)).toBe(suffix);
    }
    // "modern" is untouched.
    expect(discShadowCss(SYMBOL_STYLES.modern, 60)).toBe("-4px 4px 0 #111");
    expect(styledSuffix(SYMBOL_STYLES.modern, "tap")).toBe("tap");
  });
});

describe("the rules box — ONE rect fitted to the smallest of the pair's text boxes", () => {
  it("sets the text inside every key's box: 192–1308 × 1288–1828 px, within the common inner box 175–1325 × 1276–1846", () => {
    for (const p of [retro, land]) {
      const r = p.rules.rect;
      const [x0, x1, y0, y1] = [(r.leftPct / 100) * HD_W + 9, ((r.leftPct + r.widthPct) / 100) * HD_W - 9, (r.topPct / 100) * HD_H + 18, ((r.topPct + r.heightPct) / 100) * HD_H - 18];
      expect(x0).toBeGreaterThanOrEqual(175 + 15);
      expect(x1).toBeLessThanOrEqual(1325 - 15);
      expect(y0).toBeGreaterThanOrEqual(1276 + 10);
      expect(y1).toBeLessThanOrEqual(1846 - 15);
      expect(p.rules.padPx).toBeUndefined();
    }
  });
});

describe("layout v46 — the 1997 frame's bump", () => {
  it("is ONE version in one constant: a sweep, never a badge, scoped to the pair — every other template stamps", async () => {
    const lv = await import("@/lib/cards/layout-version");
    const V = lv.RETRO_1997_LAYOUT_VERSION;
    expect(Number.isInteger(V)).toBe(true);
    expect(V).toBeGreaterThan(lv.BATTLE_RECUT_LAYOUT_VERSION);
    expect(lv.CARD_LAYOUT_VERSION).toBeGreaterThanOrEqual(V);
    expect(lv.VERSION_ROLLOUT[V]).toBe("sweep");
    expect(lv.rolloutPolicy(V)).toBe("sweep");
    expect(lv.latestOptInVersion()).toBe(22);
    expect([...lv.RETRO_1997_TEMPLATES]).toEqual(["retro", "retroland"]);
    expect(lv.VERSION_SCOPES[V]).toBeUndefined();
    for (const t of FRAME_TEMPLATE_VALUES) expect(isRenderStale(V - 1, t, undefined, V), t).toBe(t === "retro" || t === "retroland");
    // NOT verification-neutral: the masters and every slot move (no tick
    // exists on the pair; the first ticks follow the merge).
    expect(lv.VERIFICATION_NEUTRAL_VERSIONS).not.toContain(V);
    expect([...lv.VERIFICATION_SCOPED_VERSIONS[V]]).toEqual(["retro", "retroland"]);
    const { verificationState } = await import("@/lib/cards/frame-verification-state");
    const tick = { verified: true, verifiedLayoutVersion: V - 1, verifiedOverrideHash: "h" } as const;
    expect(verificationState(tick, "retro", "h", V)).toMatchObject({ verified: true, stale: true });
    for (const t of ["modern", "modernland", "agclassic", "m15", "battle"]) expect(verificationState(tick, t, "h", V).stale, t).toBe(false);
  });
});

describe("imports — the 1997 frame is the ORIGINAL printing (era design D14)", () => {
  const printing = (over: Partial<ScryfallCard>) =>
    ({
      id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
      name: "Probe",
      frame: "1997",
      border_color: "black",
      type_line: "Creature — Elf",
      mana_cost: "{G}",
      colors: ["G"],
      ...over,
    }) as ScryfallCard;

  it("an original (1996–2003) is exact on the retro family", () => {
    for (const released_at of ["1996-10-08", "2002-10-07", "2003-05-26", "2005-12-31"]) {
      expect(frameMatchFromScryfall(printing({ released_at })), released_at).toMatchObject({ status: "exact", template: "retro", signature: "era/1997" });
    }
    expect(frameMatchFromScryfall(printing({ released_at: "2002-10-07", type_line: "Land", mana_cost: "", colors: [] }))).toMatchObject({
      status: "exact",
      template: "retroland",
    });
  });

  it("a Time Spiral timeshifted card (2006) is NEAREST — a redrawn old frame: its art window sits 10 px lower, its blue is another blue", () => {
    expect(RETRO_TIMESHIFTED_FROM).toBe("2006-01-01");
    for (const released_at of ["2006-10-06", "2020-12-31"]) {
      expect(frameMatchFromScryfall(printing({ released_at })), released_at).toMatchObject({
        status: "nearest",
        template: "retro",
        signature: "era/1997+timeshifted-frame",
        blockedBy: "4.10e",
        reason: "PipGlyph's 1997 frame is the original 1996–2003 printing; the timeshifted frame is a later redrawing (its art sits lower, its blue differs)",
        gaps: ["timeshifted-frame"],
      });
    }
    // A 2021+ reprint names its own gap, never this one.
    expect(frameMatchFromScryfall(printing({ released_at: "2021-03-19" })).gaps).toEqual(["reprint-colours"]);
  });

  it("a 2021+ reprint on the frame is NEAREST — its frame is lighter than ours — blocked by 4.10e", () => {
    expect(RETRO_REPRINT_COLOURS_FROM).toBe("2021-01-01");
    for (const [released_at, type_line, template] of [
      ["2021-03-19", "Creature — Elf", "retro"], // Time Spiral Remastered
      ["2023-01-13", "Land", "retroland"], // Dominaria Remastered
      ["2025-01-24", "Creature — Elf", "retro"], // Innistrad Remastered
    ] as const) {
      expect(frameMatchFromScryfall(printing({ released_at, type_line })), released_at).toMatchObject({
        status: "nearest",
        template,
        signature: "era/1997+reprint-colours",
        blockedBy: "4.10e",
        reason: "PipGlyph's 1997 frame is the original 1996–2003 printing; this reprint's frame is lighter",
        gaps: ["reprint-colours"],
      });
    }
    // The day before the constant is not this gap's, and a printing with
    // no date is neither's.
    expect(frameMatchFromScryfall(printing({ released_at: "2020-12-31" })).gaps).toEqual(["timeshifted-frame"]);
    expect(frameMatchFromScryfall(printing({})).status).toBe("exact");
    // Another gap names itself first; the reprint gap rides along.
    expect(frameMatchFromScryfall(printing({ released_at: "2023-01-13", border_color: "white" }))).toMatchObject({
      status: "nearest",
      blockedBy: "4.30",
      gaps: ["border", "reprint-colours"],
    });
    // The 2003 and 2015 frames never carry it.
    for (const frame of ["2003", "2015", "1993"]) {
      expect(frameMatchFromScryfall(printing({ frame, released_at: "2023-01-13" })).gaps ?? [], frame).not.toContain("reprint-colours");
    }
  });
});
