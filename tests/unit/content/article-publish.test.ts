import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// A release (lib/content/article-publish.ts): every released, unannounced
// composer article passes the release gate, is stamped ONCE, the article
// surfaces are purged — EXPIRED, never "max" (stale-while-revalidate kept an
// unpublished article up) — and only then is IndexNow told the article and
// the hubs that list it. A due row that fails the gate is held back: put back
// to a draft, logged, never announced.
// ---------------------------------------------------------------------------

const spies = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  notifyIndexNow: vi.fn(async () => true),
}));
vi.mock("next/cache", () => ({
  revalidatePath: spies.revalidatePath,
  revalidateTag: spies.revalidateTag,
  updateTag: spies.updateTag,
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/seo/indexnow", () => ({ notifyIndexNow: spies.notifyIndexNow }));
vi.mock("@/lib/content/article-catalog", () => ({ listPublishedArticles: async () => [] }));

const words = (n: number) => Array.from({ length: n }, () => "craft").join(" ");

/** A stored row that passes the gate (and one that doesn't, by its body). */
function dueRow(id: string, slug: string, body = `${words(40)}\n\n## How?\n\n${words(400)}`) {
  return {
    id,
    slug,
    title: "A composer guide",
    seo_title: null,
    description: "A summary that is long enough to be a meta description for this test article.",
    excerpt: null,
    body,
    tags: ["naming"],
    category: "design",
    faq: [],
    cover_url: null,
    cover_alt: null,
    cover_width: null,
    cover_height: null,
    author_id: null,
    is_published: true,
    publish_at: "2026-11-03T15:00:00.000Z",
    content_updated_at: null,
    announced_at: null,
    first_published_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

import { announceDueArticles, articleAnnouncePaths } from "@/lib/content/article-publish";

beforeEach(() => {
  spies.revalidatePath.mockClear();
  spies.revalidateTag.mockClear();
  spies.updateTag.mockClear();
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
    expect(await announceDueArticles(db.client as never)).toEqual({ announced: [], heldBack: [], indexNow: false });
    expect(spies.revalidateTag).not.toHaveBeenCalled();
    expect(spies.notifyIndexNow).not.toHaveBeenCalled();
  });

  it("stamps, purges and pings every due article once", async () => {
    const now = new Date("2026-11-03T15:05:00.000Z");
    const db = chainClient((_table, calls) =>
      called(calls, "select") ? { data: [dueRow("a1", "naming-custom-cards")] } : { data: null },
    );
    const result = await announceDueArticles(db.client as never, now);
    expect(result).toEqual({ announced: ["naming-custom-cards"], heldBack: [], indexNow: true });

    const [read, stamp] = db.forTable("articles");
    expect(called(read.calls, "eq", "is_published")).toBe(true);
    expect(read.calls.find((c) => c.method === "lte")?.args).toEqual(["publish_at", now.toISOString()]);
    expect(called(read.calls, "is", "announced_at")).toBe(true);
    expect(payloadOf(stamp.calls, "update")).toEqual({ announced_at: now.toISOString() });
    // Never stamps a row another run announced in the meantime.
    expect(stamp.calls.find((c) => c.method === "is")?.args).toEqual(["announced_at", null]);

    // A route handler: an immediate expiry (updateTag is for actions only).
    expect(spies.revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
    expect(spies.revalidateTag).not.toHaveBeenCalledWith("articles", "max");
    expect(spies.updateTag).not.toHaveBeenCalled();
    // IndexNow only after the purge.
    expect(spies.notifyIndexNow.mock.invocationCallOrder[0]).toBeGreaterThan(
      spies.revalidateTag.mock.invocationCallOrder[0],
    );
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

  it("holds back a due row that fails the gate: back to a draft, logged, never announced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = new Date("2026-11-03T15:05:00.000Z");
    const bad = dueRow("a2", "smuggled", `${words(40)}\n\n## How?\n\n${words(400)}\n\n<script>alert(1)</script>`);
    const db = chainClient((_table, calls) =>
      called(calls, "select") ? { data: [dueRow("a1", "naming-custom-cards"), bad] } : { data: null },
    );
    const result = await announceDueArticles(db.client as never, now);
    expect(result.announced).toEqual(["naming-custom-cards"]);
    expect(result.heldBack).toEqual([{ slug: "smuggled", reason: expect.stringContaining("markdown and the article components only") }]);

    const [, hold, stamp] = db.forTable("articles");
    expect(payloadOf(hold.calls, "update")).toEqual({ is_published: false, updated_at: now.toISOString() });
    expect(hold.calls.find((c) => c.method === "in")?.args).toEqual(["id", ["a2"]]);
    expect(stamp.calls.find((c) => c.method === "in")?.args).toEqual(["id", ["a1"]]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("held back /articles/smuggled"));
    // The held-back row's page is purged too (a cached list may hold it);
    // IndexNow hears only of what went out.
    expect(spies.revalidatePath).toHaveBeenCalledWith("/articles/smuggled");
    expect(spies.notifyIndexNow).toHaveBeenCalledWith(expect.not.arrayContaining(["/articles/smuggled"]));
    warn.mockRestore();
  });

  it("throws a read error (the cron answers 500)", async () => {
    const db = chainClient(() => ({ error: { message: "boom" } }));
    await expect(announceDueArticles(db.client as never)).rejects.toThrow("boom");
  });
});
