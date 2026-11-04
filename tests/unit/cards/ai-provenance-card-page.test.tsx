import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AI_COMPOSITE_SOURCE_TYPE, buildCardJsonLd, CardDetails } from "@/components/cards/card-detail-content";
import { AiProvenanceTags } from "@/components/cards/ai-provenance-tags";
import { aiProvenanceOf } from "@/lib/cards/ai-provenance";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// The public card page says how much of the card AI made (TODO CP1): a tag
// under the byline, a "Made with AI" line in Card details and, where the
// picture is AI's, the image's digital source type in the JSON-LD. A card
// made by hand says nothing anywhere. Page data only — the bake and the
// renderers never read `ai_fields`.
// ---------------------------------------------------------------------------

const CARD = {
  id: "c0000000-0000-4000-a000-000000000001",
  slug: "emberwake-tyrant",
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  set_icon_code: null,
  layout: "normal",
  artist_credit: "Tester",
  flavor_text: "Its allies learned to fly behind it.",
  rules_text: "Flying, haste",
  tags: [],
  frame_style: { template: "m15" },
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
  rendered_at: null,
  back_face: null,
  ai_fields: [] as string[],
};
const ALL_TEXT = ["title", "cost", "type_line", "rules_text", "flavor_text", "stats"];

const page = (card: typeof CARD) => {
  const provenance = aiProvenanceOf(card);
  return {
    tags: renderToStaticMarkup(<AiProvenanceTags provenance={provenance} />),
    details: renderToStaticMarkup(<CardDetails card={card} aiProvenance={provenance} />),
    jsonLd: buildCardJsonLd({ inDecks: [], card, username: "tester", ownerDisplay: "Tester", siteBase: "https://pipglyph.com" }) as {
      image: Record<string, unknown>;
    },
  };
};

describe("the card page's AI provenance", () => {
  it("a card made by hand says nothing", () => {
    const { tags, details, jsonLd } = page(CARD);
    expect(tags).toBe("");
    expect(details).not.toContain("Made with AI");
    expect(jsonLd.image).not.toHaveProperty("digitalSourceType");
  });

  it("a card AI wrote whole, with its picture: both tags, one line, the image's source type", () => {
    const { tags, details, jsonLd } = page({ ...CARD, ai_fields: [...ALL_TEXT, "art"] });
    expect(tags).toContain('aria-label="AI use"');
    expect(tags).toContain("Card generated with AI");
    expect(tags).toContain("Art generated with AI");
    expect(details).toContain("Made with AI");
    expect(details).toContain("Card and art generated with AI.");
    expect(jsonLd.image.digitalSourceType).toBe(AI_COMPOSITE_SOURCE_TYPE);
  });

  it("the maker's own upload over the AI picture: the art label is gone, the card's stays", () => {
    const { tags, jsonLd } = page({ ...CARD, ai_fields: ALL_TEXT });
    expect(tags).toContain("Card generated with AI");
    expect(tags).not.toContain("Art generated with AI");
    expect(jsonLd.image).not.toHaveProperty("digitalSourceType");
  });

  it("AI-filled fields on a card the maker wrote: AI helped with parts", () => {
    const { tags, details } = page({ ...CARD, ai_fields: ["flavor_text"] });
    expect(tags).toContain("AI helped with parts of this card");
    expect(details).toContain("AI helped with parts of this card.");
  });

  it("the page wires the tag into the header and the line into Card details", () => {
    const source = readFileSync(join(process.cwd(), "components/cards/card-detail-content.tsx"), "utf8");
    expect(source).toContain("<AiProvenanceTags provenance={aiProvenance} />");
    expect(source).toContain("<CardDetails card={card} aiProvenance={aiProvenance} pipOverrides={pipOverrides} />");
  });

  it("no renderer or bake reads it (page data, not card art)", () => {
    for (const file of ["lib/render/card-image.tsx", "lib/cards/bake-core.ts", "lib/cards/preview-data.ts", "components/cards/card-preview.tsx"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8"), file).not.toContain("ai_fields");
    }
  });
});
