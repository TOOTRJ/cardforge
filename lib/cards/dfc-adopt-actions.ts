"use server";

// ---------------------------------------------------------------------------
// adoptDfcBodiesAction (TODO 5.2; owner 2026-10-02, Q3: the 8 imported
// double-faced cards move onto the real frames IN PLACE, on ONE click by
// their owner) — the server half of lib/cards/dfc-adopt.ts.
//
// The one place a saved card's frame changes: the front goes to its DFC
// twin, the back gets its body and colour (the front's), the family is
// stamped, and both faces are re-baked. Gated like any save: the owner
// only, the front body × the card's colour verified, the back body × colour
// verified and colourless only with an Artifact word (the shared back gate,
// lib/cards/dfc-gate.ts), the kind gate on the new front. Nothing is
// offered until the owner ticks the combos (after 5.3).
//
// The re-bake: the existing front bake runs after the response
// (bakeAndPersistCardRender, as every save). The BACK's bake is 5.3's —
// bake-core.ts learns the back there; until then the stored render is the
// front and the card page flips the live preview onto the new back body.
// ---------------------------------------------------------------------------

import { after } from "next/server";
import { adoptDfcBodiesPlan, dfcAdoptionOffer, parseDfcAdoptionLayout } from "@/lib/cards/dfc-adopt";
import { resolveDfcBackFace } from "@/lib/cards/dfc-gate";
import { frameGateError } from "@/lib/cards/frame-availability";
import { cardFieldsFace, frameKindGateError } from "@/lib/cards/frame-kind-gate";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getCardById } from "@/lib/cards/queries";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { revalidateCardPaths } from "@/lib/cards/revalidate";
import { MEDIA_URL_NOT_ALLOWED_MESSAGE, mediaUrlViolationField } from "@/lib/media/media-url-errors";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient, getCurrentUser, getCurrentUsername } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import type { CardUpdate } from "@/types/card";

export type AdoptDfcBodiesResult =
  | { ok: true; cardId: string; slug: string; frontBody: string; backBody: string }
  | { ok: false; formError: string };

export async function adoptDfcBodiesAction(cardId: string, layoutName: string): Promise<AdoptDfcBodiesResult> {
  if (!isUuid(cardId)) return { ok: false, formError: "Card not found or not yours to edit." };
  const layout = parseDfcAdoptionLayout(layoutName);
  if (!layout) return { ok: false, formError: "Pick Transform or Modal double-faced." };
  if (!isSupabaseConfigured()) return { ok: false, formError: "Supabase isn't configured." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, formError: "Sign in to edit this card." };

  const existing = await getCardById(cardId);
  if (!existing || existing.owner_id !== user.id) {
    return { ok: false, formError: "Card not found or not yours to edit." };
  }

  const offer = dfcAdoptionOffer(existing);
  if (!offer) return { ok: false, formError: "This card can't move onto the double-faced frames." };
  const plan = adoptDfcBodiesPlan(existing, layout);
  if (!plan) {
    return {
      ok: false,
      formError: `The ${offer.layouts.find((entry) => entry.layout === layout)?.label ?? layout} frames aren't available yet.`,
    };
  }

  // The gates every save passes: verification on the front and the back,
  // the kind gate on the new front.
  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  const frontGate = frameGateError(plan.frontBody, existing.color_identity, verifiedKeys);
  if (frontGate) return { ok: false, formError: frontGate };
  const kindGate = frameKindGateError(plan.frontBody, cardFieldsFace(existing));
  if (kindGate) return { ok: false, formError: kindGate };
  const backGate = resolveDfcBackFace({
    frontTemplate: plan.frontBody,
    back: plan.back_face,
    family: plan.frame_style.dfcIcon as string | undefined,
    frontColorIdentity: existing.color_identity,
    verifiedKeys,
  });
  if (!backGate.ok) return { ok: false, formError: backGate.message };

  const update: CardUpdate = {
    frame_style: plan.frame_style as CardUpdate["frame_style"],
    back_face: backGate.back as CardUpdate["back_face"],
  };
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("cards")
    .update(update)
    .eq("id", cardId)
    .eq("owner_id", user.id)
    .select("id, slug")
    .single();
  const mediaField = mediaUrlViolationField(error?.message);
  if (mediaField) return { ok: false, formError: MEDIA_URL_NOT_ALLOWED_MESSAGE };
  if (error || !row) return { ok: false, formError: error?.message ?? "Could not move the card." };

  const ownerUsername = await getCurrentUsername();
  revalidateCardPaths(row.slug, ownerUsername, { visibility: existing.visibility });
  // Both faces re-bake after the response: the front through the existing
  // bake; the back's bake lands with 5.3 (bake-core.ts), through this same
  // call — nothing else here changes then.
  after(async () => {
    try {
      await bakeAndPersistCardRender(row.id, user.id);
      revalidateCardPaths(row.slug, ownerUsername, { visibility: existing.visibility });
    } catch (bakeError) {
      console.error(`[adopt-dfc] deferred bake failed for ${row.id}:`, bakeError);
    }
  });

  return { ok: true, cardId: row.id, slug: row.slug, frontBody: plan.frontBody, backBody: plan.backBody };
}
