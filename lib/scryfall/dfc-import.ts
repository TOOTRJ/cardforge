import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import { isArtifactFrameType } from "@/components/cards/frame-layer";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { bodyFor, templateHasBackFace } from "@/lib/cards/dfc";
import { dfcFamilyOf } from "@/lib/cards/dfc-gate";
import { dfcLayoutForKind, kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import { standardFrameFor } from "@/lib/creator/frame-picker";
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
      kind: "transform" | "mdfc";
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

/** True when the mapper put this patch on a double-faced body: a DFC kind
 *  with the front body named. */
export function isDfcImportPatch(patch: Pick<ScryfallImportPatch, "kind" | "frame_template">): boolean {
  return Boolean(patch.kind && dfcLayoutForKind(patch.kind) && patch.frame_template && templateHasBackFace(patch.frame_template));
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
  const layout = kind ? dfcLayoutForKind(kind) : null;
  const frontBody = patch.frame_template;
  if (!kind || !layout || !frontBody || !templateHasBackFace(frontBody) || (kind !== "transform" && kind !== "mdfc")) {
    return { ok: false, reason: "not-dfc" };
  }
  const frontKey = pickFrameColorKey(patch.color_identity);
  if (!isFrameComboAvailable(frontBody, frontKey, verifiedKeys)) {
    return { ok: false, reason: "front-unverified", template: frontBody, colorKey: frontKey };
  }
  const back = patch.back_face;
  const backBody =
    back?.frame_style?.template ??
    bodyFor(layout, "back", back?.card_type ?? null, dfcFamilyOf(patch.printed_dfc_icon));
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
  return {
    ...patch,
    kind: dfcFallbackKind(patch),
    frame_template: dfcFallbackTemplate(patch),
    back_face: legacyBack,
  };
}
