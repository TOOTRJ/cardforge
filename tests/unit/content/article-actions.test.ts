import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient, payloadOf, type ChainCall } from "@/tests/stubs/supabase-chain";
import type { ArticleRow } from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// The composer's writes: admins only; the form schema first; an MDX guide's
// slug refused; a schedule / publish refused while the SEO checklist has an
// ERROR on the stored row; a published URL never renamed; a live edit moves
// the public "Updated" date only when marked a revision.
// ---------------------------------------------------------------------------

const ID = "a0000000-0000-4000-a000-000000000001";
const ADMIN = "d0000000-0000-4000-a000-000000000001";

const state = vi.hoisted(() => ({
  admin: true,
  row: null as unknown as Record<string, unknown> | null,
  resolve: null as unknown as (table: string, calls: ChainCall[]) => { data?: unknown; error?: unknown },
  db: null as unknown as ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.db.client,
  getCurrentProfile: async () => (state.admin ? { id: ADMIN, is_admin: true } : { id: ADMIN, is_admin: false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: <T,>(fn: T) => fn }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/seo/indexnow", () => ({ notifyIndexNow: vi.fn(async () => true) }));
vi.mock("@/lib/content/article-catalog", () => ({ listPublishedArticles: async () => [] }));

import {
  publishArticleNowAction,
  saveArticleAction,
  scheduleArticleAction,
} from "@/lib/content/article-actions";
import { listArticles } from "@/lib/content/articles";

const words = (n: number) => Array.from({ length: n }, () => "craft").join(" ");

function storedRow(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: ID,
    slug: "a-composer-guide",
    title: "A composer guide",
    seo_title: null,
    description: "A summary that is long enough to be a meta description for this test article.",
    excerpt: null,
    body: `${words(40)}\n\n## How?\n\n${words(400)}`,
    tags: ["card design", "balance"],
    category: "design",
    faq: [],
    cover_url: null,
    cover_alt: null,
    cover_width: null,
    cover_height: null,
    author_id: null,
    is_published: false,
    publish_at: null,
    content_updated_at: null,
    announced_at: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const INPUT = {
  slug: "a-composer-guide",
  title: "A composer guide",
  description: "A summary that is long enough to be a meta description for this test article.",
  body: `${words(40)}\n\n## How?\n\n${words(400)}`,
  tags: ["card design"],
  category: "design" as const,
  faq: [],
};

beforeEach(() => {
  state.admin = true;
  state.row = storedRow();
  state.db = chainClient((table, calls) => {
    if (called(calls, "insert")) return { data: { id: ID } };
    if (called(calls, "maybeSingle")) return { data: state.row };
    return { data: null };
  });
});

const writes = () => state.db.forTable("articles").filter((e) => called(e.calls, "update") || called(e.calls, "insert"));

describe("the composer's actions", () => {
  it("refuse a non-admin before any read", async () => {
    state.admin = false;
    expect(await saveArticleAction(null, INPUT)).toEqual({ ok: false, error: "Not authorized." });
    expect(await scheduleArticleAction(ID, "2099-01-01T00:00:00Z")).toEqual({ ok: false, error: "Not authorized." });
    expect(state.db.log).toEqual([]);
  });

  it("save a new draft (never published by a save)", async () => {
    expect(await saveArticleAction(null, INPUT)).toEqual({ ok: true, id: ID, status: "draft" });
    expect(payloadOf(writes()[0].calls, "insert")).toMatchObject({ slug: "a-composer-guide", is_published: false, created_by: ADMIN });
  });

  it("refuse an MDX guide's slug and a malformed one", async () => {
    const file = listArticles()[0].slug;
    expect(await saveArticleAction(null, { ...INPUT, slug: file })).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    expect(await saveArticleAction(null, { ...INPUT, slug: "Bad Slug" })).toMatchObject({ ok: false, fieldErrors: { slug: expect.any(String) } });
    expect(writes()).toEqual([]);
  });

  it("never renames a URL that has been public", async () => {
    state.row = storedRow({ is_published: true, publish_at: "2026-10-02T00:00:00Z", announced_at: "2026-10-02T00:00:00Z" });
    expect(await saveArticleAction(ID, { ...INPUT, slug: "renamed" })).toMatchObject({ ok: false, fieldErrors: { slug: "Locked once published." } });
    expect(writes()).toEqual([]);
  });

  it("move the Updated date only for a marked revision of a live article", async () => {
    state.row = storedRow({ is_published: true, publish_at: "2026-10-02T00:00:00Z", announced_at: "2026-10-02T00:00:00Z" });
    await saveArticleAction(ID, INPUT);
    expect(payloadOf(writes()[0].calls, "update")).not.toHaveProperty("content_updated_at");
    await saveArticleAction(ID, INPUT, { revised: true });
    expect(payloadOf(writes()[1].calls, "update")).toHaveProperty("content_updated_at");
  });

  it("refuse to schedule or publish while the checklist has an error", async () => {
    state.row = storedRow({ body: `![](/article-media/a/b.svg)\n\n${words(400)}` });
    const scheduled = await scheduleArticleAction(ID, "2099-01-01T15:00:00Z");
    expect(scheduled).toMatchObject({ ok: false, error: expect.stringContaining("every image has alt text") });
    const published = await publishArticleNowAction(ID);
    expect(published).toMatchObject({ ok: false, error: expect.stringContaining("every image has alt text") });
    expect(writes()).toEqual([]);
  });

  it("schedule a clean article for the future (and clear its announcement)", async () => {
    expect(await scheduleArticleAction(ID, "2020-01-01T00:00:00Z")).toMatchObject({ ok: false });
    expect(await scheduleArticleAction(ID, "2099-01-01T15:00:00Z")).toEqual({ ok: true, id: ID, status: "scheduled" });
    expect(payloadOf(writes()[0].calls, "update")).toMatchObject({
      is_published: true,
      publish_at: "2099-01-01T15:00:00.000Z",
      announced_at: null,
    });
  });

  it("publish now: live and announced in one write", async () => {
    expect(await publishArticleNowAction(ID)).toEqual({ ok: true, id: ID, status: "live" });
    const payload = payloadOf(writes()[0].calls, "update") as Record<string, unknown>;
    expect(payload.is_published).toBe(true);
    expect(payload.announced_at).toBe(payload.publish_at);
  });
});
