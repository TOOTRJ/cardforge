"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/ids";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { listArticles } from "@/lib/content/articles";
import { listPublishedArticles } from "@/lib/content/article-catalog";
import {
  ARTICLE_COLUMNS,
  articleInputSchema,
  articleStatus,
  type ArticleInput,
  type ArticleRow,
  type ParsedArticleInput,
} from "@/lib/content/article-shared";
import {
  articleSeoChecklist,
  blockingItems,
  type ChecklistInput,
} from "@/lib/content/article-seo-checklist";
import { faqOf } from "@/lib/content/db-articles";
import { articleAnnouncePaths, revalidateArticleSurfaces } from "@/lib/content/article-publish";
import { readArticleDrafts } from "@/lib/content/article-drafts";
import { notifyIndexNow } from "@/lib/seo/indexnow";

// ---------------------------------------------------------------------------
// The composer's writes (/admin/articles). Admin-gated twice: the profile
// check here, and migration 0153's RLS (viewer_is_admin()) on every write the
// cookie-bound client makes. Every input goes through articleInputSchema
// (the CHECKs of 0153); a schedule or a publish also has to pass the SEO
// checklist's errors (lib/content/article-seo-checklist.ts) on the STORED
// row, so what goes out is what was checked.
//
// A live article changes in public at once: its edit purges the surfaces and
// tells IndexNow. A scheduled one goes out with /api/cron/publish-articles.
// ---------------------------------------------------------------------------

export type ArticleActionResult =
  | { ok: true; id: string; status?: "draft" | "scheduled" | "live" }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "The database isn't configured." };
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  return { ok: true, userId: profile.id };
}

function fieldErrorsOf(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

function columnsOf(input: ParsedArticleInput) {
  return {
    slug: input.slug,
    title: input.title,
    seo_title: input.seoTitle,
    description: input.description,
    excerpt: input.excerpt,
    body: input.body,
    tags: input.tags,
    category: input.category,
    faq: input.faq,
    cover_url: input.coverUrl,
    cover_alt: input.coverUrl ? input.coverAlt : null,
    cover_width: input.coverUrl ? input.coverWidth : null,
    cover_height: input.coverUrl ? input.coverHeight : null,
    author_id: input.authorId,
  };
}

function rowError(error: { code?: string; message: string }, fallback: string): ArticleActionResult {
  if (error.code === "23505") {
    return { ok: false, error: "Another article already has this slug.", fieldErrors: { slug: "Already taken." } };
  }
  if (error.message.startsWith("media_url_not_allowed")) {
    return {
      ok: false,
      error: "The cover must be an image uploaded here (or a PipGlyph diagram).",
      fieldErrors: { coverUrl: "Upload the cover through the composer." },
    };
  }
  console.warn("[articles]", fallback, error.message);
  return { ok: false, error: fallback };
}

async function readRow(id: string): Promise<ArticleRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("articles").select(ARTICLE_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as unknown as ArticleRow;
  return { ...row, faq: faqOf(row.faq) };
}

/** The live surfaces changed (an edit, a publish, an unpublish, a delete). */
function announce(rows: ReadonlyArray<Pick<ArticleRow, "slug" | "category" | "tags">>) {
  revalidateArticleSurfaces(rows.map((r) => r.slug));
  const paths = articleAnnouncePaths(rows);
  // Off the request path — IndexNow is best-effort and never delays a save.
  if (paths.length > 0) after(() => notifyIndexNow(paths));
}

/** Save the composer's fields (a new draft, or an edit that keeps the
 *  article's status). `revised`: the admin marks an edit of a LIVE article
 *  as a real revision — it moves the public "Updated" date (dateModified,
 *  sitemap lastmod); a fix that isn't one leaves it alone. */
export async function saveArticleAction(
  id: string | null,
  input: ArticleInput,
  options: { revised?: boolean } = {},
): Promise<ArticleActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = articleInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error.issues);
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
  }
  if (listArticles().some((a) => a.slug === parsed.data.slug)) {
    return {
      ok: false,
      error: "A guide in content/articles/ already lives at this URL.",
      fieldErrors: { slug: "Taken by an MDX guide." },
    };
  }
  const supabase = await createClient();
  const now = new Date().toISOString();

  if (!id) {
    const { data, error } = await supabase
      .from("articles")
      .insert({ ...columnsOf(parsed.data), created_by: gate.userId, is_published: false })
      .select("id")
      .single();
    if (error) return rowError(error, "Couldn't save the article.");
    revalidatePath("/admin/articles", "layout");
    return { ok: true, id: data.id as string, status: "draft" };
  }

  if (!isUuid(id)) return { ok: false, error: "Unknown article." };
  const existing = await readRow(id);
  if (!existing) return { ok: false, error: "Unknown article." };
  const status = articleStatus(existing);
  // A URL that has been public stays put: renaming it would 404 every link.
  if (existing.announced_at && parsed.data.slug !== existing.slug) {
    return {
      ok: false,
      error: "This article has been published — its URL can't change.",
      fieldErrors: { slug: "Locked once published." },
    };
  }
  if (status === "live") {
    // A live article stays as checked as it was when it went out.
    const blocked = await blockingMessage(columnsOf(parsed.data));
    if (blocked) return { ok: false, error: blocked };
  }
  const { error } = await supabase
    .from("articles")
    .update({
      ...columnsOf(parsed.data),
      updated_at: now,
      ...(status === "live" && options.revised ? { content_updated_at: now } : {}),
    })
    .eq("id", id);
  if (error) return rowError(error, "Couldn't save the article.");
  if (status === "live") {
    announce([existing, { slug: parsed.data.slug, category: parsed.data.category, tags: parsed.data.tags }]);
  } else {
    revalidatePath("/admin/articles", "layout");
  }
  return { ok: true, id, status };
}

