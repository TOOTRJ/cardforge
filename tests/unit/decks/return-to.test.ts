import { describe, expect, it } from "vitest";
import {
  deckEntryReturnTo,
  deckReturnPath,
  entryEditTarget,
  ownDeckReturnPath,
  parseDeckEntryAnchor,
  RETURN_TO_PARAM,
} from "@/lib/decks/return-to";

// ---------------------------------------------------------------------------
// "Edit any card, then come back" (TODO DK5.5, lib/decks/return-to.ts): the
// creator follows `returnTo` only when it is a deck page and nothing more —
// the whitelist on safeRedirectPath — and every entry's Edit carries one
// that brings the owner back to that card.
// ---------------------------------------------------------------------------

const ENTRY = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";

describe("the returnTo whitelist", () => {
  it("takes a deck page, with or without our anchor", () => {
    expect(deckReturnPath("/deck/goblin-swarm")).toBe("/deck/goblin-swarm");
    expect(deckReturnPath(`/deck/goblin-swarm#entry-${ENTRY}`)).toBe(`/deck/goblin-swarm#entry-${ENTRY}`);
    expect(deckReturnPath(`/deck/ness#next-${ENTRY}`)).toBe(`/deck/ness#next-${ENTRY}`);
  });

  it("refuses everything else: other origins, other routes, queries, other anchors, tricks", () => {
    for (const value of [
      "https://evil.example/deck/ness",
      "//evil.example/deck/ness",
      "/\\evil.example",
      "/deck/ness/../../admin",
      "/deck/ness?import=1",
      "/deck/ness#anything",
      "/deck/Ness",
      "/deck/-ness",
      "/deck/ness/edit",
      "/dashboard",
      "/card/ness/edit",
      "javascript:alert(1)",
      "/deck/ness #entry",
      "/deck/%2F%2Fevil.example",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(deckReturnPath(value)).toBeNull();
    }
  });

  it("given a deck, only THAT deck's page", () => {
    expect(deckReturnPath(`/deck/ness#entry-${ENTRY}`, "ness")).toBe(`/deck/ness#entry-${ENTRY}`);
    expect(deckReturnPath(`/deck/other#entry-${ENTRY}`, "ness")).toBeNull();
  });

  it("a card's editor goes back only to one of the signed-in user's OWN decks", () => {
    expect(ownDeckReturnPath(`/deck/ness#entry-${ENTRY}`, ["goblins", "ness"])).toBe(`/deck/ness#entry-${ENTRY}`);
    expect(ownDeckReturnPath("/deck/ness", ["ness"])).toBe("/deck/ness");
    // Someone else's deck, a deck slug that only starts like one, a non-deck path.
    expect(ownDeckReturnPath(`/deck/theirs#entry-${ENTRY}`, ["ness"])).toBeNull();
    expect(ownDeckReturnPath("/deck/ness-2", ["ness"])).toBeNull();
    expect(ownDeckReturnPath("/dashboard", ["ness"])).toBeNull();
    expect(ownDeckReturnPath("/deck/ness", [])).toBeNull();
  });

  it("reads the anchor back off the hash", () => {
    expect(parseDeckEntryAnchor(`#entry-${ENTRY}`)).toEqual({ kind: "entry", entryId: ENTRY });
    expect(parseDeckEntryAnchor(`#next-${ENTRY.toUpperCase()}`)).toEqual({ kind: "next", entryId: ENTRY });
    expect(parseDeckEntryAnchor("#entry-nope")).toBeNull();
    expect(parseDeckEntryAnchor("")).toBeNull();
  });
});

describe("an entry's Edit", () => {
  const back = (kind: "entry" | "next" = "entry") => `${RETURN_TO_PARAM}=${encodeURIComponent(deckEntryReturnTo("ness", ENTRY, kind))}`;
  const entry = (over: Record<string, unknown> = {}) => ({ id: ENTRY, scryfall_id: null, card_id: null, ...over });

  it("an imported card: Customize, the creator on the entry", () => {
    expect(entryEditTarget({ entry: entry({ scryfall_id: "sf-1" }), card: null }, "ness")).toEqual({
      href: `/create?deckCard=${ENTRY}&${back()}`,
      label: "Customize",
    });
  });

  it("the owner's own card: its editor", () => {
    const card = { id: "c-1", slug: "ember-wyrm" };
    expect(entryEditTarget({ entry: entry({ card_id: "c-1" }), card, cardOwner: null }, "ness")).toEqual({
      href: `/card/ember-wyrm/edit?${back()}`,
      label: "Edit card",
    });
  });

  it("another creator's card (D3): a remix in the owner's account, taking the entry's place", () => {
    const card = { id: "c-2", slug: "cinderwing" };
    expect(entryEditTarget({ entry: entry({ card_id: "c-2" }), card, cardOwner: { username: "dev_artist" } }, "ness")).toEqual({
      href: `/create?deckCard=${ENTRY}&remix=c-2&${back()}`,
      label: "Remix",
    });
  });

  it("a placeholder, or a card that's gone: your own version, from the creator on the entry", () => {
    expect(entryEditTarget({ entry: entry(), card: null }, "ness").label).toBe("Make your own version");
    expect(entryEditTarget({ entry: entry({ card_id: "gone", scryfall_id: "sf-1" }), card: null }, "ness").href).toBe(
      `/create?deckCard=${ENTRY}&${back()}`,
    );
  });

  it("the walk's Edit comes back to `#next-`", () => {
    expect(entryEditTarget({ entry: entry({ scryfall_id: "sf-1" }), card: null }, "ness", "next").href).toBe(
      `/create?deckCard=${ENTRY}&${back("next")}`,
    );
  });

  it("every Edit's way back passes the whitelist, for its own deck", () => {
    const href = entryEditTarget({ entry: entry({ scryfall_id: "sf-1" }), card: null }, "ness").href;
    const returnTo = new URL(href, "https://pipglyph.com").searchParams.get(RETURN_TO_PARAM);
    expect(deckReturnPath(returnTo, "ness")).toBe(`/deck/ness#entry-${ENTRY}`);
  });
});
