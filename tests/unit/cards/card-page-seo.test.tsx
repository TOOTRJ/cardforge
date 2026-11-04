import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildCardJsonLd, CardDetails } from "@/components/cards/card-detail-content";
import { cardMetaDescription, cardPageTitle, cutAtWord, DESCRIPTION_BUDGET, TITLE_BUDGET } from "@/lib/cards/card-meta";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/gallery",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// The card page for a search engine (TODO CP2b): a title that says what the
// card is and whose, a description that says what it does (type line, cost,
// rules — then flavour), the card as text on the page, and structured data
// that carries the rules, the likes and comments, the card it remixes and
// its thumbnail. The sitemap lists each card's picture.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const HOST = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const THUMB = `${HOST}/storage/v1/object/public/card-renders/${OWNER}/${ID}.thumb.webp?v=3`;
const SITE = "https://www.pipglyph.com";

const CARD = {
  id: ID,
  owner_id: OWNER,
  slug: "archivist-of-lost-hours",
  title: "Archivist of Lost Hours",
  nickname: null,
  cost: "{2}{U}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Human", "Wizard"],
  rarity: "rare",
  color_identity: ["blue"],
  power: "2",
  toughness: "3",
  loyalty: null,
  defense: null,
  set_icon_code: null,
  layout: "normal",
  artist_credit: "R. Painter",
  rules_text: "Flying\nWhen ~ enters, draw a card. (Then discard a card.)\n{T}: Scry 1.",
  flavor_text: "Every page *remembers*.",
  frame_style: { template: "m15" } as Record<string, unknown>,
  tags: ["wizards"],
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  rendered_at: null,
  rendered_thumb_url: THUMB,
};

describe("the card page's title", () => {
  it("says what the card is and whose", () => {
    expect(cardPageTitle("Archivist", "creature", "dev_pro")).toBe("Archivist: custom MTG creature by @dev_pro");
  });

  it("drops the handle, then the type, to fit — never cutting the name", () => {
    const long = "Archivist of Lost Hours";
    const title = cardPageTitle(long, "creature", "a_very_long_handle");
    expect(title.length + " · PipGlyph".length).toBeLessThanOrEqual(TITLE_BUDGET);
    expect(title).toBe(`${long}: custom MTG creature`);
    const longest = "A Name So Long It Takes the Whole Result Line By Itself Alone";
    expect(cardPageTitle(longest, "creature", "x")).toBe(longest);
  });

  it("calls a legacy spell or an unknown type a card", () => {
    expect(cardPageTitle("Bolt", "spell", "u")).toBe("Bolt: custom MTG card by @u");
    expect(cardPageTitle("Bolt", null, "u")).toBe("Bolt: custom MTG card by @u");
  });
});

describe("the card page's meta description", () => {
  it("leads with the type line and cost, then the rules (the printed name for ~), then the flavour", () => {
    const text = cardMetaDescription(CARD, "dev_pro");
    expect(text.startsWith("Creature — Human Wizard, 2 generic, blue. Flying When Archivist of Lost Hours enters, draw a card.")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
    expect(text).not.toContain("~");
    expect(text).not.toContain("\n");
  });

  it("says what it is and whose when the card has no words", () => {
    const text = cardMetaDescription({ ...CARD, cost: null, rules_text: null, flavor_text: null }, "dev_pro");
    expect(text).toBe("Creature — Human Wizard. A custom Magic card by @dev_pro on PipGlyph.");
  });

  it("drops the flavour's upright markup", () => {
    const text = cardMetaDescription({ ...CARD, rules_text: null }, "dev_pro");
    expect(text).toContain("Every page remembers.");
    expect(text).not.toContain("*");
  });

  it("cuts at a word with one ellipsis", () => {
    expect(cutAtWord("alpha beta gamma delta", 15)).toBe("alpha beta…");
    expect(cutAtWord("short", 12)).toBe("short");
  });
});

describe("the card as text on the page", () => {
  const html = renderToStaticMarkup(<CardDetails card={CARD} />);

  it("prints the rules with ~ as the name, the reminder text in italics and the pips as pictures", () => {
    expect(html).toContain("When Archivist of Lost Hours enters, draw a card.");
    expect(html).toMatch(/class="italic text-muted"><span>\(Then discard a card\.\)/);
    expect(html).toContain('aria-label="tap"');
  });

  it("prints the flavour with its upright words upright, and the artist and stats", () => {
    expect(html).toMatch(/<p class="italic"><span>Every page <\/span><span class="not-italic">remembers<\/span>/);
    expect(html).toContain(">R. Painter<");
    expect(html).toMatch(/data-testid="card-text-stats"><span class="sr-only">Power and toughness: <\/span>2\/3</);
  });

  it("keeps the facts the text block does not hold: the mana value, the colour as pips and words, the frame linked", () => {
    const facts = html.slice(html.indexOf('data-testid="card-facts"'));
    expect(facts).toMatch(/>Mana value<\/dt><dd[^>]*>3</);
    expect(facts).toContain(">Blue<");
    expect(facts).toContain('href="/frames#frame-m15"');
    // The type line, cost, rarity and artist are the text block's, once.
    expect(facts).not.toContain(">Rarity<");
    expect(facts).not.toContain(">Type<");
  });
});

describe("the card's structured data", () => {
  const schema = buildCardJsonLd({
    inDecks: [],
    card: CARD,
    username: "dev_pro",
    ownerDisplay: "Dev Pro",
    siteBase: SITE,
    engagement: { likes: 4, comments: 2 },
    basedOn: `${SITE}/card/someone/the-original`,
  });

  it("carries the rules as text, with ~ as the name", () => {
    expect(schema.text).toBe("Flying\nWhen Archivist of Lost Hours enters, draw a card. (Then discard a card.)\n{T}: Scry 1.");
  });

  it("counts the likes and comments the page shows", () => {
    expect(schema.commentCount).toBe(2);
    expect(schema.interactionStatistic).toEqual([
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: 4 },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: 2 },
    ]);
  });

  it("names the card it remixes and its own thumbnail (never another card's object)", () => {
    expect(schema.isBasedOn).toBe(`${SITE}/card/someone/the-original`);
    expect(schema.thumbnailUrl).toMatch(new RegExp(`^${SITE}/render-cdn/`));
    const foreign = buildCardJsonLd({
      inDecks: [],
      card: { ...CARD, rendered_thumb_url: THUMB.replace(ID, "33333333-3333-4333-8333-333333333333") },
      username: "dev_pro",
      ownerDisplay: "Dev Pro",
      siteBase: SITE,
    });
    expect(foreign).not.toHaveProperty("thumbnailUrl");
    expect(foreign).not.toHaveProperty("interactionStatistic");
    expect(foreign).not.toHaveProperty("isBasedOn");
  });
});

describe("the page and the sitemap", () => {
  it("metadata reads the title and description helpers", () => {
    const page = readFileSync(join(process.cwd(), "app/(marketing)/card/[username]/[slug]/page.tsx"), "utf8");
    expect(page).toContain("const title = cardPageTitle(name, card.card_type, username);");
    expect(page).toContain("const description = cardMetaDescription(card, username);");
  });

  it("lists each public card's own stored bake as its image", () => {
    const sitemap = readFileSync(join(process.cwd(), "app/sitemap.ts"), "utf8");
    expect(sitemap).toContain("isStoredRenderUrl(card.rendered_image_url, { ownerId: card.owner_id, cardId: card.id })");
    expect(sitemap).toContain("...(bake ? { images: [`${baseUrl}${bake}`] } : {}),");
  });
});
