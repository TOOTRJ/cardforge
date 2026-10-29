import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAN_MAX, featuredCardsOf, type FeaturableCard } from "@/lib/decks/featured";

// ---------------------------------------------------------------------------
// TODO DK6.5: the deck hero's fan — commanders first, then a seeded pick of
// the deck's own baked PipGlyph cards, then real printings; never a private
// card, never a card without its 600 px thumb, the same fan on every render.
// ---------------------------------------------------------------------------

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
const DECK = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const render = (cardId: string, suffix: string) =>
  `${HOST}/storage/v1/object/public/card-renders/${OWNER}/${cardId}${suffix}?v=1`;

let seq = 0;
function customItem(board: string, overrides: Partial<FeaturableCard> = {}) {
  seq += 1;
  const id = uuid(seq);
  const card: FeaturableCard = {
    id,
    owner_id: OWNER,
    title: `Custom ${seq}`,
    visibility: "public",
    rendered_image_url: render(id, ".png"),
    rendered_thumb_url: render(id, ".thumb.webp"),
    ...overrides,
  };
  return {
    entry: {
      id: `entry-${seq}`,
      board,
      name: card.title,
      position: seq,
      card_id: id,
      scryfall_id: null as string | null,
      image_url: null as string | null,
      type_line: "Creature — Elf",
    },
    card,
  };
}
function printingItem(board: string, name: string, typeLine = "Instant") {
  seq += 1;
  return {
    entry: {
      id: `entry-${seq}`,
      board,
      name,
      position: seq,
      card_id: null,
      scryfall_id: `sf-${seq}`,
      image_url: `https://cards.scryfall.io/normal/front/a/b/${seq}.jpg?1`,
      type_line: typeLine,
    },
    card: null as FeaturableCard | null,
  };
}

const keys = (cards: ReturnType<typeof featuredCardsOf>) => cards.map((c) => c.key);

describe("featuredCardsOf", () => {
  it("puts the commanders first, in the deck's order, then fills to five", () => {
    const commander = printingItem("commander", "Krenko, Mob Boss", "Legendary Creature — Goblin");
    const partner = customItem("commander");
    const items = [
      ...Array.from({ length: 6 }, () => customItem("main")),
      ...Array.from({ length: 4 }, (_, i) => printingItem("main", `Spell ${i}`)),
      commander,
      partner,
    ];
    const fan = featuredCardsOf(items, DECK);
    expect(fan).toHaveLength(FAN_MAX);
    // `position` orders them, not the order the rows came in.
    expect(fan[0].key).toBe(`print:${commander.entry.scryfall_id}`);
    expect(fan[1].key).toBe(`card:${partner.card.id}`);
  });

  it("prefers the deck's own baked cards over real printings", () => {
    const customs = Array.from({ length: 3 }, () => customItem("main"));
    const printings = Array.from({ length: 6 }, (_, i) => printingItem("main", `Real ${i}`));
    const fan = featuredCardsOf([...printings, ...customs], DECK);
    expect(fan.slice(0, 3).every((c) => c.kind === "custom")).toBe(true);
    expect(fan.slice(3).every((c) => c.kind === "printing")).toBe(true);
  });

  it("never shows a private card — for the owner (who reads it) or a visitor (who reads null)", () => {
    const ownerView = customItem("commander", { visibility: "private" });
    const visitorView = { ...customItem("main"), card: null };
    const fan = featuredCardsOf([ownerView, visitorView, printingItem("main", "Opt")], DECK);
    expect(fan.map((c) => [c.kind, c.title])).toEqual([["printing", "Opt"]]);
    // …and its entry's printing is not drawn in its place.
    const remixedPrivate = customItem("main", { visibility: "private" });
    remixedPrivate.entry.scryfall_id = "sf-real";
    remixedPrivate.entry.image_url = "https://cards.scryfall.io/normal/front/x/y/real.jpg";
    expect(featuredCardsOf([remixedPrivate], DECK)).toEqual([]);
  });

  it("never the HD PNG: a card without its stored thumb, or mid-save, is left out", () => {
    const noThumb = customItem("main", { rendered_thumb_url: null });
    const midSave = customItem("main", { rendered_image_url: null, rendered_thumb_url: null });
    const outside = customItem("main", { rendered_thumb_url: "https://evil.example/x.webp" });
    const borrowed = customItem("main");
    borrowed.card.rendered_thumb_url = render(uuid(999), ".thumb.webp");
    expect(featuredCardsOf([noThumb, midSave, outside, borrowed], DECK)).toEqual([]);
  });

  it("leaves out the maybeboard, basic lands, and printings with no Scryfall image", () => {
    const badHost = printingItem("main", "Bad host");
    badHost.entry.image_url = "https://evil.example/a.jpg";
    const fan = featuredCardsOf(
      [
        customItem("maybe"),
        printingItem("main", "Forest", "Basic Land — Forest"),
        printingItem("main", "Snow-Covered Island", "Basic Snow Land — Island"),
        badHost,
        printingItem("main", "Command Tower", "Land"),
      ],
      DECK,
    );
    expect(fan.map((c) => c.title)).toEqual(["Command Tower"]);
  });

  it("is the same fan on every render, whatever order the rows arrive in", () => {
    const items = [
      ...Array.from({ length: 9 }, () => customItem("main")),
      ...Array.from({ length: 9 }, (_, i) => printingItem("main", `Card ${i}`)),
    ];
    const first = keys(featuredCardsOf(items, DECK));
    expect(keys(featuredCardsOf([...items].reverse(), DECK))).toEqual(first);
    expect(keys(featuredCardsOf(items, DECK))).toEqual(first);
    // Another deck with the same cards picks its own.
    const other = keys(featuredCardsOf(items, "44444444-4444-4444-8444-444444444444"));
    expect(other).toHaveLength(FAN_MAX);
  });

  it("counts a card once, however many entries hold it", () => {
    const one = customItem("main");
    const again = { entry: { ...one.entry, id: "entry-dup", board: "side" }, card: one.card };
    expect(featuredCardsOf([one, again], DECK)).toHaveLength(1);
  });

  it("an empty or all-placeholder deck has no fan", () => {
    expect(featuredCardsOf([], DECK)).toEqual([]);
    expect(
      featuredCardsOf(
        [{ entry: { ...printingItem("main", "Nothing").entry, scryfall_id: null, image_url: null }, card: null }],
        DECK,
      ),
    ).toEqual([]);
  });
});
