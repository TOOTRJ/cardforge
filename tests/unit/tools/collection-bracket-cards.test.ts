import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The Commander brackets' card lists, read from Scryfall (owner decision 5,
// 2026-11-09 — never written in the code): `searchCardNames` follows a
// search's pages and is held a day in Next's data cache; a list cut short
// or unanswered is null, and so is the whole set (the builder then leaves
// the bracket unchecked and says so).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

function page(names: string[], hasMore: boolean, status = 200): Response {
  return new Response(
    JSON.stringify({ object: "list", has_more: hasMore, data: names.map((name, i) => ({ id: `${name}-${i}`, name })) }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

async function fresh() {
  vi.resetModules();
  const client = await import("@/lib/scryfall/client");
  const brackets = await import("@/lib/tools/collection/bracket-cards");
  return { client, brackets };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchCardNames", () => {
  it("follows the pages, unique cards, held a day", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(["Ancient Tomb", "Biorhythm"], true))
      .mockResolvedValueOnce(page(["Farewell"], false));
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await fresh();
    const names = await client.searchCardNames("is:gamechanger", { revalidate: 86_400 });
    expect(names).toEqual(["Ancient Tomb", "Biorhythm", "Farewell"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toContain("unique=cards");
    expect(url).toContain("page=2");
    expect(init.next?.revalidate).toBe(86_400);
  });

  it("no matches is an empty list; an unanswered or overlong list is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([], false, 404)));
    expect(await (await fresh()).client.searchCardNames("otag:nothing")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page([], false, 400)));
    expect(await (await fresh()).client.searchCardNames("is:gamechanger")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page(["A"], true)));
    expect(await (await fresh()).client.searchCardNames("is:gamechanger", { maxPages: 2 })).toBeNull();
  });
});

describe("getBracketCards", () => {
  it("reads the three lists as drafter keys", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get("q") ?? "";
      if (q.includes("gamechanger")) return page(["Rhystic Study", "Fire // Ice"], false);
      if (q.includes("mass-land-denial")) return page(["Armageddon"], false);
      return page(["Time Warp"], false);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { brackets } = await fresh();
    const lists = await brackets.getBracketCards();
    expect([...(lists?.gameChangers ?? [])]).toEqual(["rhystic study", "fire"]);
    expect(lists?.massLandDenial.has("armageddon")).toBe(true);
    expect(lists?.extraTurns.has("time warp")).toBe(true);
    // Each query is held to Commander-legal cards.
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).searchParams.get("q")?.endsWith("legal:commander"))).toBe(true);
  });

  it("an EMPTY list is unknown, never 'none of them' (a renamed tag answers no matches)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        (new URL(url).searchParams.get("q") ?? "").includes("mass-land-denial") ? page([], false, 404) : page(["X"], false),
      ),
    );
    expect(await (await fresh()).brackets.getBracketCards()).toBeNull();
  });

  it("is held in the instance for six hours", async () => {
    const fetchMock = vi.fn(async () => page(["X"], false));
    vi.stubGlobal("fetch", fetchMock);
    const { brackets } = await fresh();
    const t = Date.now();
    expect(await brackets.getBracketCards(t)).not.toBeNull();
    const calls = fetchMock.mock.calls.length;
    await brackets.getBracketCards(t + 60_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("reads names only: a card the full schema can't read doesn't void the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ object: "list", has_more: false, data: [{ name: "Odd", weird: true }] }), { status: 200 })),
    );
    expect(await (await fresh()).client.searchCardNames("is:gamechanger")).toEqual(["Odd"]);
  });

  it("any list that can't be read makes the whole set null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        (new URL(url).searchParams.get("q") ?? "").includes("extra-turn") ? page([], false, 400) : page(["X"], false),
      ),
    );
    expect(await (await fresh()).brackets.getBracketCards()).toBeNull();
  });
});
