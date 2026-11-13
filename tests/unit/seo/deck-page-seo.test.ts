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
//
// The renamed deck's 308 keeps two things of the old address and nothing
// else: the page's own `?import=1`, and — owner 2026-11-11 — a friend's
// referral code (`?ref=<code>`, a valid one only), so a shared link to a
// deck that was renamed since still brings the friend's sign-up to the
// sharer. It is thrown from TWO places — generateMetadata and the page — and
// whichever is thrown first wins, so BOTH carry the same query: the
// metadata's used to redirect bare, and dropped both.
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
// The page asks who is looking beside the deck read; a visitor here.
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/decks/slug-history", () => ({ findRenamedDeckSlug: async () => state.renamedTo }));
vi.mock("@/lib/decks/queries", () => ({
  getDeckBySlugWithOwner: async () => state.deck,
  countDeckEntries: async () => state.entries,
  listDeckPageCards: async () => [],
  viewerLikesDeck: async () => false,
}));

const { default: DeckDetailPage, generateMetadata } = await import("@/app/(marketing)/deck/[slug]/page");

type Search = { import?: string; ref?: string };
const meta = (slug = "dragonstorm", search: Record<string, unknown> = {}) =>
  generateMetadata({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search as Search) });

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

// Both entry points of the redirect, case for case.
describe.each([
  ["the page", (search: Record<string, unknown>, slug: string) =>
    DeckDetailPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search as Search) }) as Promise<unknown>],
  ["generateMetadata", (search: Record<string, unknown>, slug: string) => meta(slug, search) as Promise<unknown>],
] as const)("a renamed deck's old address — the 308 thrown by %s", (_name, enter) => {
  const CODE = "ab12cd34";
  const open = (search: Record<string, unknown> = {}, slug = "dragonstorm") => enter(search, slug);
  /** Where it redirects to. */
  const target = async (search: Record<string, unknown> = {}) => {
    try {
      await open(search);
    } catch (error) {
      if (error instanceof Redirect) return error.to;
      throw error;
    }
    throw new Error("it did not redirect");
  };

  beforeEach(() => {
    state.renamedTo = "dragonstorm-reborn";
  });

  it("no query: the deck's current address", async () => {
    expect(await target()).toBe("/deck/dragonstorm-reborn");
  });

  it("keeps the page's own ?import=1", async () => {
    expect(await target({ import: "1" })).toBe("/deck/dragonstorm-reborn?import=1");
    expect(await target({ import: "0" })).toBe("/deck/dragonstorm-reborn");
    expect(await target({ import: "yes" })).toBe("/deck/dragonstorm-reborn");
  });

  it("keeps a friend's referral code — in its own shape", async () => {
    expect(await target({ ref: CODE })).toBe(`/deck/dragonstorm-reborn?ref=${CODE}`);
    expect(await target({ ref: " AB12CD34 " })).toBe(`/deck/dragonstorm-reborn?ref=${CODE}`);
  });

  it("a repeated ?ref= (a list): the first one, as every other redirect reads it — never dropped, never the second", async () => {
    expect(await target({ ref: [CODE, "ffff9999"] })).toBe(`/deck/dragonstorm-reborn?ref=${CODE}`);
    expect(await target({ ref: [CODE, CODE], import: "1" })).toBe(`/deck/dragonstorm-reborn?import=1&ref=${CODE}`);
    // A first value that is no code is not skipped for a later one.
    expect(await target({ ref: ["nope", CODE] })).toBe("/deck/dragonstorm-reborn");
    expect(await target({ ref: [] })).toBe("/deck/dragonstorm-reborn");
  });

  it("keeps BOTH together: ?import=1 and the code", async () => {
    const to = await target({ ref: CODE, import: "1" });
    expect(to).toBe(`/deck/dragonstorm-reborn?import=1&ref=${CODE}`);
    const query = new URL(to, "https://pipglyph.test").searchParams;
    expect(Object.fromEntries(query.entries())).toEqual({ import: "1", ref: CODE });
  });

  it("nothing else of the old address travels: the share tag, a view, tracking parameters", async () => {
    expect(await target({ via: "copy", view: "table", utm_source: "reddit", ref: CODE })).toBe(`/deck/dragonstorm-reborn?ref=${CODE}`);
    expect(await target({ via: "copy", view: "table", utm_source: "reddit" })).toBe("/deck/dragonstorm-reborn");
  });

  it("a value that is not a code never reaches the Location — and never costs ?import=1", async () => {
    for (const ref of ["", "nope", "ab12cd3", "ab12cd345", "zzzzzzzz", "<script>", `${CODE}&next=//evil.test`, 12345678, null, undefined]) {
      expect(await target({ ref }), String(ref)).toBe("/deck/dragonstorm-reborn");
      expect(await target({ ref, import: "1" }), String(ref)).toBe("/deck/dragonstorm-reborn?import=1");
    }
  });

  it("a slug no deck ever had is still a 404, code or not", async () => {
    state.renamedTo = null;
    await expect(open({})).rejects.toBeInstanceOf(NotFound);
    await expect(open({ ref: CODE, import: "1" })).rejects.toBeInstanceOf(NotFound);
  });
});

describe("a renamed deck's old address — the two entry points agree", () => {
  it("whichever redirect is thrown first, the friend lands on the same address", async () => {
    state.renamedTo = "dragonstorm-reborn";
    const landing = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        if (error instanceof Redirect) return error.to;
        throw error;
      }
      return null;
    };
    for (const search of [{}, { import: "1" }, { ref: "ab12cd34" }, { import: "1", ref: "AB12CD34" }, { ref: "nope", via: "copy" }]) {
      const fromMetadata = await landing(() => meta("dragonstorm", search));
      const fromPage = await landing(() =>
        DeckDetailPage({ params: Promise.resolve({ slug: "dragonstorm" }), searchParams: Promise.resolve(search as Search) }),
      );
      expect(fromMetadata, JSON.stringify(search)).not.toBeNull();
      expect(fromMetadata, JSON.stringify(search)).toBe(fromPage);
    }
  });
});

describe("deck page body (source)", () => {
  const page = readFileSync(join(process.cwd(), "app/(marketing)/deck/[slug]/page.tsx"), "utf8");
  const body = page.slice(page.indexOf("export default async function DeckDetailPage"));

  it("both callers of the rename redirect hand it the address's query — neither redirects bare", () => {
    const calls = [...page.matchAll(/await redirectRenamedDeckOrNotFound\(([^)]*)\)/g)].map((match) => match[1]);
    expect(calls).toEqual(["slug, await searchParams", "slug, await searchParams"]);
  });

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
    expect(similar.slice(0, similar.indexOf("\n}\n"))).toContain("similarDecksCache()(deckId, limit)");
    // The read inside the data cache is cookie-free (a cookie read there
    // throws, and would make the answer viewer-dependent).
    const read = queries.slice(queries.indexOf("async function readSimilarDecks"));
    expect(read.slice(0, read.indexOf("\n}\n"))).toContain("createPublicClient()");
    expect(queries).toContain('unstable_cache(readSimilarDecks, ["similar-decks-v1"]');
  });

  it("keeps structured data for public decks only", () => {
    expect(body).toMatch(/\{isPublic \? \(\s*<>\s*<JsonLd/);
  });
});
