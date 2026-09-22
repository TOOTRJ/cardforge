import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Browse hubs: slugging, resolution by slug (highest count wins a collision),
// the indexability bars, and copy for every card type that has a hub.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  tags: [
    { tag: "dragon", card_count: 40 },
    { tag: "blue mage", card_count: 9 },
    { tag: "blue-mage", card_count: 3 },
  ],
  types: [
    { card_type: "creature", card_count: 300 },
    { card_type: "spell", card_count: 2 },
  ],
  formats: [{ format: "commander", deck_count: 5 }],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    rpc: async (fn: string) => ({
      data: fn === "gallery_tag_counts" ? s.tags : fn === "gallery_type_counts" ? s.types : s.formats,
      error: null,
    }),
  }),
}));

import {
  FORMAT_HUB_MIN_DECKS,
  HUB_TYPES,
  isIndexableTagHub,
  listFormatHubs,
  listTagHubs,
  listTypeHubs,
  resolveTagHub,
  TAG_HUB_MIN_CARDS,
  tagSlug,
  TYPE_HUB_COPY,
  formatHubCopy,
} from "@/lib/cards/hubs";

describe("tag hubs", () => {
  it("slugs spaces to hyphens and resolves a slug to the tag with the most cards", async () => {
    expect(tagSlug("blue mage")).toBe("blue-mage");
    expect(tagSlug(" dragon ")).toBe("dragon");
    const hubs = await listTagHubs();
    expect(hubs.map((h) => h.slug)).toEqual(["dragon", "blue-mage", "blue-mage"]);
    // "blue mage" (9) and "blue-mage" (3) share a slug — the bigger one wins.
    expect(await resolveTagHub("blue-mage")).toMatchObject({ tag: "blue mage", count: 9 });
    expect(await resolveTagHub("no-such-tag")).toBeNull();
    expect(await resolveTagHub("../etc")).toBeNull();
  });

  it("indexes a tag only once it holds enough public cards", async () => {
    const hubs = await listTagHubs();
    expect(TAG_HUB_MIN_CARDS).toBeGreaterThan(1);
    expect(hubs.filter(isIndexableTagHub).map((h) => h.tag)).toEqual(["dragon"]);
  });
});

describe("type and format hubs", () => {
  it("has a hub with copy for every card type except the legacy 'spell' value", async () => {
    expect(HUB_TYPES).not.toContain("spell");
    for (const type of HUB_TYPES) {
      expect(TYPE_HUB_COPY[type].title, type).toMatch(/^Custom MTG /);
      expect(TYPE_HUB_COPY[type].intro.length, type).toBeGreaterThan(80);
    }
    const hubs = await listTypeHubs();
    expect(hubs.find((h) => h.type === "creature")?.count).toBe(300);
    expect(hubs.find((h) => h.type === "battle")?.count).toBe(0);
    expect(hubs.some((h) => (h.type as string) === "spell")).toBe(false);
  });

  it("counts public non-empty decks per format and writes a format intro", async () => {
    const hubs = await listFormatHubs();
    expect(hubs.find((h) => h.format === "commander")?.count).toBe(5);
    expect(hubs.find((h) => h.format === "pauper")?.count).toBe(0);
    expect(FORMAT_HUB_MIN_DECKS).toBeGreaterThan(1);
    expect(formatHubCopy("commander")).toMatchObject({ title: "Custom Commander decks" });
    expect(formatHubCopy("standard_brawl").intro).toContain("Standard Brawl decks");
  });
});
