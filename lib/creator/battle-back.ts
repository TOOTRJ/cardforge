// ---------------------------------------------------------------------------
// A battle's back face in the creator (TODO 5.5 (a)).
//
// A battle (the landscape Siege card) is the FRONT of a transform card: its
// back is the portrait ▼ back (`bodyFor("transform", "back", type)` — a
// battle wears no icon family). Unlike a Transform or Modal card its back is
// OPTIONAL (lib/cards/dfc-gate.ts, DfcProfile.battle): a battle saved before
// 5.5 has none, or a LEGACY back (the import's content, no body, drawn on
// the battle frame), and an edit never moves either — a back's body and
// colour are structure, like the front's frame.
//
// So the creator edits a battle's back as a face of its own (the Front face
// | Back face switch, BACK_FIELD_STEP) only where that back IS one:
//   • a NEW battle (create, an import, a draft) — once the ▼ back is
//     published in some colour (the back's colour chips offer only its
//     published ones), with its back face on from the start (every printed
//     battle has one) and a "Faces" switch on the Card step (owner Round 68:
//     the back is OPTIONAL — "One face" saves the battle alone, no
//     back_face, one PNG, exactly as before 5.5);
//   • an edit or remix of a battle whose STORED back has a body.
// An edit or remix of a battle with no back, or a legacy one, keeps today's
// editor: the switch with its Back tab greyed and the reason under it.
//
// The body a back saves on (and the live preview draws) is the ▼ back only
// while it is published in the back's colour (its own, else the front's):
// short of that — an import whose back the verification sent back to a
// legacy back (finalizeImportMatch), keeping the printing's colour — the
// back stays a legacy back, as the import said. On an edit the stored body
// wins at the server's gate whatever is sent.
//
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import { DEFAULT_DFC_ICON, bodyFor, isDfcBackBody } from "@/lib/cards/dfc";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { templateHasAvailableColor } from "@/lib/creator/card-kinds";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

type StoredBack = { frame_style?: { template?: string } | null } | null | undefined;

/** The Back tab's line while a NEW battle's back is switched off (owner
 *  Round 68: a battle's back is optional — the Card step's "Faces"). */
export const BATTLE_ONE_FACE_NOTE = "This battle has one face — choose Two faces on the Card step to give it a back";

/** The ▼ back a battle's back face wears for its type (a land back the land
 *  back), or null when none exists. */
export function battleBackBodyOf(backType: string | null | undefined): FrameTemplate | null {
  return bodyFor("transform", "back", backType || null, DEFAULT_DFC_ICON);
}

/** Why a battle's Back tab is greyed, or null when it is a face of its own
 *  (see the header). */
export function battleBackUnavailableNote(input: {
  mode: "create" | "edit" | "remix";
  /** The card being edited or remixed — its back as stored. */
  storedBack: StoredBack;
  verifiedKeys: ReadonlySet<string>;
}): string | null {
  if (input.mode !== "create") {
    if (isDfcBackBody(input.storedBack?.frame_style?.template)) return null;
    return input.storedBack
      ? "This battle keeps the back it was saved with"
      : "This battle was saved with one face — forge a new battle to give it a back";
  }
  const body = battleBackBodyOf("creature");
  if (body && templateHasAvailableColor(body, input.verifiedKeys)) return null;
  return "The back face's frame isn't published yet";
}

/** The body a battle's back saves on and the preview draws it on, or null
 *  (a legacy back) — see the header. */
export function battleBackBodyFor(input: {
  mode: "create" | "edit" | "remix";
  backType: string | null | undefined;
  backColorIdentity: readonly ColorIdentity[] | null | undefined;
  frontColorIdentity: readonly ColorIdentity[] | null | undefined;
  verifiedKeys: ReadonlySet<string>;
}): FrameTemplate | null {
  const body = battleBackBodyOf(input.backType);
  if (!body) return null;
  // An edit / remix only gets here with a stored body: the server keeps it.
  if (input.mode !== "create") return body;
  const colour =
    input.backColorIdentity && input.backColorIdentity.length > 0 ? input.backColorIdentity : input.frontColorIdentity;
  return isFrameComboAvailable(body, pickFrameColorKey(colour), input.verifiedKeys) ? body : null;
}
