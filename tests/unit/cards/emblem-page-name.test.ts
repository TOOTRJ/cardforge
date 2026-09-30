import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// Owner decision 2026-09-29: an emblem's web address and page name include
// "Emblem", as Scryfall names it ("Kaito, Cunning Infiltrator Emblem" →
// …/kaito-cunning-infiltrator-emblem). The card itself still prints the
// walker's name in the bar and "Emblem" on the type line — the render (and
// its preview data) is unchanged. cardPageName is the one rule: the slug a
// new emblem is given (createCardAction), the page's <title>, OG / Twitter
// title and image alt, the JSON-LD name / headline and the oEmbed title.
// ---------------------------------------------------------------------------

const USER = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";
const GAME = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  client: null as unknown,
  verified: [] as string[],
  taken: new Set<string>(),
  pageCard: null as unknown,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
  getCurrentUser: async () => ({ id: USER }),
  getCurrentUsername: async () => "tester",
  getCurrentProfile: async () => ({ id: USER, is_admin: false }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
  isAdminConfigured: () => false,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getVerifiedFrameKeys: async () => state.verified,
}));
vi.mock("@/lib/cards/queries", () => ({
  getCardById: async () => null,
  isSlugTakenForCurrentUser: async (slug: string) => state.taken.has(slug),
  getCardByOwnerAndSlug: async () => state.pageCard,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ premiumFrames: true, removeWatermark: true, cardCapacity: -1 }),
}));
vi.mock("@/lib/cards/bake-render", () => ({ bakeAndPersistCardRender: vi.fn() }));
vi.mock("@/lib/decks/membership", () => ({ addCustomCardEntryToDeck: vi.fn() }));
vi.mock("@/lib/analytics/funnel-server", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/cards/revalidate", () => ({
  purgeHiddenCard: vi.fn(),
  purgeHiddenCards: vi.fn(),
  revalidateCardListSurfaces: vi.fn(),
  revalidateCardPaths: vi.fn(),
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
// The page body is covered elsewhere; only its metadata runs here.
vi.mock("@/components/cards/card-detail-content", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/cards/card-detail-content")>();
  return { ...real, CardDetailContent: () => null };
});

import { cardPageName } from "@/lib/cards/emblem";
import { createCardAction } from "@/lib/cards/actions";
import { buildCardJsonLd } from "@/components/cards/card-detail-content";
import { generateMetadata } from "@/app/(marketing)/card/[username]/[slug]/page";

function db() {
  const stub = chainClient((table): ChainAnswer =>
    table === "cards" ? { data: { id: CARD, slug: "saved" }, error: null } : { error: null },
  );
  state.client = stub.client;
  return stub;
}

const insertedSlug = (stub: ReturnType<typeof chainClient>) =>
  (payloadOf(stub.forTable("cards").at(-1)!.calls, "insert") as { slug: string }).slug;

function emblemPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Kaito, Cunning Infiltrator",
    game_system_id: GAME,
    card_type: "emblem",
    color_identity: ["colorless"],
    subtypes: [],
    rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
    frame_style: { template: "emblem" },
    visibility: "public",
    art_url: "https://example.com/art.png",
    ...overrides,
  };
}

beforeEach(() => {
  state.verified = [frameComboKey("emblem", "c"), frameComboKey("m15", "g")];
  state.taken = new Set();
  state.pageCard = null;
});

describe("cardPageName", () => {
  it("names an emblem '<walker> Emblem', as Scryfall does", () => {
    expect(cardPageName("Kaito, Cunning Infiltrator", "emblem")).toBe("Kaito, Cunning Infiltrator Emblem");
    expect(cardPageName("  Vivien   Reid ", "emblem")).toBe("Vivien Reid Emblem");
  });

  it("never doubles it, and names an unnamed emblem 'Emblem'", () => {
    expect(cardPageName("Kaito Emblem", "emblem")).toBe("Kaito Emblem");
    expect(cardPageName("kaito emblem", "emblem")).toBe("kaito emblem");
    expect(cardPageName("", "emblem")).toBe("Emblem");
    expect(cardPageName(null, "emblem")).toBe("Emblem");
    // "Emblem" inside a word is not the suffix.
    expect(cardPageName("Lord of Nonemblem", "emblem")).toBe("Lord of Nonemblem Emblem");
  });

  it("leaves every other card's title as it is", () => {
    expect(cardPageName("Soldier", "token")).toBe("Soldier");
    expect(cardPageName("Grizzly Bears", "creature")).toBe("Grizzly Bears");
    expect(cardPageName(" Odd  Spacing ", null)).toBe(" Odd  Spacing ");
  });
});

