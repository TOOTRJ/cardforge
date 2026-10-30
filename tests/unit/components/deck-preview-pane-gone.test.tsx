// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createPreviewStore, DeckPreviewPane } from "@/components/decks/deck-preview-pane";
import type { ViewRow } from "@/components/decks/deck-row-ui";
import { deckRowOf } from "@/lib/decks/deck-view";
import { GONE_CARD_NAME, PRIVATE_CARD_NAME, publicDeckItems } from "@/lib/decks/private-card-name";

// ---------------------------------------------------------------------------
// #681's preview pane, a visitor's hidden entries (0153): a DELETED card is
// "No longer available", never "Private card"; a private card stays one.
// ---------------------------------------------------------------------------

const entry = (over: Record<string, unknown>) => ({
  id: "e-1",
  deck_id: "d",
  board: "main",
  quantity: 1,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  card_id: null,
  scryfall_id: null,
  source: "creator",
  name: "Ashen Prototype",
  type_line: null,
  mana_cost: null,
  mana_value: null,
  color_identity: [],
  rarity: null,
  set_code: null,
  collector_number: null,
  image_url: null,
  featured_rank: null,
  ...over,
});

function visitorRow(over: Record<string, unknown>): ViewRow {
  const [item] = publicDeckItems([{ entry: entry(over), card: null, cardOwner: null }], false);
  return deckRowOf(item as never, false) as unknown as ViewRow;
}

function pane(row: ViewRow) {
  return render(
    <DeckPreviewPane store={createPreviewStore()} rows={[row]} showProxies={false} actions={null} onDetails={() => {}} />,
  );
}

afterEach(cleanup);

describe("the preview pane, for a visitor", () => {
  it("a deleted card reads No longer available — its old title nowhere", () => {
    pane(visitorRow({}));
    expect(screen.getAllByText(GONE_CARD_NAME).length).toBeGreaterThan(0);
    expect(screen.queryByText(PRIVATE_CARD_NAME)).toBeNull();
    expect(screen.queryByText(/Ashen Prototype/)).toBeNull();
  });

  it("a private card stays a Private card", () => {
    pane(visitorRow({ card_id: "c-private", name: "Secret" }));
    expect(screen.getAllByText(PRIVATE_CARD_NAME).length).toBeGreaterThan(0);
    expect(screen.queryByText(GONE_CARD_NAME)).toBeNull();
  });
});
