import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import type { PlayCardRow, PlayDeckItem } from "@/lib/tools/play-exports/build";

// Fixtures for the play-export tests: stored card rows and deck items as the
// viewer's reads return them. The storage host is the legacy project host
// (lib/media/storage-hosts.ts), always "ours" whatever the env says.

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const BASE_URL = "https://pipglyph.com";
export const CARD_BACK = `${BASE_URL}/tools/play-exports/card-back.png`;

const STORAGE = "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders";

let seq = 0;
export function cardId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export function bake(owner: string, id: string, name = `${id}.png`): string {
  return `${STORAGE}/${owner}/${name}?v=1`;
}

export function cardRow(overrides: Partial<PlayCardRow> = {}): PlayCardRow {
  const id = overrides.id ?? cardId();
  const owner = overrides.owner_id ?? OWNER;
  return {
    id,
    owner_id: owner,
    slug: `card-${id.slice(-4)}`,
    visibility: "public",
    title: "Ember Wolf",
    cost: "{1}{R}",
    card_type: "creature",
    supertype: null,
    subtypes: ["Wolf"],
    rarity: "uncommon",
    color_identity: ["red"],
    power: "2",
    toughness: "1",
    loyalty: null,
    defense: null,
    artist_credit: "Ada",
    rules_text: "Haste",
    flavor_text: "It runs hot.",
    face_content: null,
    frame_style: { template: "m15" },
    back_face: null,
    rendered_image_url: bake(owner, id),
    rendered_thumb_url: bake(owner, id, `${id}.thumb.webp`),
    rendered_back_image_url: null,
    rendered_back_thumb_url: null,
    parent_card_id: null,
    source_scryfall_id: null,
    import_scryfall_id: null,
    import_fingerprint: null,
    ...overrides,
  } as PlayCardRow;
}

/** A card still exactly the printing it was imported from. */
export function unchangedImport(scryfallId: string, overrides: Partial<PlayCardRow> = {}): PlayCardRow {
  const row = cardRow({ title: "Lightning Bolt", cost: "{R}", card_type: "instant", subtypes: [], power: null, toughness: null, rules_text: "Lightning Bolt deals 3 damage to any target.", ...overrides });
  return { ...row, import_scryfall_id: scryfallId, import_fingerprint: importFingerprintOf(row) } as PlayCardRow;
}

export function item(entry: Partial<PlayDeckItem["entry"]> & { name: string }, card: PlayCardRow | null = null): PlayDeckItem {
  return {
    entry: {
      id: cardId(),
      board: "main",
      quantity: 1,
      card_id: card?.id ?? null,
      scryfall_id: null,
      set_code: null,
      collector_number: null,
      image_url: null,
      source: card ? "creator" : "import",
      ...entry,
    },
    card,
  };
}

export const CTX = { baseUrl: BASE_URL, usernames: new Map([[OWNER, "maker"], [OTHER, "friend"]]), cardBackUrl: CARD_BACK };
