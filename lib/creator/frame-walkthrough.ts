import "server-only";

import { buildFrameComparePayload } from "@/lib/scryfall/reference-preview";
import { getFrameReviews } from "@/lib/cards/frame-reviews";
import { pickFrameReferenceFrom } from "@/lib/cards/frame-reference-pick";
import {
  FRAME_COLOR_KEYS,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
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
};

export async function buildFrameWalkthrough(
  params: WalkthroughParams,
): Promise<FrameWalkthrough | null> {
  const { template, color } = params;
  if (!isTemplate(template) || !isColorKey(color)) return null;
  const kind = walkthroughKind(template, params.kind);
  const seedMode = parseWalkthroughSeed(params.seed);
  const label = `${template}/${color}`;

  if (seedMode === "none") {
    return {
      template,
      colorKey: color,
      kind,
      seed: null,
      note: `Walking ${label} from a blank card.`,
    };
  }

  const sample = (why: string): FrameWalkthrough => ({
    template,
    colorKey: color,
    kind,
    seed: {
      patch: sampleWalkthroughPatch(template, color, kind),
      source: { name: SAMPLE_SEED_NAME, scryfallUri: null },
      fromReference: false,
    },
    note: `Walking ${label} with sample content — ${why}.`,
  });

  if (seedMode === "sample") return sample("as asked");

  const reference = pickFrameReferenceFrom(
    await getFrameReviews(),
    template,
    color,
    params.ref,
  );
  if (!reference) return sample("no real printing exists for this combination");

  const payload = await buildFrameComparePayload(reference.scryfallId, template);
  if (!payload) {
    return sample(`the lookup of ${reference.name} failed (reload to retry)`);
  }
  // A reference the frame prints but the save refuses on it (the Ghostfire
  // frame's Ugin #409, its only colourless printing: a walker, and the
  // showcases draw no loyalty since TODO 4.5a) would walk a card that can't
  // be saved — walk the frame's own kind with sample content instead. The
  // SAVE's rule (templateRefusesKind, the kind gate), not the gallery's: a
  // snow artifact on m15snow (Replicating Ring KHM #244) isn't in the
  // Artifact gallery, but it saves and walks as the artifact it is.
  const referenceKind = payload.patch.kind;
  if (referenceKind && templateRefusesKind(template, referenceKind)) {
    const label = KIND_DEFS[referenceKind].label.toLowerCase();
    return sample(
      `${payload.cardName} is ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}, which this frame doesn't dress`,
    );
  }
  const seed: WalkthroughSeed = {
    // Pinned to the frame under test: the import handler then lands on it
    // (layout kinds already do through their kind).
    patch: { ...payload.patch, frame_template: template },
    source: { name: payload.cardName, scryfallUri: payload.scryfallUri },
    fromReference: true,
  };
  return {
    template,
    colorKey: color,
    kind: seed.patch.kind ?? kind,
    seed,
    note: `Walking ${label}, prefilled from ${reference.name} (${reference.set.toUpperCase()}) — the compare view's reference. Art isn't imported; add some on Identity if the art window matters.`,
  };
}
