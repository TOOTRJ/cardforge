import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { entryPrintingImage, entryRowPictures } from "@/lib/decks/entry-image";
import { deckSummaryOf } from "@/lib/decks/deck-summary";
import { effectiveEntryRarity } from "@/lib/decks/effective-entry";
import { deckSizeRule, formatHasCommander } from "@/lib/decks/format-rules";
import { DECK_FORMAT_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's small helpers (TODO DK5.3 / DK5.9 / DK5.11): a printing's
// picture at the size a surface draws it, the summary bar's numbers, the
// effective rarity "Group by rarity" reads, the format sizes.
// ---------------------------------------------------------------------------

describe("a printing's picture at a size (DK5.11)", () => {
  const normal = "https://cards.scryfall.io/normal/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg?1562404626";

  it("asks Scryfall for the small JPEG for a row, the normal one for a tile", () => {
    expect(entryPrintingImage(normal, "small")).toBe(
      "https://cards.scryfall.io/small/front/6/d/6da045f8-6278-4c84-9d39-025adf0789c1.jpg?1562404626",
    );
    expect(entryPrintingImage(normal, "normal")).toBe(normal);
    expect(entryPrintingImage(normal.replace("/normal/", "/large/").replace("/front/", "/back/"), "small")).toBe(
      normal.replace("/normal/", "/small/").replace("/front/", "/back/"),
    );
  });

  it("leaves any other shape as stored, and draws nothing that isn't a Scryfall printing", () => {
    const png = "https://cards.scryfall.io/png/front/a/b/abc.png?1";
    expect(entryPrintingImage(png, "small")).toBe(png);
    const crop = "https://cards.scryfall.io/art_crop/front/a/b/abc.jpg";
    expect(entryPrintingImage(crop, "small")).toBe(crop);
    expect(entryPrintingImage("https://evil.example/normal/front/a.jpg", "small")).toBeNull();
    expect(entryPrintingImage("https://cards.scryfall.io/normal/front/../../x.jpg", "small")).toBeNull();
    expect(entryPrintingImage(null, "small")).toBeNull();
    expect(entryPrintingImage(undefined, "normal")).toBeNull();
  });

  describe("a row's pictures", () => {
    const HOST = "https://auth.pipglyph.com";
    const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;
    const ID = "11111111-1111-4111-8111-111111111111";
    beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST));
    afterEach(() => vi.unstubAllEnvs());

    it("the bake's thumb (never the PNG beside it), the small printing, and the ONE two-faces answer", () => {
      const card = {
        rendered_image_url: `${RENDERS}/${ID}.png?v=1`,
        rendered_thumb_url: `${RENDERS}/${ID}.thumb.webp?v=1`,
        rendered_back_thumb_url: `${RENDERS}/${ID}.back.thumb.webp?v=1`,
        frame_style: { template: "m15dfcfront" },
      };
      expect(entryRowPictures({ image_url: normal }, card)).toEqual({
        proxy: `/render-cdn/owner-1/${ID}.thumb.webp?v=1`,
        printing: normal.replace("/normal/", "/small/"),
        twoFaces: true,
      });
      // A bake older than thumbnails: the PNG. Not ours: nothing.
      expect(entryRowPictures({ image_url: null }, { ...card, rendered_thumb_url: null }).proxy).toBe(`${RENDERS}/${ID}.png?v=1`);
      expect(entryRowPictures({ image_url: null }, { ...card, rendered_image_url: "https://evil.example/x.png" })).toEqual({
        proxy: null,
        printing: null,
        twoFaces: false,
      });
      expect(entryRowPictures({ image_url: normal }, null).proxy).toBeNull();
    });
  });
});

