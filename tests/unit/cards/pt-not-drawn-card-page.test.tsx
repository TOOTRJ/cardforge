import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildCardJsonLd, CardDetails } from "@/components/cards/card-detail-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// The public card page's "Card details" list only the stats the render
// shows (CLAUDE.md's SEO contract). A face's P/T is drawn when its type
// prints one AND its frame has the slot (lib/cards/pt-drawn.ts): a saga
// whose type says Creature (FIN's Summon: Bahamut) keeps its 9/9 in the
// row, the picture shows none — the details used to list "Stats 9/9" under
// it. Stored data is untouched; the row comes back the day the frame draws
// it (the saga's is TODO 4.5c).
// ---------------------------------------------------------------------------

const SUMMON = {
  id: "c0000000-0000-4000-a000-000000000501",
  slug: "summon-bahamut",
  title: "Summon: Bahamut",
  cost: "{9}",
  card_type: "enchantment",
  supertype: "Creature",
  subtypes: ["Saga", "Dragon"],
  rarity: "mythic",
  color_identity: ["colorless"],
  power: "9",
  toughness: "9",
  loyalty: null as string | null,
  defense: null as string | null,
  set_icon_code: null,
  layout: "saga",
  artist_credit: "PipGlyph Studio",
  flavor_text: null,
  rules_text: null,
  tags: [] as string[],
  frame_style: { template: "saga" } as Record<string, unknown>,
  back_face: null as unknown,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  rendered_at: null,
};
type Row = typeof SUMMON;

const details = (card: Row) => renderToStaticMarkup(<CardDetails card={card} inDecks={[]} />);

describe("Card details: the stats row follows the frame", () => {
  it("a saga creature: no Stats row, the type line still says Creature", () => {
    const html = details(SUMMON);
    expect(html).toContain("Enchantment Creature — Saga Dragon");
    expect(html).not.toContain(">Stats<");
    expect(html).not.toContain("9/9");
  });

  it("the same card on a frame with the slot lists it", () => {
    const html = details({ ...SUMMON, layout: "normal", frame_style: { template: "nyx" } });
    expect(html).toContain(">Stats<");
    expect(html).toContain(">9/9<");
    // A row with no stored template is the default frame.
    expect(details({ ...SUMMON, layout: "normal", frame_style: {} })).toContain(">9/9<");
  });

  it("a battle whose words say Creature lists the defense its shield shows, not a P/T", () => {
    const html = details({
      ...SUMMON,
      card_type: "battle",
      subtypes: ["Siege"],
      layout: "battle",
      defense: "5",
      frame_style: { template: "battle" },
    });
    expect(html).toContain(">Defense 5<");
    expect(html).not.toContain("9/9");
  });

  it("a creature on m15 is unchanged", () => {
    const html = details({ ...SUMMON, card_type: "creature", supertype: null as never, subtypes: ["Dragon"], layout: "normal", frame_style: { template: "m15" } });
    expect(html).toContain(">9/9<");
  });

  it("a back face on a land body (no slot) lists none; on a spell body it does", () => {
    const back = {
      title: "Dryad Grove",
      card_type: "land",
      supertype: "Creature",
      subtypes: ["Forest", "Dryad"],
      power: "1",
      toughness: "1",
      color_identity: ["green"],
    };
    const card = (body: string, front: string): Row => ({
      ...SUMMON,
      card_type: "creature",
      supertype: null as never,
      subtypes: ["Dryad"],
      power: "2",
      toughness: "3",
      layout: "normal",
      frame_style: { template: front },
      back_face: { ...back, frame_style: { template: body } },
    });
    const land = details(card("m15mdfclandback", "m15mdfcfront"));
    expect(land).toContain('data-testid="card-back-details"');
    expect(land).toContain(">2/3<");
    expect(land).not.toContain(">1/1<");
    const spell = details(card("m15mdfcback", "m15mdfcfront"));
    expect(spell).toContain(">2/3<");
    expect(spell).toContain(">1/1<");
  });
});

describe("JSON-LD carries no stats at all", () => {
  it("neither on the saga nor on a frame that draws them", () => {
    for (const frame_style of [{ template: "saga" }, { template: "nyx" }]) {
      const json = JSON.stringify(
        buildCardJsonLd({
          inDecks: [],
          card: { ...SUMMON, frame_style } as never,
          username: "dev_pro",
          ownerDisplay: "Dev Pro",
          siteBase: "https://pipglyph.com",
        }),
      );
      expect(json).not.toContain("9/9");
      expect(json).not.toMatch(/power|toughness/i);
    }
  });
});
