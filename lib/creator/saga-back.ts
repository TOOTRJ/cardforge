// ---------------------------------------------------------------------------
// A Saga BACK face in the creator (TODO 5.5 (b), PR 2).
//
// A transform card whose back face is a Saga — an enchantment back whose
// subtypes say Saga (MOM's praetors, LCI #189 Huatli) — draws its back on
// the double-faced saga back (`sagadfcback`: the saga's chapter rail under
// the ▼ back's dark bars) once that body is published in the colour the
// back wears; short of that, on the body its type derives, as before.
// The server's gate decides the same way (lib/cards/dfc-gate.ts
// resolveDfcBackFace, `backBodyFor`), so the body the form derives — for the
// live preview and the save's payload — is the body the server stores.
//
// On an EDIT the stored body wins, as for every back: a back saved on the
// ▼ back before the saga back was published keeps it (and a saga back keeps
// its saga body) until the card's icon family changes, which re-derives it.
//
// Pure: no React, no form state.
// ---------------------------------------------------------------------------

import {
  SAGA_BACK_BODY,
  backBodyFor,
  isDfcBackBody,
  sagaBackBodyFor,
  type DfcIconFamily,
  type DfcLayout,
  type DfcLook,
} from "@/lib/cards/dfc";
import { isFrameComboAvailable } from "@/lib/cards/frame-availability";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

export function creatorBackBodyFor(input: {
  mode: "create" | "edit" | "remix";
  layout: DfcLayout;
  backType: string | null | undefined;
  /** The back's subtypes — the form's text or a stored list. */
  backSubtypes: readonly string[] | string | null | undefined;
  family: DfcIconFamily;
  look: DfcLook;
  backColorIdentity: readonly ColorIdentity[] | null | undefined;
  frontColorIdentity: readonly ColorIdentity[] | null | undefined;
  verifiedKeys: ReadonlySet<string>;
  /** The card being edited: its back's stored body and its family as saved. */
  storedBackTemplate?: string | null;
  storedFamily?: DfcIconFamily | null;
}): FrameTemplate | null {
  const saga = sagaBackBodyFor(input.layout, input.backType || null, input.backSubtypes, input.family, input.look);
  const stored = input.storedBackTemplate;
  if (
    input.mode === "edit" &&
    stored &&
    isDfcBackBody(stored) &&
    (stored === SAGA_BACK_BODY || saga !== null) &&
    (input.storedFamily ?? null) === input.family
  ) {
    return stored as FrameTemplate;
  }
  const colour =
    input.backColorIdentity && input.backColorIdentity.length > 0 ? input.backColorIdentity : input.frontColorIdentity;
  return backBodyFor(
    input.layout,
    { cardType: input.backType || null, subtypes: input.backSubtypes },
    input.family,
    input.look,
    (template) => isFrameComboAvailable(template, pickFrameColorKey(colour ? [...colour] : undefined), input.verifiedKeys),
  );
}
