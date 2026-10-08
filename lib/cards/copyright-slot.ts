// ---------------------------------------------------------------------------
// The © slot of a two-line footer (TODO 4.10a, layout v46 — centred, the
// 1997 frame; TODO 4.10b — set from its left end, the 2003 frame; era
// design 2026-10-06, decision D2) — what FrameProfile.copyrightSlot draws,
// decided ONCE for both renderers and the print path (which renders through
// the bake). Client-safe.
//
// The 1997 prints set `Illus. <artist>` over a centred © line. PipGlyph
// prints no Wizards line; the collector line's precedent (owner 2026-09-29)
// says what the slot holds instead:
//
//   display surfaces      the pipglyph.com mark, centred on the slot, at the
//                         printed line's em — so the mark is ON the frame
//                         and no longer on the border. Its standard white
//                         (with its own soft shadow) on every master but
//                         those in `darkMarkKeys`, where the print's line is
//                         dark and the mark takes that ink, flat (the
//                         brand's single-ink treatment);
//   a paid clean download the card's `footer_text`, centred, in the slot's
//                         face and the line's printed ink, no shadow; cut
//                         with ONE "…" past `maxWidthPct`;
//   …with no footer text  nothing.
//
// Before this slot a centred footer DROPPED a paid viewer's custom footer
// text (TextSlot.prefix: "a custom mark then has no place on this line").
// ---------------------------------------------------------------------------

import { BRAND_MARK_GEOMETRY, brandMarkWidthPct, type CollectorMarkAnchor, type CollectorSurface } from "@/lib/cards/collector-layout";
import { displayTextWidthEm, truncateDisplayLine } from "@/lib/cards/display-metrics";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import { baseMasterKey } from "@/lib/cards/master-key";
import { slotInk, type CopyrightSlot, type FrameProfile } from "@/lib/cards/template-layout";
import { BRAND_FACE, slotFace, TEXT_DEFAULT_FACE, type TypeFace } from "@/lib/cards/type-faces";
import type { FrameMasterKey } from "@/lib/cards/frame-reference-registry";

/** The mark's standard ink and shadow — the renderers' own (the border
 *  mark's and the collector slot's): 82 % white, a soft 1 px shadow. */
export const BRAND_MARK_LIGHT_INK = "rgba(255,255,255,0.82)";
export const BRAND_MARK_LIGHT_SHADOW = "0 1px 3px rgba(0,0,0,0.8)";

export type CopyrightMarkInk =
  /** The standard white mark with its soft shadow. */
  | { kind: "light" }
  /** One flat colour, no shadow: the line's printed ink. */
  | { kind: "flat"; colorHex: string };

export type CopyrightSlotLayout =
  | { kind: "brand"; anchor: CollectorMarkAnchor; ink: CopyrightMarkInk }
  | {
      kind: "text";
      text: string;
      face: TypeFace;
      /** The pen x and the line box's top, % of the card's width / height. */
      xPct: number;
      topPct: number;
      baselinePct: number;
      sizePct: number;
      /** The line box as a multiple of the size: the face's ascent + descent
       *  (so the baseline lands `ascent` em below the top in both
       *  renderers — the collector line's rule). */
      lineHeight: number;
      widthPct: number;
      colorHex: string;
    }
  | { kind: "none" };

const lineBox = (face: TypeFace) => face.ascentEm + face.descentEm;

/** The face a © slot's footer text is set in. */
export function copyrightFace(slot: Pick<CopyrightSlot, "font">): TypeFace {
  return slotFace(slot, TEXT_DEFAULT_FACE);
}

/** The printed ink of the slot's line on master `masterKey`. */
export function copyrightInk(slot: CopyrightSlot, masterKey: string): string {
  return slotInk({ colorHex: slot.colorHex, inkByColorKey: slot.inkByColorKey }, masterKey).colorHex;
}

/**
 * What the © slot of `profile` draws on master `masterKey` for `surface` —
 * null when the profile has no slot (every frame but the centred-footer
 * ones: the border mark and the footer's own custom text, as before).
 * Positions are % of the card's width (x, widths) or height (tops,
 * baselines); sizes are fractions of the width.
 */
export function copyrightSlotLayout(
  profile: Pick<FrameProfile, "copyrightSlot" | "orientation">,
  masterKey: string,
  surface: CollectorSurface,
): CopyrightSlotLayout | null {
  const slot = profile.copyrightSlot;
  if (!slot) return null;
  const aspect = profile.orientation === "landscape" ? 1500 / 2100 : 2100 / 1500;
  // % of the height one unit of "fraction of the width" is.
  const emToHeightPct = (sizePct: number, em: number) => (em * sizePct * 100) / aspect;
  const ink = copyrightInk(slot, masterKey);
  if (surface.kind === "display") {
    // The mark at the slot's em: its text at `sizePct`, star and gap in
    // proportion (brandMarkWidthPct's scale).
    const scale = slot.sizePct / BRAND_MARK_GEOMETRY.fontPct;
    const widthPct = brandMarkWidthPct(scale);
    const dark = slot.darkMarkKeys?.includes(baseMasterKey(masterKey) as FrameMasterKey) ?? false;
    return {
      kind: "brand",
      anchor: {
        line: 2,
        // Centred on the slot, or (the 2003 frame) starting at its left end.
        rightPct: slot.startPct !== undefined ? slot.startPct + widthPct : slot.centerPct + widthPct / 2,
        baselinePct: slot.baselinePct,
        topPct: slot.baselinePct - emToHeightPct(slot.sizePct, BRAND_FACE.ascentEm),
        sizePct: slot.sizePct,
        lineHeight: lineBox(BRAND_FACE),
        widthPct,
      },
      ink: dark ? { kind: "flat", colorHex: ink } : { kind: "light" },
    };
  }
  const typed = (surface.footerText ?? "").trim();
  if (!typed) return { kind: "none" };
  const face = copyrightFace(slot);
  // The face's own advances: what both renderers lay the run out by.
  const widthEm = (s: string) => (face.id === "display" ? displayTextWidthEm(s) : rulesTextWidthEm(s));
  const text = truncateDisplayLine(typed, slot.maxWidthPct / slot.sizePct, widthEm);
  const widthPct = widthEm(text) * slot.sizePct * 100;
  return {
    kind: "text",
    text,
    face,
    xPct: slot.startPct !== undefined ? slot.startPct : slot.centerPct - widthPct / 2,
    topPct: slot.baselinePct - emToHeightPct(slot.sizePct, face.ascentEm),
    baselinePct: slot.baselinePct,
    sizePct: slot.sizePct,
    lineHeight: lineBox(face),
    widthPct,
    colorHex: ink,
  };
}
