// ---------------------------------------------------------------------------
// Double-faced cards (DFC) — the pure vocabulary (TODO 5.0a; design
// 2026-10-02, design-next/5/final.md §2.1, §3.1, D2, D6).
//
// A DFC has two printed FACES: a transform card (ISD, SOI, MID, BOT…) or a
// modal double-faced card (ZNR, KHM, STX…). ONE card row holds both (owner
// decision Q1): the front is the card, the back is `cards.back_face` with
// its own body (`frame_style.template`) and colour. A two-part layout (flip,
// split, aftermath, adventure) is ONE face whose master paints a second
// panel — not a DFC (templatePaintsSecondFace, lib/creator/card-kinds.ts).
//
// Bodies are profiles whose PROFILES entry declares `dfc` (FrameProfile.dfc,
// lib/cards/template-layout.ts): a FRONT body is a card's template, a BACK
// body is the back face's and is never a front. 5.1a brought the five
// transform bodies (`m15dfcfront`, `m15dfcback` — the ▼-right back, the
// default — `m15dfcbackleft` — the 2016–22 back — and the land pair);
// 5.1b brings the four modal ones, so `bodyFor` still answers null for a
// modal face. Additions: no stored card's look changes.
//
// Pure and client-safe: the creator, the actions, the import, the remix and
// both renderers read these same functions.
// ---------------------------------------------------------------------------

import { isArtifactFrameType, type FrameTypeInfo } from "@/components/cards/frame-layer";
import { DFC_ICON_GLYPHS, dfcIconGlyph } from "@/lib/cards/dfc-icons";
import { getFrameProfile, type DfcProfile } from "@/lib/cards/template-layout";
import { DFC_ICON_FAMILY_VALUES, type DfcIconFamily, type FrameTemplate } from "@/types/card";

export { DFC_ICON_FAMILY_VALUES, DFC_ICON_GLYPHS, dfcIconGlyph, type DfcIconFamily, type DfcProfile };

export type DfcLayout = DfcProfile["layout"];
export type DfcRole = DfcProfile["role"];

/** The family a transform card wears when its `frame_style.dfcIcon` names
 *  none — today's ▲ / ▼ with the ▼ at the right, every transform printed
 *  since 2022-11 (owner decision Q5, 2026-10-02). */
export const DEFAULT_DFC_ICON: DfcIconFamily = "arrows";

export function isDfcIconFamily(value: unknown): value is DfcIconFamily {
  return typeof value === "string" && (DFC_ICON_FAMILY_VALUES as readonly string[]).includes(value);
}

/** The `dfc` declaration of a template's CODE profile, or null — an unknown
 *  or legacy template reads as m15, which declares none. */
export function dfcBodyOf(template: FrameTemplate | string | null | undefined): DfcProfile | null {
  return getFrameProfile(template ?? undefined).dfc ?? null;
}

/** A card on this FRONT template has a back face of its own: the template
 *  is a DFC front body. (The design's `profile.dfc != null`, narrowed to the
 *  front role: a back body is never a card's template, so the two agree on
 *  every legal card.) `templatePaintsSecondFace` stays the inline
 *  predicate — a DFC body paints no second panel, so the preview's flip
 *  keeps working on it. */
export function templateHasBackFace(template: FrameTemplate | string | null | undefined): boolean {
  return dfcBodyOf(template)?.role === "front";
}

/** The template is a BACK body — what `back_face.frame_style.template` may
 *  name, and never a card's own template. */
export function isDfcBackBody(template: FrameTemplate | string | null | undefined): boolean {
  return dfcBodyOf(template)?.role === "back";
}

/** The face type a body is keyed by: a land face wears the land pair. */
type DfcFaceKind = "land" | "spell";

type DfcBodyKey = `${DfcLayout}/${DfcRole}/${DfcFaceKind}`;

/** A body per (layout, role, face kind) — or, for the transform BACK, one
 *  per icon family: `arrows` → the ▼-right back (every transform printed
 *  since 2022-11), the four left families → the 2016–22 back (the icon in
 *  the left well). The transform rows are 5.1a's; the modal rows come with
 *  5.1b, so a modal face has no body yet and bodyFor answers null for it. */
