import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import {
  sampleFramePreview,
  type FrameColorKey,
} from "@/lib/cards/frame-reference-registry";
import { colorIdentityForKey } from "@/components/cards/frame-layer";
import type { CardKind } from "@/lib/creator/card-kinds";
import type { CardType, FrameTemplate, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// The walk-through's seed (TODO 2.2) — what the creator is prefilled with
// when an admin walks the stepper on a frame. Both shapes are the import
// mapper's form patch, so the form applies them through the SAME handler as
// a user's Scryfall import (handleScryfallImport): the reference printing's
// patch (lib/creator/frame-walkthrough.ts, from buildFrameComparePayload),
// or — for a combination no real card was printed on — the compare view's
// placeholder content reshaped here. Pure.
// ---------------------------------------------------------------------------

export type WalkthroughSeed = {
  patch: ScryfallImportPatch;
  /** The "Based on" chip: the printing, or the sample content. */
  source: { name: string; scryfallUri: string | null };
  /** True when the seed is the combo's real reference printing. */
  fromReference: boolean;
};

/** What the create page hands the form for a walk (serialisable). */
export type FrameWalkthrough = {
  template: FrameTemplate;
  colorKey: FrameColorKey;
  kind: CardKind;
  seed: WalkthroughSeed | null;
  /** Shown in the page banner: which content seeded the walk and why. */
  note: string;
};

/** The sample name the chip shows for placeholder content. */
export const SAMPLE_SEED_NAME = "Sample content (no real printing)";

type SampleBackFace = {
  title?: string;
  cost?: string;
  card_type?: string;
  subtypes?: string[];
  rules_text?: string;
  power?: string;
  toughness?: string;
};

/** The compare view's placeholder content for a combo as an import patch,
 *  pinned to the template and colour under test. */
export function sampleWalkthroughPatch(
  template: FrameTemplate,
  colorKey: FrameColorKey,
  kind: CardKind,
): ScryfallImportPatch {
  const sample = sampleFramePreview(template, colorKey) as {
    title: string;
    cost: string | null;
    cardType: string;
    supertype: string | null;
    subtypes: string[];
    rarity: string;
    rulesText: string | null;
    flavorText: string | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    defense: string | null;
    artistCredit: string;
    backFace?: SampleBackFace | null;
  };
  const back = sample.backFace ?? null;
  return {
    title: sample.title,
    cost: sample.cost ?? undefined,
    kind,
    frame_template: template,
    card_type: sample.cardType as CardType,
    supertype: sample.supertype ?? "",
    subtypes_text: sample.subtypes.join(" "),
    rarity: sample.rarity as Rarity,
    color_identity: [colorIdentityForKey(colorKey)],
    rules_text: sample.rulesText ?? "",
    flavor_text: sample.flavorText ?? "",
    power: sample.power ?? "",
    toughness: sample.toughness ?? "",
    loyalty: sample.loyalty ?? "",
    defense: sample.defense ?? "",
    artist_credit: sample.artistCredit,
    back_face: back
      ? {
          title: back.title,
          cost: back.cost,
          card_type: back.card_type as CardType | undefined,
          subtypes_text: (back.subtypes ?? []).join(" "),
          rules_text: back.rules_text,
          power: back.power,
          toughness: back.toughness,
        }
      : undefined,
  };
}