describe("the summary bar's numbers (DK5.9)", () => {
  const analytics = (over: Partial<Parameters<typeof deckSummaryOf>[1]> = {}) => ({
    total: 100,
    byBoard: { main: 99, side: 0, maybe: 4, commander: 1, companion: 0 },
    averageManaValue: 3.3,
    lands: 36,
    ...over,
  });
  const counts = (over: Partial<Record<string, number>> = {}) => ({
    all: 100, imported: 60, edited: 20, remix: 4, original: 16, not_found: 0, unavailable: 0, ...over,
  });

  it("counts against an exact size, a floor, or none — the sideboard and a companion outside the deck", () => {
    expect(deckSummaryOf("commander", analytics(), ["Zoey"], counts())).toMatchObject({ size: 100, target: "100", sizeState: "ok", commanders: ["Zoey"] });
    expect(deckSummaryOf("commander", analytics({ total: 98 }), [], counts())).toMatchObject({ size: 98, sizeState: "short", commanders: [] });
    expect(deckSummaryOf("commander", analytics({ total: 102 }), [], counts())).toMatchObject({ sizeState: "over" });
    const standard = analytics({ total: 75, byBoard: { main: 60, side: 15, maybe: 0, commander: 0, companion: 0 } });
    expect(deckSummaryOf("standard", standard, [], counts())).toMatchObject({ size: 60, target: "60+", sizeState: "ok", commanders: null });
    const withCompanion = analytics({ total: 76, byBoard: { main: 60, side: 15, maybe: 0, commander: 0, companion: 1 } });
    expect(deckSummaryOf("standard", withCompanion, [], counts()).size).toBe(60);
    expect(deckSummaryOf("limited", analytics({ total: 39, byBoard: { main: 39, side: 0, maybe: 0, commander: 0, companion: 0 } }), [], counts()))
      .toMatchObject({ target: "40+", sizeState: "short" });
    expect(deckSummaryOf("casual", analytics(), [], counts())).toMatchObject({ target: null, sizeState: "free", commanders: null });
  });

  it("the composition is THE status count (the chips' and the breakdown's): four kinds always, the others when there", () => {
    expect(deckSummaryOf("casual", analytics(), [], counts()).composition).toEqual([
      { badge: "imported", count: 60 },
      { badge: "edited", count: 20 },
      { badge: "remix", count: 4 },
      { badge: "original", count: 16 },
    ]);
    const withLost = deckSummaryOf("casual", analytics(), [], counts({ not_found: 2, unavailable: 1 }));
    expect(withLost.composition.map((row) => row.badge)).toEqual(["imported", "edited", "remix", "original", "not_found", "unavailable"]);
  });

  it("every format with a commander zone says so, and only those", () => {
    expect(DECK_FORMAT_VALUES.filter(formatHasCommander)).toEqual(["commander", "brawl", "standard_brawl", "oathbreaker"]);
    expect(deckSizeRule("commander")).toEqual({ exact: 100 });
    expect(deckSizeRule("modern")).toEqual({ min: 60 });
    expect(deckSizeRule("casual")).toEqual({});
  });
});

describe("the effective rarity (Group by rarity)", () => {
  const fingerprintOf = `v1:${"0".repeat(64)}`;

  it("the printing's while it speaks for the entry, else the card's own — each falling back to the other", () => {
    // A printing alone.
    expect(effectiveEntryRarity({ scryfall_id: "sf", card_id: null, rarity: "Rare" }, null)).toBe("rare");
    // An edited import: the card's.
    expect(
      effectiveEntryRarity(
        { scryfall_id: "sf", card_id: "c", rarity: "common" },
        { rarity: "mythic", import_scryfall_id: "sf", import_fingerprint: fingerprintOf },
      ),
    ).toBe("mythic");
    // A card linked onto a printing before 0144 (untracked): the printing's.
    expect(effectiveEntryRarity({ scryfall_id: "sf", card_id: "c", rarity: "uncommon" }, { rarity: "mythic" })).toBe("uncommon");
    // An original with none of its own: nothing to fall back to.
    expect(effectiveEntryRarity({ scryfall_id: null, card_id: "c", rarity: null }, { rarity: null })).toBeNull();
    expect(effectiveEntryRarity({ scryfall_id: null, card_id: "c", rarity: "rare" }, { rarity: null })).toBe("rare");
  });
});
