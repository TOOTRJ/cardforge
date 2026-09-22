import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { CARD_TYPE_VALUES, type CardType } from "@/types/card";
import { DECK_FORMAT_LABELS, DECK_FORMAT_VALUES, type DeckFormat } from "@/types/deck";
import { tagSlug } from "@/lib/cards/tag-slug";

// ---------------------------------------------------------------------------
// Browse hubs — the programmatic pages built from real data that search and
// answer engines can cite for "custom MTG dragon cards" or "custom commander
// decks": /gallery/tag/[tag], /gallery/type/[type], /decks/format/[format].
// Every hub renders for any real key, but only a hub with enough content is
// INDEXABLE (and in the sitemap); the thin ones are noindex, follow — the
// same bar the guide tag hubs apply. Counts come from migration 0108's
// aggregates through the cookie-free public client (ISR-safe).
// ---------------------------------------------------------------------------

/** Public cards a discovery tag needs before its hub is indexed. */
export const TAG_HUB_MIN_CARDS = 12;
/** Public cards a card type needs before its hub is indexed. */
export const TYPE_HUB_MIN_CARDS = 1;
/** Public, non-empty decks a format needs before its hub is indexed. */
export const FORMAT_HUB_MIN_DECKS = 3;

export { tagSlug } from "@/lib/cards/tag-slug";

export type TagHub = { tag: string; slug: string; count: number };
export type TypeHub = { type: CardType; count: number };
export type FormatHub = { format: DeckFormat; count: number };

export const listTagHubs = cache(async (): Promise<TagHub[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPublicClient().rpc("gallery_tag_counts");
    if (error || !data) return [];
    // Sorted by count desc (the SQL orders it), so the first slug match wins.
    return data.map((row) => ({ tag: row.tag, slug: tagSlug(row.tag), count: Number(row.card_count) }));
  } catch {
    return [];
  }
});

export const resolveTagHub = cache(async (slug: string): Promise<TagHub | null> => {
  if (!/^[a-z0-9-]{1,30}$/.test(slug)) return null;
  return (await listTagHubs()).find((hub) => hub.slug === slug) ?? null;
});

export const isIndexableTagHub = (hub: TagHub): boolean => hub.count >= TAG_HUB_MIN_CARDS;

/** The card types with a hub — the legacy "spell" value never gets one. */
export const HUB_TYPES = CARD_TYPE_VALUES.filter((type) => type !== "spell") as CardType[];

export function isHubType(value: string): value is CardType {
  return (HUB_TYPES as string[]).includes(value);
}

export const listTypeHubs = cache(async (): Promise<TypeHub[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPublicClient().rpc("gallery_type_counts");
    if (error || !data) return [];
    const counts = new Map(data.map((row) => [row.card_type, Number(row.card_count)]));
    return HUB_TYPES.map((type) => ({ type, count: counts.get(type) ?? 0 }));
  } catch {
    return [];
  }
});

export { isDeckFormat } from "@/types/deck";

export const listFormatHubs = cache(async (): Promise<FormatHub[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await createPublicClient().rpc("public_deck_format_counts");
    if (error || !data) return [];
    const counts = new Map(data.map((row) => [row.format, Number(row.deck_count)]));
    return DECK_FORMAT_VALUES.map((format) => ({ format, count: counts.get(format) ?? 0 }));
  } catch {
    return [];
  }
});

// ---------------------------------------------------------------------------
// Copy — one short, factual, keyword-bearing intro per hub, plus the guide
// that teaches the type. Answer engines quote the first sentences.
// ---------------------------------------------------------------------------

export type TypeHubCopy = { title: string; intro: string; guide?: { href: string; label: string } };

export const TYPE_HUB_COPY: Record<CardType, TypeHubCopy> = {
  creature: {
    title: "Custom MTG creature cards",
    intro:
      "Creatures are the heart of custom Magic design: a body, a cost and one or two abilities that make it worth a slot. These are the community's public creature cards, made with PipGlyph's card creator on real-feeling frames.",
    guide: { href: "/articles/how-to-design-a-custom-mtg-creature", label: "How to design a custom MTG creature" },
  },
  instant: {
    title: "Custom MTG instant cards",
    intro:
      "Instants reward timing — combat tricks, counterspells and responses that resolve at instant speed. Browse the community's custom instants, remix one, or write your own with PipGlyph's rules-text tools.",
    guide: { href: "/articles/designing-custom-instants-and-sorceries", label: "Designing custom instants and sorceries" },
  },
  sorcery: {
    title: "Custom MTG sorcery cards",
    intro:
      "Sorceries are the big, sorcery-speed effects: sweepers, tutors, rituals and reanimation. These public custom sorceries were designed with PipGlyph's card creator.",
    guide: { href: "/articles/designing-custom-instants-and-sorceries", label: "Designing custom instants and sorceries" },
  },
  artifact: {
    title: "Custom MTG artifact cards",
    intro:
      "Artifacts fit every deck — equipment, mana rocks, vehicles and colorless engines. Browse custom artifacts from the PipGlyph community, or design one on the modern artifact frame.",
    guide: { href: "/articles/how-to-design-custom-enchantments-and-artifacts", label: "How to design custom enchantments and artifacts" },
  },
  enchantment: {
    title: "Custom MTG enchantment cards",
    intro:
      "Enchantments change the rules of the game while they stay on the battlefield — auras, sagas and static engines. These are the community's public custom enchantments.",
    guide: { href: "/articles/how-to-design-custom-enchantments-and-artifacts", label: "How to design custom enchantments and artifacts" },
  },
  land: {
    title: "Custom MTG land cards",
    intro:
      "Custom lands are mana first and text second: duals, utility lands and basics with new art. Browse the community's lands, made with PipGlyph's land frames and mana pips.",
    guide: { href: "/articles/how-to-design-custom-mtg-lands", label: "How to design custom MTG lands" },
  },
  planeswalker: {
    title: "Custom MTG planeswalker cards",
    intro:
      "Planeswalkers carry loyalty abilities that tell a story in three lines. These public custom planeswalkers were built on PipGlyph's planeswalker frame with real loyalty badges.",
    guide: { href: "/articles/how-to-design-a-custom-planeswalker", label: "How to design a custom planeswalker" },
  },
  battle: {
    title: "Custom MTG battle cards",
    intro:
      "Battles are Magic's newest card type — landscape frames with defense counters that flip when defeated. Browse the community's custom battles made with PipGlyph's battle frame.",
  },
  token: {
    title: "Custom MTG token cards",
    intro:
      "Tokens are the game pieces other cards make — creatures, treasures and emblems worth printing for your own deck. These public custom tokens were designed with PipGlyph's token frame.",
    guide: { href: "/articles/designing-custom-mtg-tokens", label: "Designing custom MTG tokens" },
  },
  spell: { title: "Custom MTG spells", intro: "" },
};

export function formatHubCopy(format: DeckFormat): { title: string; intro: string } {
  const label = DECK_FORMAT_LABELS[format];
  return {
    title: `Custom ${label} decks`,
    intro: `${label} decks built with custom cards on PipGlyph — imported decklists, real cards remixed into custom versions, and AI-generated builds. Browse them, copy a list, or build your own and print it as proxies.`,
  };
}
