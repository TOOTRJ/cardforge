import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The revalidation a deferred bake asks for, from inside the action's
// after() callback (lib/cards/revalidate.ts `afterBake`).
//
// Next runs an after() callback's revalidations only for tags the request
// has NOT already revalidated (next/dist/server/revalidation-utils.js
// withExecuteRevalidates → diffRevalidationState): `revalidatePath("/gallery")`
// a second time, after the bake, is dropped — the action revalidated that
// very tag before it answered. Measured on a production build (2026-10-09):
// /gallery, rebuilt while the bake ran, kept what it had read for its whole
// 5-minute ISR window. `revalidatePath(route, "page")` is ANOTHER tag
// (`_N_T_<route>/page`, one of the page's implicit tags), so it is executed:
// the same page showed the new thumb 4.9 s after the save.
//
// The route is the FILE-SYSTEM route, route group included — a moved or
// renamed page would turn the call into a silent no-op, so each is held to
// its page.tsx here, and to being an ISR page (a per-request page needs no
// revalidation at all).
// ---------------------------------------------------------------------------

const calls = vi.hoisted(() => ({ paths: [] as Array<[string, string | undefined]> }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: (route: string, type?: string) => void calls.paths.push([route, type]),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/cards/cache-purge", () => ({ purgeCardCdnCache: vi.fn() }));
vi.mock("@/lib/seo/indexnow", () => ({ notifyIndexNow: vi.fn() }));

import { BAKED_TILE_PAGE_ROUTES, revalidateCardListSurfaces, revalidateCardPaths } from "@/lib/cards/revalidate";

const pageTyped = () => calls.paths.filter(([, type]) => type === "page").map(([route]) => route);

beforeEach(() => {
  calls.paths.length = 0;
});

describe("the deferred bake's revalidation (afterBake)", () => {
  it("the save's own revalidation names no tile page by its PAGE tag — those are kept for the bake", () => {
    revalidateCardPaths("the-long-night", "tester", { visibility: "public" });
    for (const route of BAKED_TILE_PAGE_ROUTES) expect(pageTyped(), route).not.toContain(route);
    expect(calls.paths).toContainEqual(["/gallery", undefined]);
  });

  it("after the bake: every ISR'd tile page by its PAGE tag, on top of the plain paths", () => {
    revalidateCardPaths("the-long-night", "tester", { visibility: "public", afterBake: true });
    for (const route of BAKED_TILE_PAGE_ROUTES) expect(pageTyped(), route).toContain(route);
    expect(calls.paths).toContainEqual(["/gallery", undefined]);
    expect(calls.paths).toContainEqual(["/card/tester/the-long-night", undefined]);
  });

  it("the bulk publish's deferred bake asks for the same", () => {
    revalidateCardListSurfaces({ afterBake: true });
    for (const route of BAKED_TILE_PAGE_ROUTES) expect(pageTyped(), route).toContain(route);
    calls.paths.length = 0;
    revalidateCardListSurfaces();
    for (const route of BAKED_TILE_PAGE_ROUTES) expect(pageTyped(), route).not.toContain(route);
  });

  it.each(BAKED_TILE_PAGE_ROUTES)("%s is a page file, and an ISR page", (route) => {
    const file = path.join(process.cwd(), "app", route, "page.tsx");
    expect(existsSync(file), file).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/^export const revalidate = \d+;/m);
  });

  it("the home page and the gallery are among them (the tiles the owner looks at after a save)", () => {
    expect(BAKED_TILE_PAGE_ROUTES).toContain("/(marketing)");
    expect(BAKED_TILE_PAGE_ROUTES).toContain("/(marketing)/gallery");
  });
});
