// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeckRemixCreditLine } from "@/components/decks/deck-remix-credit";
import { remixCreditOf } from "@/lib/decks/remix-credit";
import type { DeckToken } from "@/lib/decks/deck-tokens";

// ---------------------------------------------------------------------------
// TODO DK5.16's two small surfaces on the deck page:
//   * "Tokens & emblems" — a list, never deck entries; nothing made → no
//     section; a real token's Scryfall "small" picture, a PipGlyph card's a
//     labelled placeholder; who makes each one; the one note about how
//     PipGlyph cards are read.
//   * the clone's credit — "Remixed from <deck> by @owner" while the source
//     is public, "Remixed from another deck" otherwise (never its name or
//     link), nothing for a deck that isn't a clone.
// ---------------------------------------------------------------------------

vi.mock("@/lib/decks/deck-tokens-server", () => ({ listDeckTokens: vi.fn() }));
vi.mock("server-only", () => ({}));

const { DeckTokensList } = await import("@/components/decks/deck-tokens-section");

afterEach(cleanup);

const treasure: DeckToken = {
  key: "token|treasure",
  kind: "token",
  name: "Treasure",
  typeLine: "Token Artifact — Treasure",
  details: null,
  scryfallId: "22222222-2222-4222-8222-222222222222",
  imageUrl: "https://cards.scryfall.io/small/front/2/2/22222222-2222-4222-8222-222222222222.jpg",
  makers: ["Goldspan Dragon", "Pirate"],
};
const beast: DeckToken = {
  key: "token|beast",
  kind: "token",
  name: "Beast",
  typeLine: "Token Creature — Beast",
  details: "4/4 green",
  scryfallId: null,
  imageUrl: null,
  makers: ["The Sundering of Aldmoor"],
};
const emblem: DeckToken = { ...beast, key: "emblem|veyra", kind: "emblem", name: "Veyra, Stormbound Emblem", typeLine: "Emblem", details: "Flying", makers: ["Veyra, Stormbound"] };

describe("DeckTokensList", () => {
  it("draws nothing when the deck makes nothing", () => {
    const { container } = render(<DeckTokensList tokens={[]} realCardsFailed={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists each token and emblem with what makes it", () => {
    render(<DeckTokensList tokens={[treasure, beast, emblem]} realCardsFailed={false} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("Tokens & emblems");
    expect(heading.textContent).toContain("2 tokens · 1 emblem");
    expect(screen.getByText("Made by Goldspan Dragon, Pirate")).toBeTruthy();
    expect(screen.getByText("4/4 green")).toBeTruthy();
    expect(screen.getByText("Veyra, Stormbound Emblem")).toBeTruthy();
    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe(treasure.imageUrl);
    expect(screen.getByText(/read from their rules text/)).toBeTruthy();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
  });

  it("says so when the real cards' answer failed", () => {
    render(<DeckTokensList tokens={[beast]} realCardsFailed />);
    expect(screen.getByText(/couldn't be loaded just now/)).toBeTruthy();
  });
});

describe("DeckRemixCreditLine", () => {
  it("names a public source and its owner, linking both", () => {
    render(<DeckRemixCreditLine credit={remixCreditOf({ source_slug: "dragonstorm", source_title: "Dragonstorm", source_owner_username: "ann" })} />);
    expect(screen.getByRole("link", { name: "Dragonstorm" }).getAttribute("href")).toBe("/deck/dragonstorm");
    expect(screen.getByRole("link", { name: "@ann" }).getAttribute("href")).toBe("/profile/ann");
  });

  it("a source that isn't public (or is gone): 'another deck', no name, no link", () => {
    render(<DeckRemixCreditLine credit={remixCreditOf({ source_slug: null, source_title: null, source_owner_username: null })} />);
    expect(screen.getByText("Remixed from another deck")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("not a clone: nothing", () => {
    const { container } = render(<DeckRemixCreditLine credit={null} />);
    expect(container.innerHTML).toBe("");
    expect(remixCreditOf(null)).toBeNull();
  });
});
