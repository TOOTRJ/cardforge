import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The deck page's SEO contract (CLAUDE.md "SEO contract for public pages"),
// held while TODO DK5.16 adds its tokens, copy button, credit and similar
// decks: a missing deck is a real 404 (a renamed one's old slug a 308),
// thrown BEFORE any Suspense boundary and again in generateMetadata; the
// canonical is the deck's own /deck/<slug>; an unlisted or private deck is
// noindex, nofollow; an EMPTY public deck is noindex but followed; a public
// deck with cards is indexable. The new sections read nothing that changes
// any of it (similar decks: public decks only, cookie-free).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  deck: null as null | Record<string, unknown>,
  entries: 0,
  renamedTo: null as string | null,
}));

class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
  permanentRedirect: (to: string) => {
    throw new Redirect(to);
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/decks/slug-history", () => ({ findRenamedDeckSlug: async () => state.renamedTo }));
vi.mock("@/lib/decks/queries", () => ({
  getDeckBySlugWithOwner: async () => state.deck,
  countDeckEntries: async () => state.entries,
  listDeckPageCards: async () => [],
  viewerLikesDeck: async () => false,
}));

const { generateMetadata } = await import("@/app/(marketing)/deck/[slug]/page");

const meta = (slug = "dragonstorm") => generateMetadata({ params: Promise.resolve({ slug }) });

function deck(visibility: string): Record<string, unknown> {
  return {
    id: "d1000000-0000-4000-8000-000000000001",
    owner_id: "aaaaaaaa-0000-4000-8000-000000000001",
    slug: "dragonstorm",
    title: "Dragonstorm",
    description: null,
    format: "commander",
    visibility,
    owner: { username: "ann", display_name: "Ann", avatar_url: null },
  };
}

beforeEach(() => {
  state.deck = null;
  state.entries = 0;
  state.renamedTo = null;
});

describe("deck page metadata", () => {
  it("a missing deck is a real 404 from generateMetadata, never a titled 200", async () => {
    await expect(meta("nope")).rejects.toBeInstanceOf(NotFound);
  });

  it("a renamed deck's old slug is a 308 to its current one", async () => {
    state.renamedTo = "dragonstorm-reborn";
    await expect(meta("dragonstorm")).rejects.toMatchObject({ to: "/deck/dragonstorm-reborn" });
  });

  it("a public deck with cards: self-canonical, indexable, shareable", async () => {
    state.deck = deck("public");
    state.entries = 40;
    const m = await meta();
    expect(m.alternates?.canonical).toBe("/deck/dragonstorm");
    expect(m.robots).toBeUndefined();
    expect(m.openGraph).toMatchObject({ url: "/deck/dragonstorm", type: "article" });
  });

  it("an EMPTY public deck: noindex, followed", async () => {
    state.deck = deck("public");
    const m = await meta();
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates?.canonical).toBe("/deck/dragonstorm");
  });

  it("an unlisted deck: noindex, nofollow, still self-canonical and shareable", async () => {
    state.deck = deck("unlisted");
    state.entries = 40;
    const m = await meta();
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.alternates?.canonical).toBe("/deck/dragonstorm");
    expect(m.openGraph).toBeDefined();
  });

  it("a private deck (its owner's view): noindex, nofollow, no share tags", async () => {
    state.deck = deck("private");
    const m = await meta();
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.openGraph).toBeUndefined();
  });
});

describe("deck page body (source)", () => {
  const page = readFileSync(join(process.cwd(), "app/(marketing)/deck/[slug]/page.tsx"), "utf8");
  const body = page.slice(page.indexOf("export default async function DeckDetailPage"));

  it("throws the 404 before the first Suspense boundary", () => {
    expect(body.indexOf("notFound()")).toBeGreaterThan(-1);
    expect(body.indexOf("notFound()")).toBeLessThan(body.indexOf("<Suspense"));
  });

  it("draws similar decks only for a public deck, from the cookie-free row", () => {
    expect(body).toMatch(/\{isPublic && hasCards \? \(\s*<Suspense fallback=\{null\}>\s*<SimilarDecksRow/);
    const row = readFileSync(join(process.cwd(), "components/decks/similar-decks-row.tsx"), "utf8");
    expect(row).toContain("{ anonymous: true }");
    expect(row).not.toMatch(/next\/headers|createClient\(/);
    const queries = readFileSync(join(process.cwd(), "lib/decks/queries.ts"), "utf8");
    const similar = queries.slice(queries.indexOf("export async function listSimilarDecks"));
    expect(similar.slice(0, similar.indexOf("\n}\n"))).toContain("createPublicClient()");
  });

  it("keeps structured data for public decks only", () => {
    expect(body).toMatch(/\{isPublic \? \(\s*<>\s*<JsonLd/);
  });
});
