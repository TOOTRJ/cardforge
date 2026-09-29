import "server-only";

import {
  hasBackFaceImage,
  pickArtCropUrl,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import {
  printingTreatmentFromScryfall,
  verifiedFrameMatchFromScryfall,
} from "@/lib/scryfall/import-mapper";
import type { PrintingSummary } from "@/lib/scryfall/printing-views";

// ---------------------------------------------------------------------------
// The server half of /api/scryfall/printings (TODO 1.5): trim a Scryfall
// printing to the dialog's PrintingSummary, with its finalized frame match,
// and pick the capped "representative" strip.
// ---------------------------------------------------------------------------

/** The representative strip's cap. */
export const MAX_REPRESENTATIVE_PRINTINGS = 30;

/** One printing for the dialog's grid. `verifiedKeys` is the request's ONE
 *  frame_reviews read. */
export function trimPrinting(
  card: ScryfallCard,
  verifiedKeys: ReadonlySet<string>,
): PrintingSummary {
  const effects = (card.frame_effects ?? []).map((e) => e.toLowerCase());
  const front = card.card_faces?.[0];
  // Every printing has a match: a card PipGlyph can't make (an Emblem, a
  // Plane) is the registry's `unsupported` "no-card-type".
  const match = verifiedFrameMatchFromScryfall(card, verifiedKeys);
  return {
    id: card.id,
    set: card.set ?? null,
    set_name: card.set_name ?? null,
    released_at: card.released_at ?? null,
    collector_number: card.collector_number ?? null,
    frame: card.frame ?? null,
    border_color: card.border_color ?? null,
    full_art: card.full_art === true,
    textless: card.textless === true,
    snow: effects.includes("snow"),
    devoid: effects.includes("devoid"),
    treatment: printingTreatmentFromScryfall(card) ?? null,
    artist: card.artist ?? front?.artist ?? null,
    // The same test as /api/scryfall/named's has_back_image (TODO 1.8).
    has_back_image: hasBackFaceImage(card),
    thumb_url: pickArtCropUrl(card),
    image_status: card.image_status ?? null,
    match: {
      status: match.status,
      exactLabel: match.exactLabel,
      template: match.template,
      reason: match.reason,
      ...(match.landOn ? { landOn: match.landOn } : {}),
      ...(match.reject ? { reject: match.reject } : {}),
    },
  };
}

/** The look a printing shows, for selectRepresentatives: the border
 *  generation plus every treatment that changes the frame (TODO 1.5's
 *  interim fix: frame | snow | devoid | border colour | full art | textless
 *  | showcase | extended art) — so a Plains strip keeps a full-art, a
 *  textless, a borderless and a showcase representative beside the plain
 *  ones. */
export function printingLookLabel(c: ScryfallCard): string {
  const effects = new Set((c.frame_effects ?? []).map((e) => e.toLowerCase()));
  return [
    c.frame ?? "?",
    effects.has("snow") ? "snow" : "",
    effects.has("devoid") ? "devoid" : "",
    (c.border_color ?? "").toLowerCase(),
    c.full_art === true ? "fullart" : "",
    c.textless === true ? "textless" : "",
    effects.has("showcase") ? "showcase" : "",
    effects.has("extendedart") ? "extendedart" : "",
  ].join("|");
}

/** The strip caps at MAX_REPRESENTATIVE_PRINTINGS, but a naive newest-first
 *  cut would drop exactly the printings the picker exists for — the old
 *  borders and the treatments. Guarantee the NEWEST and the OLDEST printing
 *  of every distinct look (printingLookLabel), then fill the remaining slots
 *  newest first. Result stays sorted newest → oldest. */
export function selectRepresentatives(cards: ScryfallCard[]): ScryfallCard[] {
  const sorted = [...cards].sort((a, b) =>
    (b.released_at ?? "").localeCompare(a.released_at ?? ""),
  );
  const newestByLabel = new Map<string, string>();
  const oldestByLabel = new Map<string, string>();
  for (const c of sorted) {
    const label = printingLookLabel(c);
    if (!newestByLabel.has(label)) newestByLabel.set(label, c.id);
    oldestByLabel.set(label, c.id); // last one seen per label = oldest
  }
  // Every look's newest first, then its oldest, then the newest to fill —
  // so when looks alone outnumber the cap, each look still keeps one.
  const keep = new Set<string>();
  for (const id of newestByLabel.values()) {
    if (keep.size < MAX_REPRESENTATIVE_PRINTINGS) keep.add(id);
  }
  for (const id of oldestByLabel.values()) {
    if (keep.size < MAX_REPRESENTATIVE_PRINTINGS) keep.add(id);
  }
  for (const c of sorted) {
    if (keep.size >= MAX_REPRESENTATIVE_PRINTINGS) break;
    keep.add(c.id);
  }
  return sorted.filter((c) => keep.has(c.id));
}