const DFC_BODIES: Partial<Record<DfcBodyKey, FrameTemplate | Partial<Record<DfcIconFamily, FrameTemplate>>>> = {
  "transform/front/spell": "m15dfcfront",
  "transform/front/land": "m15dfclandfront",
  "transform/back/spell": {
    arrows: "m15dfcback",
    sunmoon: "m15dfcbackleft",
    moon: "m15dfcbackleft",
    compass: "m15dfcbackleft",
    fan: "m15dfcbackleft",
  },
  // The 2016–22 land back is the parchment frame (TODO 5.8): every family's
  // land back is this one meanwhile (nearest for an XLN / RIX / LCI import).
  "transform/back/land": "m15dfclandback",
};

/** The icon family a printing's `frame_effects` name (frames.md §4.6): the
 *  sun / moon (SOI, EMN, MID, VOW), moon / Emrakul (EMN), compass / land
 *  (XLN, RIX, LCI) and fan (NEO) families by their effect; `convertdfc`
 *  (BOT) and no effect at all (MOM, LCI, MH3, FIN, TLA, ECL, INR) are the
 *  plain ▲ / ▼. `originpwdfc` (ORI's walkers) has no body in wave 1 and
 *  reads as the default too. */
export function dfcIconFamilyFromEffects(effects: readonly string[] | null | undefined): DfcIconFamily {
  const set = new Set((effects ?? []).map((e) => e.toLowerCase()));
  if (set.has("sunmoondfc")) return "sunmoon";
  if (set.has("mooneldrazidfc")) return "moon";
  if (set.has("compasslanddfc")) return "compass";
  if (set.has("fandfc")) return "fan";
  return DEFAULT_DFC_ICON;
}

/** The back body a transform card's family derives — the ONE place the
 *  creator's family chips, the save and the import ask which back the card
 *  wears (bodyFor's transform/back/spell row), or null for a land back
 *  (which is the land back whatever the family). */
export function transformBackBodyFor(family: DfcIconFamily, backFaceType: string | null | undefined): FrameTemplate | null {
  return bodyFor("transform", "back", backFaceType, family);
}

/**
 * The ONE table the creator, the server gate, the import and the remix read:
 * the body a face draws on, from the card's layout, the face's role, its
 * card type (a land face wears the land pair, whatever the family — the
 * 2016–22 parchment land back is wave 2, TODO 5.8) and, for a transform
 * back, the card's icon family (D6: the icon side is the body, the glyph the
 * rider). null when no body exists for that face yet.
 */
export function bodyFor(
  layout: DfcLayout,
  role: DfcRole,
  faceType: string | null | undefined,
  family: DfcIconFamily = DEFAULT_DFC_ICON,
): FrameTemplate | null {
  const entry = DFC_BODIES[`${layout}/${role}/${faceType === "land" ? "land" : "spell"}`];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry[family] ?? null;
}

/**
 * Whether a face may wear the colourless `c` key on `template` (D2, design
 * 2026-10-02): on a DFC body the `c` row is the ARTIFACT master standing in
 * (every DFC pack's colourless frame is its artifact one), so it is offered
 * only to a face whose type line says Artifact — never to a colourless
 * Eldrazi or Avatar face, whose see-through frame is wave 2 (TODO 5.11). On
 * any other template the ordinary frame gate decides, so this answers true.
 */
export function colorlessFaceAllowed(
  template: FrameTemplate | string | null | undefined,
  face: FrameTypeInfo | null | undefined,
): boolean {
  if (!dfcBodyOf(template)) return true;
  return isArtifactFrameType(face);
}

/**
 * Why a back face's BODY can't be stored on a card whose front is
 * `frontTemplate`, or null when it can — the server's gate (createCardAction /
 * updateCardAction, field error `back_face.frame_style`): a card whose front
 * has no back face carries no back body, and a body must be a back body. A
 * back face WITHOUT a body (the 8 imported DFCs, every inline layout) is
 * always fine. 5.2 adds the finer rule — the body must equal
 * `bodyFor(layout, "back", back type, family)` and be verified in the back's
 * colour.
 */
export function backBodyError(
  frontTemplate: FrameTemplate | string | null | undefined,
  backFace: ({ frame_style?: { template?: string } | null } & Record<string, unknown>) | null | undefined,
): string | null {
  const body = backFace?.frame_style?.template;
  if (!body) return null;
  if (!templateHasBackFace(frontTemplate)) return "This frame has no back face of its own.";
  if (!isDfcBackBody(body)) return "Not a back-face frame.";
  return null;
}
