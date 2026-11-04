import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The card page is STATIC for a signed-out visitor (TODO CP2a: force-static +
// ISR), so every change that takes a card out of view, brings one into view
// or moves its address must refresh that page — not leave it to the ISR
// window (a deleted card's rules and comments up for minutes, a published
// one's cached 404, the old handle's page still answering).
//
//   * purgeHiddenCards (bulk private, bulk delete, account deletion, the
//     storage sweep) revalidates each card's page by its path — or, where
//     the ref can't name it (ids alone), every card page once by route;
//   * a bulk PUBLISH revalidates the published cards' pages;
//   * a renamed handle expires every card page;
//   * a single save that bakes after the response leaves the card page to
//     the call after the bake (Next drops an after() revalidation of a path
//     the request already revalidated), and that call runs in every outcome.
// ---------------------------------------------------------------------------

const calls = vi.hoisted(() => ({ paths: [] as Array<[string, string | undefined]>, cdn: [] as string[][] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (route: string, type?: string) => void calls.paths.push([route, type]),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/cards/cache-purge", () => ({ purgeCardCdnCache: async (ids: string[]) => void calls.cdn.push(ids) }));
vi.mock("@/lib/seo/indexnow", () => ({ notifyIndexNow: vi.fn() }));

import {
  CARD_PAGE_ROUTE,
  purgeHiddenCards,
  revalidateCardPages,
  revalidateCardPaths,
  revalidateEveryCardPage,
} from "@/lib/cards/revalidate";

const A = "a0000000-0000-4000-a000-000000000001";
const B = "b0000000-0000-4000-a000-000000000002";
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const plain = () => calls.paths.filter(([, type]) => type === undefined).map(([route]) => route);
const everyPage = () => calls.paths.filter(([route, type]) => route === CARD_PAGE_ROUTE && type === "page").length;

beforeEach(() => {
  calls.paths.length = 0;
  calls.cdn.length = 0;
});

describe("the card page's route", () => {
  it("is the file-system route of the static card page (a moved page would make the call a silent no-op)", () => {
    const file = path.join(process.cwd(), "app", CARD_PAGE_ROUTE, "page.tsx");
    expect(existsSync(file), file).toBe(true);
    expect(read(path.join("app", CARD_PAGE_ROUTE, "page.tsx"))).toContain('export const dynamic = "force-static";');
  });

  it("revalidateEveryCardPage expires it by its PAGE tag", () => {
    revalidateEveryCardPage();
    expect(calls.paths).toEqual([[CARD_PAGE_ROUTE, "page"]]);
  });
});

describe("revalidateCardPages", () => {
  it("names each card's page by its path, the legacy redirector too", () => {
    revalidateCardPages([
      { id: A, slug: "the-long-night", ownerUsername: "dev_pro" },
      { id: B, slug: "dawn", ownerUsername: "dev_pro" },
    ]);
    expect(plain()).toEqual(["/card/the-long-night", "/card/dev_pro/the-long-night", "/card/dawn", "/card/dev_pro/dawn"]);
    expect(everyPage()).toBe(0);
  });

  it("a card it can't name (no slug, no handle) expires every card page — once", () => {
    revalidateCardPages([{ id: A }, { id: B, slug: "dawn", ownerUsername: null }, { id: A, slug: "x", ownerUsername: "u" }]);
    expect(everyPage()).toBe(1);
    expect(plain()).toContain("/card/u/x");
  });
});

describe("purgeHiddenCards", () => {
  it("drops each card's page, share image and CDN copies, and the list surfaces", async () => {
    await purgeHiddenCards([{ id: A, slug: "the-long-night", ownerUsername: "dev_pro" }]);
    expect(plain()).toEqual(expect.arrayContaining(["/gallery", "/card/dev_pro/the-long-night", `/api/cards/${A}/og`]));
    expect(calls.cdn).toEqual([[A]]);
    expect(everyPage()).toBe(0);
  });

  it("ids alone (the storage sweep) expire every card page", async () => {
    await purgeHiddenCards([{ id: A }, { id: B }]);
    expect(everyPage()).toBe(1);
    expect(calls.cdn).toEqual([[A, B]]);
  });
});

describe("a save that bakes after the response", () => {
  it("leaves the card page out of the request's revalidation (`cardPageAfterBake`)…", () => {
    revalidateCardPaths("the-long-night", "dev_pro", { visibility: "public", cardPageAfterBake: true });
    expect(plain()).not.toContain("/card/dev_pro/the-long-night");
    expect(plain()).toContain("/profile/dev_pro");
  });

  it("…and the call after the bake names it", () => {
    revalidateCardPaths("the-long-night", "dev_pro", { visibility: "public", afterBake: true });
    expect(plain()).toContain("/card/dev_pro/the-long-night");
  });

  it.each([
    ["lib/cards/actions.ts", 2],
    ["lib/cards/dfc-adopt-actions.ts", 1],
  ] as const)("%s: every deferred-bake save waits, and refreshes after the bake whether it failed or not", (file, saves) => {
    const source = read(file);
    expect(source.match(/cardPageAfterBake: true/g)?.length).toBe(saves);
    // The after-bake call sits AFTER the try/catch around the bake, never
    // inside its try (a failed bake must still refresh the page).
    const afterCalls = [...source.matchAll(/\n( *)\} catch \((?:error|bakeError)\) \{\n[^\n]*deferred bake failed[^\n]*\n\1\}\n\1revalidateCardPaths\(/g)];
    expect(afterCalls.length).toBe(saves);
  });
});

describe("every change of a card's view refreshes its page", () => {
  const actions = read("lib/cards/actions.ts");

  it("bulk visibility: private purges each page, publish revalidates each page", () => {
    expect(actions).toContain("const pages = targets.map((c) => ({ id: c.id, slug: c.slug, ownerUsername }));");
    expect(actions).toContain("await purgeHiddenCards(pages);");
    expect(actions).toContain("revalidateCardPages(pages);");
  });

  it("bulk delete purges each deleted card's page", () => {
    expect(actions).toContain('.select("id, owner_id, slug")');
    expect(actions).toContain("await purgeHiddenCards(existing.map((c) => ({ id: c.id, slug: c.slug, ownerUsername })));");
  });

  it("account deletion purges the user's card pages with their handle", () => {
    const account = read("lib/account/actions.ts");
    expect(account).toContain('.select("id, slug")');
    expect(account).toContain("const ownerUsername = await lookupUsername(admin, user.id);");
    expect(account).toContain("after(() => purgeHiddenCards(cards))");
  });

  it("the storage sweep's ids reach purgeHiddenCards as refs (every card page)", () => {
    expect(read("app/api/admin/storage-sweep/route.ts")).toContain("await purgeHiddenCards(ids.map((id) => ({ id })));");
  });

  it("a renamed handle expires every card page", () => {
    const settings = read("app/(app)/settings/actions.ts");
    const rename = settings.slice(settings.indexOf("if (before?.username && before.username !== parsed.data.username) {"));
    expect(rename.slice(0, 400)).toContain("revalidateEveryCardPage();");
  });

  it("the bulk preflight reads each card's slug", () => {
    expect(read("lib/cards/visibility-preflight.ts")).toMatch(/"title",\n {2}"slug",/);
  });
});
