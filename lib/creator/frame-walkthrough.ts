import "server-only";

import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { pickFrameReferenceFrom } from "@/lib/cards/frame-reference-pick";
import {
  FRAME_COLOR_KEYS,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { parseCardFace, type CardFace } from "@/lib/cards/card-face";
import { faceUnderTest, frontBodyFor, isDfcBackBody } from "@/lib/cards/dfc";
import {
  parseWalkthroughSeed,
  walkthroughKind,
} from "@/lib/creator/frame-preview";
import { KIND_DEFS, templateRefusesKind } from "@/lib/creator/card-kinds";
import {
  SAMPLE_SEED_NAME,
  sampleWalkthroughPatch,
  type FrameWalkthrough,
  type WalkthroughSeed,
} from "@/lib/creator/frame-walkthrough-seed";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// "Walk the stepper" (TODO 2.2): /create?previewFrames=all&kind=…&template=…
// &color=…&seed=reference opens the creator on that frame and colour,
// prefilled from the combo's reference printing — the compare view's own
// content (buildFrameComparePayload, the second face included) — so an
// adventure, split, flip, aftermath, battle or saga flows through Card →
// Identity → Text & stats → Publish exactly as it would for a user.
//
// Per FACE (TODO 5.0b): `&face=back` opens the live preview on the back
// face; a BACK body's walk always does (faceUnderTest) and pins the CARD to
// the body's paired front (frontBodyFor) — a back body never dresses a
// front, so the back is reached by the preview's flip, drawn as the creator
// draws a back today (its own body from 5.2). The seed is the whole
// printing either way: the import handler fills both faces.
//
// Admin-only: the create page calls this only after its own is_admin check
// and only in preview mode. The Scryfall lookup is the compare view's
// (admin tooling, throttled by lib/scryfall/client.ts, not counted against
// the per-user quotas). A combo with no real printing, or a lookup that
// fails, falls back to the compare view's sample content and says so.
// ---------------------------------------------------------------------------

function isTemplate(value: string | undefined): value is FrameTemplate {
  return (FRAME_TEMPLATE_VALUES as readonly string[]).includes(value ?? "");
}

function isColorKey(value: string | undefined): value is FrameColorKey {
  return (FRAME_COLOR_KEYS as readonly string[]).includes(value ?? "");
}

export type WalkthroughParams = {
  template?: string;
  color?: string;
  kind?: string;
  seed?: string;
  /** Optional registry alternate (the compare view's ?ref=). */
  ref?: string;
  /** The face to open the preview on (the compare view's ?face=). */
  face?: string | string[];
};

export async function buildFrameWalkthrough(
  params: WalkthroughParams,
): Promise<FrameWalkthrough | null> {
  const { template, color } = params;
  if (!isTemplate(template) || !isColorKey(color)) return null;
  const previewFace: CardFace = faceUnderTest(template, parseCardFace(params.face));
  // A back body's card is its paired front (the one for the printing's
  // front type once the reference is known, below — a land front wears
  // the land pair, as the compare view pairs it); the kind is the card's.
  const backBody = isDfcBackBody(template);
  let cardTemplate: FrameTemplate = (backBody ? frontBodyFor(template) : null) ?? template;
  const kind = walkthroughKind(cardTemplate, params.kind);
  const seedMode = parseWalkthroughSeed(params.seed);
  const label = `${template}/${color}`;
  const onBack = previewFace === "back" ? " The preview opens on the back face." : "";
  const base = () => ({ template, colorKey: color, previewFace, cardTemplate });

  if (seedMode === "none") {
    return {
      ...base(),
      kind,
      seed: null,
      note: `Walking ${label} from a blank card.${onBack}`,
    };
  }

  const sample = (why: string): FrameWalkthrough => ({
    ...base(),
    kind,
    seed: {
      patch: sampleWalkthroughPatch(cardTemplate, color, kind),
      source: { name: SAMPLE_SEED_NAME, scryfallUri: null },
      fromReference: false,
    },
    note: `Walking ${label} with sample content — ${why}.${onBack}`,
  });

  if (seedMode === "sample") return sample("as asked");

  const reference = pickFrameReferenceFrom(
    await getFrameReviews(),
    template,
    color,
    params.ref,
  );
  if (!reference) return sample("no real printing exists for this combination");

  // The seed is the printing's PATCH (both faces), the same for either
  // face: the front payload is enough, and says whether a back exists.
  const payload = await buildFrameComparePayload(reference.scryfallId, template);
  if (!payload) {
    return sample(`the lookup of ${reference.name} failed (reload to retry)`);
  }
  // Now that the printing is known: a back body's card is the front body
  // for the printing's FRONT type (the land pair under a land front), the
  // same pairing the compare view renders the back under.
  if (backBody) cardTemplate = frontBodyFor(template, payload.patch.card_type) ?? template;
  // A reference the frame prints but the save refuses on it (the Ghostfire
  // frame's Ugin #409, its only colourless printing: a walker, and the
  // showcases draw no loyalty since TODO 4.5a) would walk a card that can't
  // be saved — walk the frame's own kind with sample content instead. The
  // SAVE's rule (templateRefusesKind, the kind gate), not the gallery's: a
  // snow artifact on m15snow (Replicating Ring KHM #244) isn't in the
  // Artifact gallery, but it saves and walks as the artifact it is.
  const referenceKind = payload.patch.kind;
  if (referenceKind && templateRefusesKind(cardTemplate, referenceKind)) {
    const label = KIND_DEFS[referenceKind].label.toLowerCase();
    return sample(
      `${payload.cardName} is ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}, which this frame doesn't dress`,
    );
  }
  const seed: WalkthroughSeed = {
    // Pinned to the frame under test: the import handler then lands on it
    // (layout kinds already do through their kind).
    patch: { ...payload.patch, frame_template: cardTemplate },
    source: { name: payload.cardName, scryfallUri: payload.scryfallUri },
    fromReference: true,
  };
  // A back was asked for on a printing that has none: the preview has
  // nothing to flip to, so it opens on the front and the banner says so.
  const noBack = previewFace === "back" && !seed.patch.back_face;
  return {
    ...base(),
    previewFace: noBack ? "front" : previewFace,
    kind: seed.patch.kind ?? kind,
    seed,
    note: `Walking ${label}, prefilled from ${reference.name} (${reference.set.toUpperCase()}) — the compare view's reference. Art isn't imported; add some on Identity if the art window matters.${
      noBack ? ` ${reference.name} has no second face, so the preview opens on the front.` : onBack
    }`,
  };
}
