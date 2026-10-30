import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A release (lib/content/article-publish.ts): every released, unannounced
// composer article is stamped ONCE, the article surfaces are purged, and
// IndexNow is told the article and the hubs that list it.
// ---------------------------------------------------------------------------

const spies = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  notifyIndexNow: vi.fn(async () => true),
}));
vi.mock("next/cache", () => ({
  revalidatePath: spies.revalidatePath,
  revalidateTag: spies.revalidateTag,
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/seo/indexnow", () => ({ notifyIndexNow: spies.notifyIndexNow }));

import { announceDueArticles, articleAnnouncePaths } from "@/lib/content/article-publish";

beforeEach(() => {
  spies.revalidatePath.mockClear();
  spies.revalidateTag.mockClear();
  spies.notifyIndexNow.mockClear();
});

describe("articleAnnouncePaths", () => {
  it("names the article, its shelf, its tag hubs and the indexes", () => {
    expect(
      articleAnnouncePaths([{ slug: "naming-custom-cards", category: "design", tags: ["Naming", "card design"] }]),
    ).toEqual(["/articles/naming-custom-cards", "/learn/design", "/articles/tag/naming", "/articles", "/learn"]);
    expect(articleAnnouncePaths([])).toEqual([]);
  });
});

describe("announceDueArticles", () => {
  it("does nothing when nothing is due", async () => {
    const db = chainClient(() => ({ data: [] }));
    expect(await announceDueArticles(db.client as never)).toEqual({ announced: [], indexNow: false });
    expect(spies.revalidateTag).not.toHaveBeenCalled();
    expect(spies.notifyIndexNow).not.toHaveBeenCalled();
  });

  it("stamps, purges and pings every due article once", async () => {
    const now = new Date("2026-11-03T15:05:00.000Z");
    const db = chainClient((_table, calls) =>
      called(calls, "select")
        ? { data: [{ id: "a1", slug: "naming-custom-cards", category: "design", tags: ["naming"] }] }
        : { data: null },
    );
    const result = await announceDueArticles(db.client as never, now);
    expect(result).toEqual({ announced: ["naming-custom-cards"], indexNow: true });

    const [read, stamp] = db.forTable("articles");
    expect(called(read.calls, "eq", "is_published")).toBe(true);
    expect(read.calls.find((c) => c.method === "lte")?.args).toEqual(["publish_at", now.toISOString()]);
    expect(called(read.calls, "is", "announced_at")).toBe(true);
    expect(payloadOf(stamp.calls, "update")).toEqual({ announced_at: now.toISOString() });
    // Never stamps a row another run announced in the meantime.
    expect(stamp.calls.find((c) => c.method === "is")?.args).toEqual(["announced_at", null]);

    expect(spies.revalidateTag).toHaveBeenCalledWith("articles", "max");
    for (const path of ["/articles/naming-custom-cards", "/sitemap.xml", "/llms.txt", "/"]) {
      expect(spies.revalidatePath).toHaveBeenCalledWith(path);
    }
    expect(spies.revalidatePath).toHaveBeenCalledWith("/articles", "layout");
    expect(spies.revalidatePath).toHaveBeenCalledWith("/learn", "layout");
    expect(spies.notifyIndexNow).toHaveBeenCalledWith([
      "/articles/naming-custom-cards",
      "/learn/design",
      "/articles/tag/naming",
      "/articles",
      "/learn",
    ]);
  });

  it("throws a read error (the cron answers 500)", async () => {
    const db = chainClient(() => ({ error: { message: "boom" } }));
    await expect(announceDueArticles(db.client as never)).rejects.toThrow("boom");
  });
});
