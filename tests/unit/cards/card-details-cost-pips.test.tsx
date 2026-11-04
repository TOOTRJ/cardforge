import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CardDetails } from "@/components/cards/card-detail-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// The card page's "Card details" draw a mana cost as the card's own pips
// (CardPip through ManaCostGlyphs' `disc` — UI1's look), decorative, with
// the cost in words beside them for a screen reader and a crawler. The raw
// brace codes ("{2}{U}") are no longer printed as text.
// ---------------------------------------------------------------------------

const CARD = {
  title: "Archivist",
  cost: "{2}{U}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human", "Wizard"],
  rarity: "rare",
  color_identity: ["blue"],
  power: "2",
  toughness: "2",
  loyalty: null,
  defense: null,
  set_icon_code: null,
  layout: "normal",
  artist_credit: null,
  frame_style: { template: "m15" } as Record<string, unknown>,
  back_face: null as unknown,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
};

const costCell = (html: string) => html.slice(html.indexOf('data-testid="card-details-cost"'), html.indexOf('data-testid="card-text-type"'));

describe("Card details: the mana cost as pips", () => {
  it("draws the card's pips, hidden from assistive tech, and says the cost in words", () => {
    const cell = costCell(renderToStaticMarkup(<CardDetails card={CARD} />));
    expect(cell).toContain('data-pip="2"');
    expect(cell).toContain('data-pip="u"');
    expect(cell).toContain('aria-hidden="true"');
    expect(cell).toContain('<span class="sr-only">Mana cost: 2 generic, blue</span>');
    // The codes are no longer printed as text (the hidden picture's own
    // label may still name them).
    expect(cell).not.toMatch(/>\{2\}\{U\}/);
    // mana-font's off-card look is not used here.
    expect(cell).not.toContain("ms-cost");
  });

  it("an owner's custom pip is drawn as on their card", () => {
    const html = renderToStaticMarkup(
      <CardDetails card={CARD} pipOverrides={{ U: "https://example.com/blue.png" }} />,
    );
    expect(costCell(html)).toContain('src="https://example.com/blue.png"');
  });

  it("a card with no cost draws no pips and has no mana value", () => {
    const html = renderToStaticMarkup(<CardDetails card={{ ...CARD, cost: null }} />);
    expect(html).not.toContain("card-details-cost");
    expect(html).not.toContain("Mana value");
  });

  it("states the mana value beside the facts", () => {
    const html = renderToStaticMarkup(<CardDetails card={CARD} />);
    expect(html).toMatch(/>Mana value<\/dt><dd[^>]*>3</);
  });

  it("a back face's cost is drawn as pips too", () => {
    const html = renderToStaticMarkup(
      <CardDetails
        card={{
          ...CARD,
          frame_style: { template: "m15dfcfront" },
          back_face: {
            title: "Back",
            cost: "{1}{G}",
            card_type: "sorcery",
            frame_style: { template: "m15dfcback" },
          },
        }}
       
      />,
    );
    const back = html.slice(html.indexOf('data-testid="card-back-details"'), html.indexOf('data-testid="card-facts"'));
    expect(html).toContain('data-testid="card-back-details"');
    expect(back).toContain('data-pip="g"');
    expect(back).toContain('<span class="sr-only">Mana cost: 1 generic, green</span>');
  });
});
