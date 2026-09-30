// ---------------------------------------------------------------------------
// The legendary crown (TODO 4.6a; design 2026-09-29 §1.1) — the questions
// the creator, the admin compare page and the tests ask about one card's
// crown, answered by the ONE overlay rule both renderers draw with
// (lib/cards/anatomy.ts resolveFrameOverlays). The band itself is
// M15_CROWN in lib/cards/template-layout.ts, declared on the m15,
// m15artifact and m15land PROFILES entries only.
//
// The crown is an ADDITION (owner rule 2026-09-29, docs/FRAMES.md
// "Additions vs corrections"): drawn only when the card's switch
// (FrameStyle.crown) is exactly `true`, the supertype has the word
// Legendary, the card type prints one (not a planeswalker, token, battle or
// emblem) and the template draws it. Its key is the pinline of the master
// actually drawn: the colour; gold "m" for three or more colours or a pair
// drawn gold; the pair itself where the two-colour frame is drawn (4.6b);
// the colourless grey "c" on m15, the artifact silver "a" on m15artifact,
// the land grey "l" on m15land.
//
// Pure and client-safe.
// ---------------------------------------------------------------------------

import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  resolveFrameOverlays,
  type AnatomyFacts,
  type FrameAnatomyStyle,
  type ResolvedFrameOverlay,
} from "@/lib/cards/anatomy";
import type { FrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

/** The card facts the crown depends on — a CardPreviewData or a form's
 *  values, reshaped. */
export type CrownCard = {
  colorIdentity: readonly ColorIdentity[] | null | undefined;
  cost?: string | null;
  cardType?: string | null;
  supertype?: string | null;
  frameStyle?: FrameAnatomyStyle | null;
};

type CrownProfile = Pick<FrameProfile, "overlays" | "twoColorMasters" | "twoColorForLands">;

function factsOf(card: CrownCard): AnatomyFacts & { colorKey: string } {
  return {
    colors: card.colorIdentity,
    cost: card.cost ?? null,
    cardType: card.cardType ?? null,
    supertype: card.supertype ?? null,
    colorKey: pickFrameColorKey(card.colorIdentity ?? undefined),
  };
}

/** The crown overlay `card` draws on `profile`, or null (no crown). */
export function crownOverlayFor(card: CrownCard, profile: CrownProfile): ResolvedFrameOverlay | null {
  return resolveFrameOverlays(profile, card.frameStyle, factsOf(card)).find((o) => o.anatomy === "crown") ?? null;
}

/** True when `card` draws the legendary crown on `profile`. */
export function showsCrown(card: CrownCard, profile: CrownProfile): boolean {
  return crownOverlayFor(card, profile) !== null;
}

/** The crown band key `card` draws on `profile` ("w", "m", "a", "l", "wu" …),
 *  or null when it draws none. */
export function crownKeyFor(card: CrownCard, profile: CrownProfile): string | null {
  return crownOverlayFor(card, profile)?.key ?? null;
}

/** A crowned print the crown is judged against (the admin compare page's
 *  "Legendary" toggle, the PR's print sheet). Printing data only — no scan
 *  is kept (docs/FRAMES.md "Provenance and legal"). */
export type CrownReference = {
  name: string;
  set: string;
  collectorNumber: string;
  scryfallId: string;
};

const ref = (name: string, set: string, collectorNumber: string, scryfallId: string): CrownReference => ({
  name,
  set,
  collectorNumber,
  scryfallId,
});

/**
 * The crowned prints per crowned template × frame colour key (design
 * 2026-09-29 §1.1 "Crown key"): FDN's WotC digital renders for absolute
 * registration (pixel-identical across the set), the NEO lands, UMA's
 * colourless crowns. A key with no crowned print on that frame has none.
 */
export const CROWN_REFERENCES: Partial<Record<FrameTemplate, Partial<Record<string, CrownReference>>>> = {
  m15: {
    w: ref("Arahbo, the First Fang", "fdn", "2", "524a5d93-26ed-436d-a437-dc9460acce98"),
    u: ref("Kiora, the Rising Tide", "fdn", "45", "83f20a32-9f5d-4a68-8995-549e57554da2"),
    b: ref("Tinybones, Bauble Burglar", "fdn", "72", "ff3d85bc-ef2d-4251-baf4-a14bd0cee61e"),
    r: ref("Kellan, Planar Trailblazer", "fdn", "91", "f46a9329-7b91-441d-8653-50c1152c9120"),
    g: ref("Loot, Exuberant Explorer", "fdn", "106", "09980ce6-425b-4e03-94d0-0f02043cb361"),
    m: ref("Muldrotha, the Gravetide", "fdn", "243", "51710b19-68e3-4853-901f-e618bde61161"),
    c: ref("Kozilek, Butcher of Truth", "uma", "6", "6d47a1c7-d32b-425a-b15d-24eb35318f6f"),
  },
  m15artifact: {
    u: ref("The Reality Chip", "neo", "74", "d859de3a-0be1-4e66-b438-1c3d4ee756cd"),
    r: ref("Chandra's Regulator", "m20", "131", "8f1b1d5c-f71e-4c68-8baf-c134e42ed6f2"),
    c: ref("Pyromancer's Goggles", "fdn", "677", "f340d8a4-196a-4433-807c-b7124e96e44f"),
  },
  m15land: {
    w: ref("Eiganjo, Seat of the Empire", "neo", "268", "c375a022-5b57-496d-a802-e4ea8376e9e4"),
    u: ref("Otawara, Soaring City", "neo", "271", "486d7edc-d983-41f0-8b78-c99aecd72996"),
    b: ref("Takenuma, Abandoned Mire", "neo", "278", "499037cc-a577-41cb-8ca2-5e117945634f"),
    r: ref("Sokenzan, Crucible of Defiance", "neo", "276", "aa548dcd-c1dd-492d-a69f-c65dfeef0633"),
    g: ref("Boseiju, Who Endures", "neo", "266", "2135ac5a-187b-4dc9-8f82-34e8d1603416"),
    c: ref("Dark Depths", "uma", "241", "e00d16f9-ea27-4aa3-a134-4e04f934d020"),
  },
};

/** The crowned print for a template × frame colour key, or null. */
export function crownReferenceFor(template: FrameTemplate, colorKey: string): CrownReference | null {
  return CROWN_REFERENCES[template]?.[colorKey] ?? null;
}
