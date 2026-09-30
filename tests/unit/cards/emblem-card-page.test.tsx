import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildCardJsonLd, CardDetails } from "@/components/cards/card-detail-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// TODO 6.23 on the public card page: its "Card details" block and its
// CreativeWork JSON-LD keep in step with what the render shows (CLAUDE.md's
// SEO contract). An emblem has no rarity (CR 114) — the "common" it stores
// only inks its set symbol — so neither names one; any other card still
// does. The type line reads "Emblem" and the colour "Colorless".
// ---------------------------------------------------------------------------

type Row = {
  [key: string]: unknown;
  cost: string | null;
  card_type: string | null;
  supertype: string | null;
  subtypes: string[] | null;
  rarity: string | null;
  color_identity: string[] | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  set_icon_code: string | null;
  layout: string | null;
  artist_credit: string | null;
  created_at: string;
  updated_at: string;
};

const EMBLEM: Row = {
  id: "c0000000-0000-4000-a000-000000000026",
  slug: "veyra-stormbound-emblem",
  title: "Veyra, Stormbound",
  cost: null,
  card_type: "emblem",
  supertype: null,
  subtypes: [] as string[],
  rarity: "common",
  color_identity: ["colorless"],
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
  set_icon_code: null,
  layout: "normal",
  artist_credit: "PipGlyph Studio",
  flavor_text: null,
  rules_text: "Instant and sorcery spells you cast cost {2} less to cast.",
  tags: ["emblems"],
  frame_style: { template: "emblem" },
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
  rendered_at: null,
};

const TOKEN: Row = {
  ...EMBLEM,
  id: "c0000000-0000-4000-a000-000000000099",
  slug: "soldier",
  title: "Soldier",
  card_type: "token",
  supertype: "Creature",
  subtypes: ["Soldier"],
  color_identity: ["white"],
  power: "1",
  toughness: "1",
  rules_text: null,
  frame_style: { template: "m15token" },
};

function details(card: Row): string {
  return renderToStaticMarkup(<CardDetails card={card} inDecks={[]} />);
}

function jsonLd(card: Row) {
  return buildCardJsonLd({
    inDecks: [],
    card: card as never,
    username: "dev_artist",
    ownerDisplay: "Dev Artist",
    siteBase: "https://pipglyph.com",
  }) as { keywords: string; image: { caption: string } };
}

describe("an emblem's card page names no rarity (CR 114)", () => {
  it("Card details: type Emblem, no rarity row, colourless, no stats", () => {
    const html = details(EMBLEM);
    expect(html).toContain(">Emblem<");
    expect(html).not.toContain(">Rarity<");
    expect(html).not.toContain(">Common<");
    expect(html).toContain(">Colorless<");
    expect(html).not.toContain(">Stats<");
    // Any other card keeps its rarity row.
    expect(details(TOKEN)).toContain(">Rarity<");
  });

  it("JSON-LD: no rarity in the caption or the keywords", () => {
    const emblem = jsonLd(EMBLEM);
    expect(emblem.image.caption).toBe("Veyra, Stormbound — custom MTG-style Emblem");
    expect(emblem.keywords.split(", ")).not.toContain("common");
    expect(emblem.keywords.split(", ")).toContain("emblem");
    const token = jsonLd(TOKEN);
    expect(token.image.caption).toContain(", common");
    expect(token.keywords.split(", ")).toContain("common");
  });
});

describe("an emblem's gallery tile names no rarity either", () => {
  it("the thumbnail's alt text", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    const { GalleryCardTile } = await import("@/components/cards/gallery-card-tile");
    const OWNER = "d0000000-0000-4000-a000-000000000004";
    const tile = (card: Row) =>
      renderToStaticMarkup(
        <GalleryCardTile
          card={
            {
              ...card,
              owner_id: OWNER,
              owner: { username: "dev_artist" },
              likes_count: 0,
              rendered_image_url: `https://auth.pipglyph.com/storage/v1/object/public/card-renders/${OWNER}/${card.id}.png`,
              rendered_thumb_url: null,
            } as never
          }
          isAuthed={false}
        />,
      );
    expect(tile(EMBLEM)).toContain('alt="Veyra, Stormbound — custom MTG-style emblem"');
    expect(tile(TOKEN)).toContain('alt="Soldier — custom MTG-style token, common rarity"');
  });
});
