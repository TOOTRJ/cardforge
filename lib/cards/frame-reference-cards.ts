import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Reference cards for the admin frame-comparison tool (/admin/frame-compare).
//
// One real printing per frame era, hand-transcribed from Scryfall data so
// our renderer draws the SAME text the printed card carries — overlaying
// the official scan then exposes any drift in the frame geometry, text
// slots, or fonts.
//
// Serra Angel is deliberately used for every era: it exists in all four
// frames with a highres_scan image and identical rules text, so era-to-era
// differences in the overlay are frame differences, not content ones.
//
// `artUrl` stays null on purpose: the tool measures frame geometry and
// typography, the scan supplies the art visually in overlay mode, and we
// don't rehost WotC art for a dev utility.
// ---------------------------------------------------------------------------

export type FrameReferenceCard = {
  /** Stable key used in the ?ref= search param. */
  key: string;
  /** Human label for the picker. */
  label: string;
  /** Frame era, for grouping in the UI. */
  era: "1993" | "1997" | "2003" | "2015";
  /** Our frame template this printing corresponds to. */
  template: FrameTemplate;
  /** Scryfall id of the exact printing (highres_scan verified 2026-07-01). */
  scryfallId: string;
  /** Transcribed card content rendered through our CardPreview. */
  preview: CardPreviewData;
};

const SERRA_ANGEL_BASE: CardPreviewData = {
  title: "Serra Angel",
  cost: "{3}{W}{W}",
  cardType: "creature",
  supertype: null,
  subtypes: ["Angel"],
  rarity: "uncommon",
  colorIdentity: ["white"],
  rulesText:
    "Flying\nVigilance (Attacking doesn't cause this creature to tap.)",
  power: "4",
  toughness: "4",
  artUrl: null,
};

export const FRAME_REFERENCE_CARDS: FrameReferenceCard[] = [
  {
    key: "1993-agclassic",
    label: "1993 · Alpha (Serra Angel, LEA)",
    era: "1993",
    template: "agclassic",
    scryfallId: "f8ac5006-91bd-4803-93da-f87cf196dd2f",
    preview: {
      ...SERRA_ANGEL_BASE,
      flavorText:
        "Born with wings of light and a sword of faith, this heavenly incarnation embodies both fury and purity.",
      artistCredit: "Douglas Shuler",
      frameStyle: { template: "agclassic" },
    },
  },
  {
    key: "1997-retro",
    label: "1997 · Retro (Serra Angel, DMR retro)",
    era: "1997",
    template: "retro",
    scryfallId: "e430b8c9-9439-4256-9066-e9b57f257fe7",
    preview: {
      ...SERRA_ANGEL_BASE,
      flavorText:
        "The angel remembers her past lives like dreams. Her song held up meadows. Her blade drove back darkness. Her wings carried her across the ages.",
      artistCredit: "Donato Giancola",
      frameStyle: { template: "retro" },
    },
  },
  {
    key: "2003-modern",
    label: "2003 · Modern (Serra Angel, M12)",
    era: "2003",
    template: "modern",
    scryfallId: "3c31fb9d-ec0d-4555-814d-62642d52c710",
    preview: {
      ...SERRA_ANGEL_BASE,
      flavorText: "Follow the light. In its absence, follow her.",
      artistCredit: "Greg Staples",
      frameStyle: { template: "modern" },
    },
  },
  {
    key: "2015-m15",
    label: "2015 · M15 (Serra Angel, DOM)",
    era: "2015",
    template: "m15",
    scryfallId: "b56b9131-4f7e-4912-ba47-63ed82f21d1b",
    preview: {
      ...SERRA_ANGEL_BASE,
      flavorText:
        "The angel remembers her past lives like dreams. Her song held up meadows. Her blade drove back darkness. Her wings carried her across the ages.",
      artistCredit: "Donato Giancola",
      frameStyle: { template: "m15" },
    },
  },
];

export const DEFAULT_REFERENCE_KEY = FRAME_REFERENCE_CARDS[3].key;

export function getFrameReferenceCard(
  key: string | null | undefined,
): FrameReferenceCard {
  return (
    FRAME_REFERENCE_CARDS.find((ref) => ref.key === key) ??
    FRAME_REFERENCE_CARDS[3]
  );
}