describe("a new emblem's address (createCardAction)", () => {
  it("is its page name: …-emblem", async () => {
    const stub = db();
    const result = await createCardAction(emblemPayload());
    expect(result).toMatchObject({ ok: true });
    expect(insertedSlug(stub)).toBe("kaito-cunning-infiltrator-emblem");
  });

  it("stays unique the usual way", async () => {
    state.taken = new Set(["kaito-cunning-infiltrator-emblem"]);
    const stub = db();
    await createCardAction(emblemPayload());
    expect(insertedSlug(stub)).toMatch(/^kaito-cunning-infiltrator-emblem-/);
  });

  it("isn't doubled for a title that ends in Emblem; any other card keeps its title's", async () => {
    let stub = db();
    await createCardAction(emblemPayload({ title: "Kaito Emblem" }));
    expect(insertedSlug(stub)).toBe("kaito-emblem");
    stub = db();
    await createCardAction(
      emblemPayload({
        title: "Grizzly Bears",
        card_type: "creature",
        color_identity: ["green"],
        cost: "{1}{G}",
        power: "2",
        toughness: "2",
        subtypes: ["Bear"],
        rules_text: "",
        frame_style: { template: "m15" },
      }),
    );
    expect(insertedSlug(stub)).toBe("grizzly-bears");
  });
});

const EMBLEM_ROW = {
  id: CARD,
  slug: "kaito-cunning-infiltrator-emblem",
  title: "Kaito, Cunning Infiltrator",
  cost: null,
  card_type: "emblem",
  supertype: null,
  subtypes: [],
  rarity: "common",
  color_identity: ["colorless"],
  rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
  flavor_text: null,
  tags: [],
  frame_style: { template: "emblem" },
  visibility: "public",
  created_at: "2026-09-29T00:00:00Z",
  updated_at: "2026-09-29T00:00:00Z",
  rendered_at: null,
  color: null,
};

describe("an emblem's page", () => {
  it("<title>, OG and Twitter: '<walker> Emblem'", async () => {
    state.pageCard = EMBLEM_ROW;
    const meta = await generateMetadata({
      params: Promise.resolve({ username: "tester", slug: "kaito-cunning-infiltrator-emblem" }),
    });
    expect(meta.title).toBe("Kaito, Cunning Infiltrator Emblem");
    const og = meta.openGraph as { title: string; images: Array<{ alt: string }> };
    expect(og.title).toBe("Kaito, Cunning Infiltrator Emblem · PipGlyph");
    expect(og.images[0].alt).toBe("Kaito, Cunning Infiltrator Emblem card preview");
    expect((meta.twitter as { title: string }).title).toBe("Kaito, Cunning Infiltrator Emblem · PipGlyph");
    // Any other card: its title.
    state.pageCard = { ...EMBLEM_ROW, card_type: "token", title: "Soldier", slug: "soldier" };
    const token = await generateMetadata({ params: Promise.resolve({ username: "tester", slug: "soldier" }) });
    expect(token.title).toBe("Soldier");
  });

  it("JSON-LD: the CreativeWork is '<walker> Emblem'; the image caption keeps the printed name", () => {
    const ld = buildCardJsonLd({
      inDecks: [],
      card: EMBLEM_ROW as never,
      username: "tester",
      ownerDisplay: "Tester",
      siteBase: "https://pipglyph.com",
    }) as { name: string; headline: string; image: { caption: string } };
    expect(ld.name).toBe("Kaito, Cunning Infiltrator Emblem");
    expect(ld.headline).toBe("Kaito, Cunning Infiltrator Emblem");
    expect(ld.image.caption).toBe("Kaito, Cunning Infiltrator — custom MTG-style Emblem");
  });
});
