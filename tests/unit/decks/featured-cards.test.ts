import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAN_MAX, featuredCardsOf, type FeaturableCard } from "@/lib/decks/featured";

// ---------------------------------------------------------------------------
// TODO DK6.5: the deck hero's fan — commanders first, then a seeded pick of
// the deck's own baked PipGlyph cards, then real printings; never a private
// card, never a card without its 600 px thumb, the same fan on every render.
// ---------------------------------------------------------------------------

const HOST = "https://auth.pipglyph.com";
const OWNER = "11111111-1111-4111-8111-111111111111";
/** The deck: its id seeds the fill, its owner's cards are its own (D3). */
const DECK = { id: "33333333-3333-4333-8333-333333333333", owner_id: OWNER };
const OTHER_CREATOR = "22222222-2222-4222-8222-222222222222";

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
    const other = keys(featuredCardsOf(items, { id: "44444444-4444-4444-8444-444444444444", owner_id: OWNER }));
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

describe("featuredCardsOf fills to 3–5 behind the commanders", () => {
  it("a commander plus the fill: the commander first, then baked cards, then printings, five in all", () => {
    const commander = customItem("commander");
    const customs = Array.from({ length: 2 }, () => customItem("main"));
    const printings = Array.from({ length: 4 }, (_, i) => printingItem("main", `Spell ${i}`));
    const fan = featuredCardsOf([...printings, ...customs, commander], DECK);
    expect(fan).toHaveLength(5);
    expect(fan[0].key).toBe(`card:${commander.card.id}`);
    expect(fan.slice(1, 3).map((c) => c.key).sort()).toEqual(customs.map((c) => `card:${c.card.id}`).sort());
    expect(fan.slice(3).every((c) => c.kind === "printing")).toBe(true);
  });

  it("two commanders plus the fill: both partners first, in the deck's order, then three more", () => {
    const first = printingItem("commander", "Tymna the Weaver", "Legendary Creature — Human Cleric");
    const second = customItem("commander");
    const customs = Array.from({ length: 6 }, () => customItem("main"));
    const fan = featuredCardsOf([second, ...customs, first], DECK);
    expect(fan).toHaveLength(5);
    expect(fan.slice(0, 2).map((c) => c.key)).toEqual([`print:${first.entry.scryfall_id}`, `card:${second.card.id}`]);
    expect(fan.slice(2).every((c) => c.kind === "custom")).toBe(true);
  });

  it("a deck with only two cards that may stand shows those two — never padded", () => {
    const privateCommander = customItem("commander", { visibility: "private" });
    const unbaked = customItem("main", { rendered_image_url: null, rendered_thumb_url: null });
    const fan = featuredCardsOf(
      [
        privateCommander,
        unbaked,
        customItem("main"),
        printingItem("main", "Sol Ring", "Artifact"),
        printingItem("main", "Mountain", "Basic Land — Mountain"),
        printingItem("maybe", "Opt"),
        { entry: { ...printingItem("main", "Placeholder").entry, scryfall_id: null, image_url: null }, card: null },
      ],
      DECK,
    );
    expect(fan).toHaveLength(2);
    expect(fan.map((c) => c.kind).sort()).toEqual(["custom", "printing"]);
  });

  it("a commander that may not stand doesn't stop the fill (dev's Cinderwing: an unbaked commander)", () => {
    const unbakedCommander = customItem("commander", { rendered_image_url: null, rendered_thumb_url: null });
    const fan = featuredCardsOf(
      [unbakedCommander, ...Array.from({ length: 3 }, (_, i) => printingItem("main", `Real ${i}`))],
      DECK,
    );
    expect(fan.map((c) => c.title)).toEqual(expect.arrayContaining(["Real 0", "Real 1", "Real 2"]));
    expect(fan).toHaveLength(3);
  });

  it("a PUBLIC card with no thumb yet stands in as its entry's printing; a private one never does", () => {
    const unbakedRemix = customItem("commander", { rendered_image_url: null, rendered_thumb_url: null });
    unbakedRemix.entry.scryfall_id = "sf-krenko";
    unbakedRemix.entry.image_url = "https://cards.scryfall.io/normal/front/k/r/krenko.jpg";
    const privateRemix = customItem("main", { visibility: "private" });
    privateRemix.entry.scryfall_id = "sf-secret";
    privateRemix.entry.image_url = "https://cards.scryfall.io/normal/front/s/e/secret.jpg";
    const fan = featuredCardsOf([unbakedRemix, privateRemix], DECK);
    expect(fan).toEqual([{ kind: "printing", key: "print:sf-krenko", title: unbakedRemix.entry.name, imageUrl: unbakedRemix.entry.image_url }]);
  });

  it("the share image's fill (printings: false): commanders first, filled from baked cards alone, still up to five", () => {
    const printedCommander = printingItem("commander", "Krenko, Mob Boss", "Legendary Creature — Goblin");
    const bakedCommander = customItem("commander");
    const customs = Array.from({ length: 6 }, () => customItem("main"));
    const fan = featuredCardsOf(
      [printedCommander, bakedCommander, ...customs, ...Array.from({ length: 4 }, (_, i) => printingItem("main", `Real ${i}`))],
      DECK,
      { printings: false },
    );
    expect(fan).toHaveLength(5);
    expect(fan.every((c) => c.kind === "custom")).toBe(true);
    expect(fan[0].key).toBe(`card:${bakedCommander.card.id}`);
    // Two baked cards and no others: two, never a printing to pad it.
    expect(featuredCardsOf([customItem("main"), customItem("main"), printingItem("main", "Opt")], DECK, { printings: false })).toHaveLength(2);
  });
});

describe("featuredCardsOf and other creators' cards (D3)", () => {
  it("another creator's PUBLIC card may stand; their UNLISTED or private card never — nor its printing", () => {
    const theirsPublic = customItem("main", { owner_id: OTHER_CREATOR });
    // Its bake lives in ITS maker's folder.
    const theirRender = (suffix: string) =>
      `${HOST}/storage/v1/object/public/card-renders/${OTHER_CREATOR}/${theirsPublic.card.id}${suffix}?v=1`;
    theirsPublic.card.rendered_image_url = theirRender(".png");
    theirsPublic.card.rendered_thumb_url = theirRender(".thumb.webp");
    const theirsUnlisted = customItem("commander", { owner_id: OTHER_CREATOR, visibility: "unlisted" });
    theirsUnlisted.entry.scryfall_id = "sf-unlisted";
    theirsUnlisted.entry.image_url = "https://cards.scryfall.io/normal/front/u/n/unlisted.jpg";
    const theirsPrivate = customItem("main", { owner_id: OTHER_CREATOR, visibility: "private" });
    const ownUnlisted = customItem("main", { visibility: "unlisted" });
    const fan = featuredCardsOf([theirsPublic, theirsUnlisted, theirsPrivate, ownUnlisted], DECK);
    expect(keys(fan).sort()).toEqual([`card:${theirsPublic.card.id}`, `card:${ownUnlisted.card.id}`].sort());
    // The share image's fill reads the same rule.
    expect(keys(featuredCardsOf([theirsUnlisted], DECK, { printings: false }))).toEqual([]);
  });
});
