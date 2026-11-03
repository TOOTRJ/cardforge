import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// GET /api/decks/<id>/edit-context (the deck's edit drawer, TODO DK5.18)
// shows a linked card only where the DECK may show it (D3, canLinkIntoDeck
// — listDeckCards' rule): the owner's own at any visibility, another
// creator's only while PUBLIC. RLS hands an UNLISTED card to anyone, so the
// route must not: another creator's unlisted or private card reads as no
// card — "Make your own version" from the entry's name, as main's page —
// and none of its data is in the response.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DECK = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";
const CARD = "55555555-5555-4555-8555-555555555555";

const s = vi.hoisted(() => ({ card: null as null | Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/inline-editor", () => ({ getDeckInlineEditorMode: async () => "admins" }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: USER, is_admin: true }),
  createClient: async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { id: DECK, slug: "ness", title: "Ness", visibility: "public" } }),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => s.card,
  getFantasyGameSystem: async () => null,
}));
vi.mock("@/lib/decks/queries", () => ({
  listMyDecks: async () => [],
  getMyDeckCardWithDeck: async () => ({
    deck: { id: DECK, slug: "ness", owner_id: USER },
    entry: { id: ENTRY, deck_id: DECK, card_id: CARD, scryfall_id: null, name: "Cinderwing", quantity: 1, board: "main" },
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/decks/[id]/edit-context/route";

function card(owner: string, visibility: string) {
  return { id: CARD, owner_id: owner, slug: "cinderwing", title: "Cinderwing, Secret Name", visibility, rules_text: "Flying" };
}
async function open() {
  const res = await GET(new NextRequest(`http://x/api/decks/${DECK}/edit-context?edit=${ENTRY}`), {
    params: Promise.resolve({ id: DECK }),
  });
  return { status: res.status, text: await res.text() };
}

beforeEach(() => {
  s.card = null;
});

describe("the drawer's edit context and D3", () => {
  it.each(["unlisted", "private"])("another creator's %s card: no card data, a new card from the entry's name", async (visibility) => {
    s.card = card(OTHER, visibility);
    const { status, text } = await open();
    expect(status).toBe(200);
    const body = JSON.parse(text);
    expect(body.target).toMatchObject({ mode: "create", card: null, title: "Cinderwing", entryId: ENTRY });
    expect(body.target.deckRemix).toMatchObject({ deckCardId: ENTRY, entryName: "Cinderwing" });
    // "Open full page" agrees with main's page: Make your own version.
    expect(body.target.fullPageHref).toMatch(new RegExp(`^/create\\?deckCard=${ENTRY}&`));
    expect(body.target.fullPageHref).not.toContain("remix=");
    expect(text).not.toContain(CARD);
    expect(text).not.toContain("Secret Name");
    expect(text).not.toContain("Flying");
  });

  it("another creator's PUBLIC card: a remix of it", async () => {
    s.card = card(OTHER, "public");
    const body = JSON.parse((await open()).text);
    expect(body.target).toMatchObject({ mode: "remix", title: "Cinderwing, Secret Name" });
    expect(body.target.card.id).toBe(CARD);
  });

  it.each(["unlisted", "private"])("the owner's own %s card: edited", async (visibility) => {
    s.card = card(USER, visibility);
    const body = JSON.parse((await open()).text);
    expect(body.target).toMatchObject({ mode: "edit", title: "Cinderwing, Secret Name" });
  });
});