function checklistInputOf(row: ReturnType<typeof columnsOf>): ChecklistInput {
  return {
    slug: row.slug,
    title: row.title,
    seoTitle: row.seo_title,
    description: row.description,
    body: row.body,
    tags: row.tags ?? [],
    category: row.category,
    faq: row.faq,
    coverUrl: row.cover_url,
    coverAlt: row.cover_alt,
    authorId: row.author_id,
  };
}

/** The checklist's blocking errors, as one sentence (null = none). */
async function blockingMessage(row: ReturnType<typeof columnsOf>): Promise<string | null> {
  const fileSlugs = listArticles().map((a) => a.slug);
  const known = (await listPublishedArticles()).map((a) => a.slug);
  const items = articleSeoChecklist(checklistInputOf(row), { fileSlugs, knownSlugs: known });
  const blocking = blockingItems(items);
  if (blocking.length === 0) return null;
  return `Fix before publishing: ${blocking.map((item) => item.label.toLowerCase()).join("; ")}.`;
}

/** Put a saved article in the backlog: public at `publishAtIso` (UTC). */
export async function scheduleArticleAction(id: string, publishAtIso: string): Promise<ArticleActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown article." };
  const at = new Date(publishAtIso);
  if (Number.isNaN(at.getTime())) return { ok: false, error: "Pick a publish time." };
  if (at.getTime() <= Date.now() + 60_000) {
    return { ok: false, error: "Pick a time in the future — or use Publish now." };
  }
  const row = await readRow(id);
  if (!row) return { ok: false, error: "Unknown article." };
  const blocked = await blockingMessage(row);
  if (blocked) return { ok: false, error: blocked };
  const wasLive = articleStatus(row) === "live";
  const supabase = await createClient();
  const { error } = await supabase
    .from("articles")
    .update({ is_published: true, publish_at: at.toISOString(), announced_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return rowError(error, "Couldn't schedule the article.");
  // Moving a live article back into the backlog takes it down until then.
  if (wasLive) announce([row]);
  else revalidatePath("/admin/articles", "layout");
  return { ok: true, id, status: "scheduled" };
}

/** Publish at once: public now, announced now. */
export async function publishArticleNowAction(id: string): Promise<ArticleActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown article." };
  const row = await readRow(id);
  if (!row) return { ok: false, error: "Unknown article." };
  if (articleStatus(row) === "live") return { ok: true, id, status: "live" };
  const blocked = await blockingMessage(row);
  if (blocked) return { ok: false, error: blocked };
  const now = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("articles")
    .update({ is_published: true, publish_at: now, announced_at: now, updated_at: now })
    .eq("id", id);
  if (error) return rowError(error, "Couldn't publish the article.");
  announce([row]);
  return { ok: true, id, status: "live" };
}

/** Back to a draft: off the site (a live article's URL then 404s). */
export async function unpublishArticleAction(id: string): Promise<ArticleActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown article." };
  const row = await readRow(id);
  if (!row) return { ok: false, error: "Unknown article." };
  const wasLive = articleStatus(row) === "live";
  const supabase = await createClient();
  const { error } = await supabase
    .from("articles")
    .update({ is_published: false, announced_at: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return rowError(error, "Couldn't unpublish the article.");
  if (wasLive) announce([row]);
  else revalidatePath("/admin/articles", "layout");
  return { ok: true, id, status: "draft" };
}

export async function deleteArticleAction(id: string): Promise<ArticleActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown article." };
  const row = await readRow(id);
  if (!row) return { ok: false, error: "Unknown article." };
  const supabase = await createClient();
  const { error } = await supabase.from("articles").delete().eq("id", id);
  if (error) return rowError(error, "Couldn't delete the article.");
  if (articleStatus(row) === "live") announce([row]);
  else revalidatePath("/admin/articles", "layout");
  return { ok: true, id };
}

export type ImportDraftsResult =
  | { ok: true; imported: string[]; skipped: string[] }
  | { ok: false; error: string };

/**
 * Load the drafts shipped in content/article-drafts/ as DRAFTS — the owner's
 * way to bring them to production without a script. A slug the database or
 * an MDX guide already has is skipped (never overwritten), so it is safe to
 * press twice. Nothing is scheduled or published.
 */
export async function importArticleDraftsAction(): Promise<ImportDraftsResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const drafts = readArticleDrafts();
  if (drafts.length === 0) return { ok: true, imported: [], skipped: [] };
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("articles")
    .select("slug")
    .in(
      "slug",
      drafts.map((d) => d.slug),
    );
  if (readError) return { ok: false, error: "Couldn't read the articles." };
  const taken = new Set([
    ...((existing ?? []) as Array<{ slug: string }>).map((r) => r.slug),
    ...listArticles().map((a) => a.slug),
  ]);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const draft of drafts) {
    if (taken.has(draft.slug)) {
      skipped.push(draft.slug);
      continue;
    }
    // No byline is invented: the owner picks the author in the composer.
    const parsed = articleInputSchema.safeParse(draft.input);
    if (!parsed.success) {
      console.warn(`[articles] draft ${draft.slug} doesn't parse:`, parsed.error.issues[0]?.message);
      skipped.push(draft.slug);
      continue;
    }
    const { error } = await supabase
      .from("articles")
      .insert({ ...columnsOf(parsed.data), created_by: gate.userId, is_published: false });
    if (error) {
      console.warn(`[articles] draft ${draft.slug} didn't insert:`, error.message);
      skipped.push(draft.slug);
      continue;
    }
    imported.push(draft.slug);
  }
  revalidatePath("/admin/articles", "layout");
  return { ok: true, imported, skipped };
}
