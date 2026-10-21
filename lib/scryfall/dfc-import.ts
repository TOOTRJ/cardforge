import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { isArtifactFrameType } from "@/components/cards/frame-layer";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { DEFAULT_DFC_ICON, SAGA_BACK_BODY, bodyFor, dfcBodyOf, dfcLookOf, isBattleFront, isDfcBackBody, isSagaFront, templateHasBackFace, type DfcLayout } from "@/lib/cards/dfc";
import { dfcFamilyOf } from "@/lib/cards/dfc-gate";
import { dfcLayoutForKind, kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";
import { tokenBackBodyFor } from "@/lib/creator/token-back";
import { isTokenPairFront } from "@/lib/cards/token-faces";
import type { CardType, ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Where an imported double-faced printing LANDS (TODO 5.4; design 2026-10-02
// §2.4, §4, §5 — owner Q5: imports follow the printing's family, per face).
//
// The mapper (lib/scryfall/import-mapper.ts dfcImportOf) says which bodies a
// transform / modal printing wears — the front body for the front's type,
// the back body for the back's type and the printing's icon family — and
// writes them on the patch (`kind`, `frame_template`, `back_face.frame_style`,
// `back_face.color_identity`, `printed_dfc_icon`). Whether the card may
// SAVE there is a question of the verified combos: the front body in the
// front's colour AND the back body in the back's colour (the server's gate,
// lib/cards/dfc-gate.ts, refuses either unverified). This module answers it
// ONCE for the creator (finalizeImportMatch in lib/creator/frame-resolve.ts
// downgrades the patch to today's landing — the front's standard frame with
// a legacy back — when it says no) and for the AI deck remix (remixFrameFor
// falls to the standard path), so the two never disagree on a printing.
//
// Pure and client-safe: no I/O, a type-only import of the patch.
// ---------------------------------------------------------------------------

/** The AI deck remix's credits for a double-faced entry: two pictures, one
 *  per face (owner decision Q4, 2026-10-02). */
export const DFC_REMIX_CREDITS = 2;

export type DfcImportLanding =
  | {
      ok: true;
      kind: "transform" | "mdfc" | "battle" | "saga";
      frontBody: FrameTemplate;
      backBody: FrameTemplate;
      /** The back's stored colour (its own; the front's when it names none). */
      backColorIdentity: ColorIdentity[];
    }
  | {
      ok: false;
      /** "not-dfc": the patch doesn't land on a double-faced body at all. */
      reason: "not-dfc" | "front-unverified" | "back-unverified";
      /** The unverified body and the colour key it was asked for. */
      template?: FrameTemplate;
      colorKey?: string;
    };

type DfcPatch = Pick<
  ScryfallImportPatch,
  "kind" | "frame_template" | "card_type" | "supertype" | "back_face" | "printed_dfc_icon"
> & { color_identity?: readonly ColorIdentity[] };

/** The DFC layout a patch lands on, or null: a Transform / Modal kind on
 *  its front body, or a BATTLE (TODO 5.5) on the battle frame with a back
 *  that names its body — a battle with no back, or a legacy one, is not a
 *  double-faced landing (its back is optional). */
function landingLayoutOf(patch: Pick<ScryfallImportPatch, "kind" | "frame_template" | "back_face">): DfcLayout | null {
  const front = patch.frame_template;
  if (!patch.kind || !front || !templateHasBackFace(front)) return null;
  if (patch.kind === "battle") {
    const backBody = patch.back_face?.frame_style?.template;
    return isBattleFront(front) && backBody && isDfcBackBody(backBody) ? (dfcBodyOf(front)?.layout ?? null) : null;
  }
  // A transforming Saga (TODO 5.5 (b)) on the double-faced saga front.
  if (patch.kind === "saga") return isSagaFront(front) ? (dfcBodyOf(front)?.layout ?? null) : null;
  return dfcLayoutForKind(patch.kind);
}

/** True when the mapper put this patch on a double-faced body: a DFC kind
 *  with the front body named, or a battle with a back of its own. */
export function isDfcImportPatch(patch: Pick<ScryfallImportPatch, "kind" | "frame_template"> & Partial<Pick<ScryfallImportPatch, "back_face">>): boolean {
  return landingLayoutOf(patch) !== null;
}

/**
 * Whether a DFC import patch may save on its bodies: the front body in the
 * front's colour and the back body — `bodyFor` of the layout, the back's
 * type and the family, exactly what the gate derives — in the back's colour
 * must both be verified (`isFrameComboAvailable`). `ok: false, reason:
 * "not-dfc"` for any other patch.
 */
export function dfcImportLanding(patch: DfcPatch, verifiedKeys: ReadonlySet<string>): DfcImportLanding {
  const kind = patch.kind;
  const layout = landingLayoutOf(patch);
  const frontBody = patch.frame_template;
  if (!kind || !layout || !frontBody || (kind !== "transform" && kind !== "mdfc" && kind !== "battle" && kind !== "saga")) {
    return { ok: false, reason: "not-dfc" };
  }
  const frontKey = pickFrameColorKey(patch.color_identity);
  if (!isFrameComboAvailable(frontBody, frontKey, verifiedKeys)) {
    return { ok: false, reason: "front-unverified", template: frontBody, colorKey: frontKey };
  }
  const back = patch.back_face;
  const backBody =
    back?.frame_style?.template ??
    bodyFor(layout, "back", back?.card_type ?? null, kind === "battle" ? DEFAULT_DFC_ICON : dfcFamilyOf(patch.printed_dfc_icon));
  if (!backBody) return { ok: false, reason: "not-dfc" };
  const backColorIdentity: ColorIdentity[] =
    back?.color_identity && back.color_identity.length > 0
      ? [...back.color_identity]
      : [...(patch.color_identity ?? [])];
  const backKey = pickFrameColorKey(backColorIdentity);
  if (!isFrameComboAvailable(backBody, backKey, verifiedKeys)) {
    return { ok: false, reason: "back-unverified", template: backBody, colorKey: backKey };
  }
  return { ok: true, kind, frontBody, backBody, backColorIdentity };
}

/**
 * The same patch on the BORDERED bodies (TODO 5.7): a dark borderless
 * printing's faces moved onto the M15 bodies its layout, types and family
 * derive — where every borderless DFC import landed before 5.7, and where
 * it still lands until both borderless combos are verified
 * (finalizeImportMatch). The patch itself for any other patch, or when a
 * face has no bordered body.
 */
export function withBorderedDfcBodies<P extends DfcPatch>(patch: P): P {
  if (!isDfcImportPatch(patch) || dfcLookOf(patch.frame_template) !== "borderless") return patch;
  const layout = dfcBodyOf(patch.frame_template)?.layout;
  if (!layout) return patch;
  const family = dfcFamilyOf(patch.printed_dfc_icon);
  const front = bodyFor(layout, "front", patch.card_type ?? null, family);
  const backType = patch.back_face?.card_type ?? null;
  const back = bodyFor(layout, "back", backType, family);
  if (!front || !back) return patch;
  return {
    ...patch,
    frame_template: front,
    ...(patch.back_face ? { back_face: { ...patch.back_face, frame_style: { template: back } } } : {}),
  };
}

/** The kind an import falls back to when its double-faced landing isn't
 *  available: the front face's own standard kind (a creature, a land…). */
export function dfcFallbackKind(patch: Pick<ScryfallImportPatch, "card_type">): CardKind {
  return kindFromCard(patch.card_type as CardType | undefined, undefined);
}

/** The frame that fallback lands on: the M15 standard of the front's type —
 *  its artifact dress for an Artifact Creature, as kindFallback in the
 *  registry (lib/scryfall/frame-signatures.ts) picks it. */
export function dfcFallbackTemplate(patch: Pick<ScryfallImportPatch, "card_type" | "supertype">): FrameTemplate {
  const cardType = (patch.card_type ?? "creature") as CardType;
  const standard = standardFrameFor("m15", cardType) ?? "m15";
  return standard === "m15" && isArtifactFrameType({ cardType, supertype: patch.supertype }) ? "m15artifact" : standard;
}

/**
 * The patch as it lands when the double-faced bodies aren't available
 * (today's landing, byte for byte what the import did before 5.4): the
 * front's standard kind and frame, the back face kept as a LEGACY back —
 * its content, with no body and no colour of its own (a body under a
 * standard front is refused by the gate; a legacy back draws on the front's
 * template and colour). The match is the caller's business (it names the
 * reason). The family (`printed_dfc_icon`) stays: the save drops the key on
 * a frame that draws none.
 */
export function withoutDfcLanding<P extends DfcPatch>(patch: P): P {
  if (!isDfcImportPatch(patch)) return patch;
  const back = patch.back_face;
  let legacyBack: P["back_face"] = back;
  if (back) {
    const { frame_style: _body, color_identity: _colour, ...content } = back;
    void _body;
    void _colour;
    legacyBack = content as P["back_face"];
  }
  // A battle keeps its kind and frame (TODO 5.5): only its back goes back
  // to the legacy back every battle import stored before — its body off,
  // its printed colour kept for the creator, which then knows the back's
  // body isn't published in it (lib/creator/battle-back.ts: a legacy back,
  // never the front's colour in its place). A legacy back's colour is never
  // drawn (it draws on the front's frame) and the save sends none.
  if (patch.kind === "battle" && back) {
    const { frame_style: _battleBody, ...battleLegacy } = back;
    void _battleBody;
    return { ...patch, back_face: battleLegacy as P["back_face"] };
  }
  // A transforming Saga (TODO 5.5 (b)) keeps its kind and goes back to the
  // one-faced saga frame with a LEGACY back — byte for byte what its import
  // stored before (the Saga kind names no frame: its layout template).
  if (patch.kind === "saga") {
    // (…and no family: main's patch named none for a Saga.)
    const { printed_dfc_icon: _family, ...rest } = patch;
    void _family;
    return { ...rest, frame_template: undefined, back_face: legacyBack } as P;
  }
  // A Saga BACK (TODO 5.5 (b), PR 2: MOM's praetors, LCI #189) goes back to
  // exactly what its import stored before its body existed — and that patch
  // named no family (the printing never reached the bodies).
  if (back?.frame_style?.template === SAGA_BACK_BODY) {
    const { printed_dfc_icon: _family, ...rest } = patch;
    void _family;
    return { ...rest, kind: dfcFallbackKind(patch), frame_template: dfcFallbackTemplate(patch), back_face: legacyBack } as P;
  }
  return {
    ...patch,
    kind: dfcFallbackKind(patch),
    frame_template: dfcFallbackTemplate(patch),
    back_face: legacyBack,
  };
}

// ---------------------------------------------------------------------------
// Double-sided tokens (TODO 5.5 (c), owner Round 76): two tokens back to
// back. The mapper names the back's token template (mapTokenBackFacePatch);
// whether the card may SAVE with both faces is the same question as a DFC's
// — the front's token in the front's colour AND the back's token (derived
// again here for the front the import lands on: the registry may land a
// full-art printing on the arch while the full-art token waits for a tick)
// in the back's colour. Short of either, the import is exactly what it was
// before: the front alone, the back dropped with today's toast.
// ---------------------------------------------------------------------------

type TokenPairPatch = Pick<ScryfallImportPatch, "kind" | "frame_template" | "back_face" | "dropped_face"> & {
  color_identity?: readonly ColorIdentity[];
};

/** True when the mapper put this patch on a double-sided token's pair: the
 *  token kind with a back that names its body. */
export function isTokenPairImportPatch(patch: Pick<ScryfallImportPatch, "kind" | "back_face">): boolean {
  return patch.kind === "token" && Boolean(patch.back_face?.frame_style?.template);
}

/** The pair as it lands on `verifiedKeys`: the patch with its back's body
 *  derived for the patch's front, or the front alone (`dropped_face`
 *  "double-faced-token", no back — byte for byte the import before 5.5 (c))
 *  when either face's token isn't verified in its colour. */
export function tokenPairImportLanding<P extends TokenPairPatch>(patch: P, verifiedKeys: ReadonlySet<string>): P {
  const back = patch.back_face;
  const front = patch.frame_template;
  if (!back || !isTokenPairImportPatch(patch)) return patch;
  const backColour: ColorIdentity[] =
    back.color_identity && back.color_identity.length > 0 ? [...back.color_identity] : [...(patch.color_identity ?? [])];
  const body = isTokenPairFront(front)
    ? tokenBackBodyFor(front, {
        supertype: back.supertype,
        subtypes: back.subtypes_text,
        rulesText: back.rules_text,
        flavorText: back.flavor_text,
        power: back.power,
        toughness: back.toughness,
        colorIdentity: backColour,
      })
    : null;
  if (
    front &&
    body &&
    isFrameComboAvailable(front, pickFrameColorKey(patch.color_identity), verifiedKeys) &&
    isFrameComboAvailable(body, pickFrameColorKey(backColour), verifiedKeys)
  ) {
    return { ...patch, back_face: { ...back, color_identity: backColour, frame_style: { template: body } } };
  }
  const { back_face: _back, ...rest } = patch;
  void _back;
  return { ...rest, dropped_face: "double-faced-token" } as P;
}
