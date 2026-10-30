"use client";

// ---------------------------------------------------------------------------
// ArticleComposer — /admin/articles/new and /admin/articles/[id]: write an
// article, save it as a draft, preview it, schedule it into the backlog or
// publish it now. The SEO checklist beside the form is the same function the
// server runs before a schedule or a publish (lib/content/
// article-seo-checklist.ts): its errors disable those buttons here and are
// refused there; its warnings are advice.
//
// Times are entered and shown in UTC (the /admin/updates convention).
// Pictures upload through the moderated set-covers action into the admin's
// own folder; alt text is asked for before an image is inserted.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  ImagePlus,
  Plus,
  Rocket,
  Save,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { inputClass, textareaClass } from "@/components/ui/field-classes";
import { ARTICLE_CATEGORIES } from "@/lib/content/article-categories";
import {
  ARTICLE_LIMITS,
  articleStatus,
  slugFromTitle,
  type ArticleFaqItem,
  type ArticleInput,
  type ArticleRow,
  type ArticleStatus,
} from "@/lib/content/article-shared";
import {
  articleSeoChecklist,
  blockingItems,
  DESCRIPTION_RANGE,
  TITLE_MAX,
  TITLE_SUFFIX,
  type ChecklistItem,
} from "@/lib/content/article-seo-checklist";
import {
  deleteArticleAction,
  publishArticleNowAction,
  saveArticleAction,
  scheduleArticleAction,
  unpublishArticleAction,
} from "@/lib/content/article-actions";
import { uploadCoverImage } from "@/lib/media/upload-cover";
import { toDateTimeLocal } from "@/lib/updates/shared";
import { cn } from "@/lib/utils";

export type AuthorOption = { id: string; label: string };

type FormState = {
  title: string;
  slug: string;
  seoTitle: string;
  description: string;
  excerpt: string;
  category: string;
  tags: string;
  authorId: string;
  coverUrl: string;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
  body: string;
  faq: ArticleFaqItem[];
};

const STATUS_LABEL: Record<ArticleStatus, string> = { draft: "Draft", scheduled: "Scheduled", live: "Live" };

function initialState(row: ArticleRow | null): FormState {
  return {
    title: row?.title ?? "",
    slug: row?.slug ?? "",
    seoTitle: row?.seo_title ?? "",
    description: row?.description ?? "",
    excerpt: row?.excerpt ?? "",
    category: row?.category ?? "",
    tags: (row?.tags ?? []).join(", "),
    authorId: row?.author_id ?? "",
    coverUrl: row?.cover_url ?? "",
    coverAlt: row?.cover_alt ?? "",
    coverWidth: row?.cover_width ?? null,
    coverHeight: row?.cover_height ?? null,
    body: row?.body ?? "",
    faq: row?.faq ?? [],
  };
}

function tagsOf(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function inputOf(state: FormState): ArticleInput {
  return {
    slug: state.slug.trim(),
    title: state.title,
    seoTitle: state.seoTitle,
    description: state.description,
    excerpt: state.excerpt,
    body: state.body,
    tags: tagsOf(state.tags),
    category: (state.category || null) as ArticleInput["category"],
    faq: state.faq.filter((f) => f.q.trim() && f.a.trim()),
    coverUrl: state.coverUrl,
    coverAlt: state.coverAlt,
    coverWidth: state.coverWidth,
    coverHeight: state.coverHeight,
    authorId: state.authorId || null,
  };
}

/** A datetime-local value in UTC → ISO (the /admin/updates rule). */
function utcIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value.length === 16 ? `${value}:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function ArticleComposer({
  article,
  fileSlugs,
  knownSlugs,
  otherPublishTimes,
  authors,
  viewerId,
  suggestedSlot,
}: {
  article: ArticleRow | null;
  fileSlugs: string[];
  knownSlugs: string[];
  /** Other composer articles' release times (scheduled or live). */
  otherPublishTimes: string[];
  authors: AuthorOption[];
  viewerId: string;
  /** The backlog's next open slot (UTC ISO). */
  suggestedSlot: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => initialState(article));
  const [publishAt, setPublishAt] = useState(() =>
    toDateTimeLocal(article && articleStatus(article) === "scheduled" ? article.publish_at : suggestedSlot),
  );
  const [revised, setRevised] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState<"cover" | "body" | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const bodyImageInput = useRef<HTMLInputElement>(null);

  const status: ArticleStatus = article ? articleStatus(article) : "draft";
  const slugLocked = Boolean(article?.announced_at);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const checklist = useMemo(
    () =>
      articleSeoChecklist(
        {
          ...inputOf(state),
          seoTitle: state.seoTitle || null,
          category: state.category || null,
          coverUrl: state.coverUrl || null,
          coverAlt: state.coverAlt || null,
          authorId: state.authorId || null,
          publishAt: status === "live" ? null : utcIso(publishAt),
        },
        { fileSlugs, knownSlugs, otherPublishTimes },
      ),
    [state, publishAt, status, fileSlugs, knownSlugs, otherPublishTimes],
  );
  const blocking = blockingItems(checklist);
  const warnings = checklist.filter((item) => item.level === "warning" && !item.ok);

  const save = async (): Promise<string | null> => {
    const result = await saveArticleAction(article?.id ?? null, inputOf(state), { revised });
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      adminErrorToast("articles", result.error);
      return null;
    }
    setFieldErrors({});
    return result.id;
  };

  const afterSave = (id: string, message: string) => {
    toast.success(message);
    if (!article) router.replace(`/admin/articles/${id}`);
    else router.refresh();
  };

  const onSave = () =>
    startTransition(async () => {
      const id = await save();
      if (id) afterSave(id, status === "live" ? "Saved — the live article is updated." : "Draft saved.");
    });

  const onSchedule = () =>
    startTransition(async () => {
      const at = utcIso(publishAt);
      if (!at) {
        adminErrorToast("articles", "Pick a publish time (UTC).");
        return;
      }
      const id = await save();
      if (!id) return;
      const result = await scheduleArticleAction(id, at);
      if (!result.ok) {
        adminErrorToast("articles", result.error);
        if (!article) router.replace(`/admin/articles/${id}`);
        return;
      }
      afterSave(id, `Scheduled for ${new Date(at).toUTCString().replace(" GMT", " UTC")}.`);
    });

  const onPublishNow = () => {
    if (!window.confirm(`Publish "${state.title || "this article"}" now? It goes live and search engines are told.`)) {
      return;
    }
    startTransition(async () => {
      const id = await save();
      if (!id) return;
      const result = await publishArticleNowAction(id);
      if (!result.ok) {
        adminErrorToast("articles", result.error);
        if (!article) router.replace(`/admin/articles/${id}`);
        return;
      }
      afterSave(id, "Published.");
    });
  };

  const onUnpublish = () => {
    if (!article) return;
    const live = status === "live";
    if (live && !window.confirm("Take this article down? Its URL answers 404 until it is published again.")) return;
    startTransition(async () => {
      const result = await unpublishArticleAction(article.id);
      if (!result.ok) {
        adminErrorToast("articles", result.error);
        return;
      }
      toast.success(live ? "Unpublished — back to a draft." : "Taken out of the schedule.");
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!article) return;
    if (!window.confirm(`Delete "${article.title}"? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteArticleAction(article.id);
      if (!result.ok) {
        adminErrorToast("articles", result.error);
        return;
      }
      toast.success("Article deleted.");
      router.push("/admin/articles");
    });
  };

  const upload = async (file: File, target: "cover" | "body") => {
    setUploading(target);
    try {
      const result = await uploadCoverImage(viewerId, file, { purpose: "article-image" });
      if (!result.ok) {
        adminErrorToast("articles", result.error);
        return null;
      }
      return result;
    } finally {
      setUploading(null);
    }
  };

  const onCoverFile = async (file: File | undefined) => {
    if (!file) return;
    const result = await upload(file, "cover");
    if (!result) return;
    setState((s) => ({
      ...s,
      coverUrl: result.publicUrl,
      coverWidth: result.width,
      coverHeight: result.height,
    }));
    toast.success("Cover uploaded — now describe it in the alt text.");
  };

  const onBodyImageFile = async (file: File | undefined) => {
    if (!file) return;
    // Alt text first: a picture without one is never inserted.
    const alt = window.prompt("Alt text — what does the picture show? (required)")?.trim();
    if (!alt) {
      toast.error("No alt text, no image: it was not uploaded.");
      return;
    }
    const caption = window.prompt("Caption (optional, shown under the picture)")?.trim() ?? "";
    const result = await upload(file, "body");
    if (!result) return;
    const safe = (text: string) => text.replace(/"/g, "'").replace(/[\n\r]+/g, " ");
    const snippet = `\n\n<Figure src="${result.publicUrl}" alt="${safe(alt)}"${caption ? ` caption="${safe(caption)}"` : ""}${
      result.width && result.height ? ` width="${result.width}" height="${result.height}"` : ""
    } />\n\n`;
    const el = bodyRef.current;
    setState((s) => {
      const at = el ? el.selectionStart : s.body.length;
      return { ...s, body: `${s.body.slice(0, at)}${snippet}${s.body.slice(at)}` };
    });
  };

  const shownTitle = `${(state.seoTitle || state.title).trim()}${TITLE_SUFFIX}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <SurfaceCard className="flex flex-wrap items-center gap-3 p-4">
          <Badge
            className={cn(
              status === "live" && "border-success/40 text-success",
              status === "scheduled" && "border-gold/40 text-gold-strong",
              status === "draft" && "text-subtle",
            )}
          >
            {STATUS_LABEL[status]}
          </Badge>
          {article?.publish_at && status !== "draft" ? (
            <span className="text-sm text-muted">
              {status === "live" ? "Live since" : "Goes out"}{" "}
              {new Date(article.publish_at).toUTCString().replace(" GMT", " UTC")}
            </span>
          ) : (
            <span className="text-sm text-muted">Not on the site.</span>
          )}
          {article ? (
            <Button asChild variant="ghost" size="sm" className="ml-auto">
              <Link href={`/admin/articles/${article.id}/preview`} target="_blank" rel="noopener">
                <Eye className="h-4 w-4" aria-hidden />
                Preview (saved version)
              </Link>
            </Button>
          ) : null}
        </SurfaceCard>

        <Field label="Title" error={fieldErrors.title} hint="The headline on the page (the H1).">
          {(aria) => (
            <input
              {...aria}
              className={inputClass(Boolean(fieldErrors.title))}
              value={state.title}
              maxLength={ARTICLE_LIMITS.title.max}
              onChange={(e) => set("title", e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Slug"
          error={fieldErrors.slug}
          hint={slugLocked ? "Locked: this URL has been public." : "The URL: /articles/<slug>. Short, lowercase, the words people search."}
        >
          {(aria) => (
            <div className="flex gap-2">
              <input
                {...aria}
                className={inputClass(Boolean(fieldErrors.slug))}
                value={state.slug}
                readOnly={slugLocked}
                maxLength={ARTICLE_LIMITS.slug.max}
                onChange={(e) => set("slug", e.target.value.toLowerCase())}
              />
              {!slugLocked ? (
                <Button type="button" variant="outline" onClick={() => set("slug", slugFromTitle(state.title))}>
                  From title
                </Button>
              ) : null}
            </div>
          )}
        </Field>

        <Field
          label="SEO title (optional)"
          error={fieldErrors.seoTitle}
          hint={`Shown in search and on shares as “${shownTitle}” — ${shownTitle.length}/${TITLE_MAX}.`}
        >
          {(aria) => (
            <input
              {...aria}
              className={inputClass(Boolean(fieldErrors.seoTitle))}
              value={state.seoTitle}
              maxLength={ARTICLE_LIMITS.seoTitle.max}
              placeholder={state.title}
              onChange={(e) => set("seoTitle", e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Summary"
          error={fieldErrors.description}
          hint={`The meta description, the share text and the RSS line — ${state.description.trim().length} characters (aim for ${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max}).`}
        >
          {(aria) => (
            <textarea
              {...aria}
              rows={2}
              className={textareaClass(Boolean(fieldErrors.description))}
              value={state.description}
              maxLength={ARTICLE_LIMITS.description.max}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </Field>

        <Field label="Standfirst (optional)" hint="The line under the headline, when it should differ from the summary.">
          {(aria) => (
            <textarea
              {...aria}
              rows={2}
              className={textareaClass(false)}
              value={state.excerpt}
              maxLength={ARTICLE_LIMITS.excerpt}
              onChange={(e) => set("excerpt", e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Category" error={fieldErrors.category} hint="Its /learn shelf and breadcrumb.">
            {(aria) => (
              <select
                {...aria}
                className={inputClass(Boolean(fieldErrors.category))}
                value={state.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">Pick one…</option>
                {ARTICLE_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Author" hint="The byline links to the author's profile.">
            {(aria) => (
              <select
                {...aria}
                className={inputClass(false)}
                value={state.authorId}
                onChange={(e) => set("authorId", e.target.value)}
              >
                <option value="">The PipGlyph Team</option>
                {authors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field label="Tags" error={fieldErrors.tags} hint="Comma-separated. Reuse existing tags so the article joins their hubs.">
          {(aria) => (
            <input
              {...aria}
              className={inputClass(Boolean(fieldErrors.tags))}
              value={state.tags}
              onChange={(e) => set("tags", e.target.value)}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-3 rounded-frame border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">Cover image</legend>
          {state.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.coverUrl}
              alt={state.coverAlt || "Cover (alt text missing)"}
              className="max-h-56 w-auto self-start rounded-md border border-border"
            />
          ) : (
            <p className="m-0 text-sm text-muted">No cover yet. Use your own picture or a PipGlyph render — never card art you don&apos;t own.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={coverInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              aria-label="Upload a cover image"
              onChange={(e) => {
                void onCoverFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" disabled={uploading !== null} onClick={() => coverInput.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden />
              {uploading === "cover" ? "Uploading…" : state.coverUrl ? "Replace cover" : "Upload cover"}
            </Button>
            {state.coverUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setState((s) => ({ ...s, coverUrl: "", coverAlt: "", coverWidth: null, coverHeight: null }))}
              >
                Remove cover
              </Button>
            ) : null}
          </div>
          <Field label="Cover alt text" error={fieldErrors.coverAlt} hint="Required with a cover: what the picture shows, in a sentence.">
            {(aria) => (
              <input
                {...aria}
                className={inputClass(Boolean(fieldErrors.coverAlt))}
                value={state.coverAlt}
                maxLength={ARTICLE_LIMITS.coverAlt}
                onChange={(e) => set("coverAlt", e.target.value)}
              />
            )}
          </Field>
        </fieldset>

        <Field
          label="Body"
          error={fieldErrors.body}
          hint="Markdown. Open with the answer, then ## sections. <Callout>, <Mana cost=…/> and <Figure …/> work as in the guides."
        >
          {(aria) => (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input
                  ref={bodyImageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  aria-label="Upload an image into the body"
                  onChange={(e) => {
                    void onBodyImageFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading !== null}
                  onClick={() => bodyImageInput.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" aria-hidden />
                  {uploading === "body" ? "Uploading…" : "Insert image at cursor"}
                </Button>
              </div>
              <textarea
                {...aria}
                ref={bodyRef}
                rows={28}
                className={cn(textareaClass(Boolean(fieldErrors.body)), "font-mono text-[0.8rem] leading-6")}
                value={state.body}
                maxLength={ARTICLE_LIMITS.body}
                onChange={(e) => set("body", e.target.value)}
              />
            </div>
          )}
        </Field>

        <fieldset className="flex flex-col gap-4 rounded-frame border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-foreground">FAQ</legend>
          <p className="m-0 text-sm text-muted">
            Printed under the article and sent as FAQPage data. Each answer should stand on its own.
          </p>
          {state.faq.map((item, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Question {index + 1}
                <input
                  className={inputClass(false)}
                  value={item.q}
                  maxLength={ARTICLE_LIMITS.faqQuestion}
                  onChange={(e) =>
                    set(
                      "faq",
                      state.faq.map((f, i) => (i === index ? { ...f, q: e.target.value } : f)),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-foreground">
                Answer
                <textarea
                  rows={3}
                  className={textareaClass(false)}
                  value={item.a}
                  maxLength={ARTICLE_LIMITS.faqAnswer}
                  onChange={(e) =>
                    set(
                      "faq",
                      state.faq.map((f, i) => (i === index ? { ...f, a: e.target.value } : f)),
                    )
                  }
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => set("faq", state.faq.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove question {index + 1}
              </Button>
            </div>
          ))}
          {state.faq.length < ARTICLE_LIMITS.faq ? (
            <Button type="button" variant="outline" className="self-start" onClick={() => set("faq", [...state.faq, { q: "", a: "" }])}>
              <Plus className="h-4 w-4" aria-hidden />
              Add a question
            </Button>
          ) : null}
        </fieldset>

        <SurfaceCard className="flex flex-col gap-4 p-5">
          <h2 className="m-0 font-display text-lg font-semibold text-foreground">Save and publish</h2>
          {status === "live" ? (
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={revised} onChange={(e) => setRevised(e.target.checked)} className="mt-1" />
              <span>
                This is a real revision — show “Updated” today.{" "}
                <span className="text-muted">Leave it off for a typo fix: the updated date is a promise to readers and search engines.</span>
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Publish time (UTC)
              <div className="flex flex-wrap gap-2">
                <input
                  type="datetime-local"
                  className={cn(inputClass(false), "max-w-xs")}
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
                <Button type="button" variant="ghost" onClick={() => setPublishAt(toDateTimeLocal(suggestedSlot))}>
                  <CalendarClock className="h-4 w-4" aria-hidden />
                  Next open slot
                </Button>
              </div>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={status === "live" ? "primary" : "secondary"} disabled={pending}>
              <Save className="h-4 w-4" aria-hidden />
              {status === "live" ? "Save changes" : "Save draft"}
            </Button>
            {status !== "live" ? (
              <>
                <Button type="button" disabled={pending || blocking.length > 0} onClick={onSchedule}>
                  <CalendarClock className="h-4 w-4" aria-hidden />
                  {status === "scheduled" ? "Save & reschedule" : "Save & schedule"}
                </Button>
                <Button type="button" variant="outline" disabled={pending || blocking.length > 0} onClick={onPublishNow}>
                  <Rocket className="h-4 w-4" aria-hidden />
                  Publish now
                </Button>
              </>
            ) : null}
            {article && status !== "draft" ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={onUnpublish}>
                <Undo2 className="h-4 w-4" aria-hidden />
                {status === "live" ? "Unpublish" : "Unschedule"}
              </Button>
            ) : null}
            {article ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={onDelete} className="text-danger">
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
            ) : null}
          </div>
          {blocking.length > 0 ? (
            <p className="m-0 text-sm text-danger" role="status">
              Scheduling and publishing wait for {blocking.length} required fix{blocking.length === 1 ? "" : "es"} in the checklist.
            </p>
          ) : null}
        </SurfaceCard>
      </form>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
        <h2 className="m-0 font-display text-lg font-semibold text-foreground">SEO checklist</h2>
        <p className="m-0 text-xs text-muted">
          {blocking.length} required · {warnings.length} advice · {checklist.length - blocking.length - warnings.length} done.
          From <code>docs/research/article-seo-2026-10.md</code>.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[...checklist].sort(order).map((item) => (
            <ChecklistRow key={item.id} item={item} />
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Failing errors first, then failing advice, then what passes. */
function order(a: ChecklistItem, b: ChecklistItem): number {
  const rank = (i: ChecklistItem) => (i.ok ? 2 : i.level === "error" ? 0 : 1);
  return rank(a) - rank(b);
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const Icon = item.ok ? CheckCircle2 : item.level === "error" ? XCircle : AlertTriangle;
  return (
    <li
      className={cn(
        "flex gap-2 rounded-md border p-2 text-sm",
        item.ok ? "border-border/60 text-muted" : item.level === "error" ? "border-danger/40" : "border-gold/40",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          item.ok ? "text-success" : item.level === "error" ? "text-danger" : "text-gold-strong",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn(!item.ok && "font-medium text-foreground")}>
          <span className="sr-only">{item.ok ? "Done: " : item.level === "error" ? "Required: " : "Advice: "}</span>
          {item.label}
        </span>
        {!item.ok ? <span className="text-xs leading-5 text-muted">{item.hint}</span> : null}
      </div>
    </li>
  );
}

type AriaProps = { id: string; "aria-describedby": string; "aria-invalid"?: boolean };

/** A labelled field whose hint (or error) describes its control. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (aria: AriaProps) => React.ReactNode;
}) {
  const id = useMemo(() => `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, [label]);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children({ id, "aria-describedby": `${id}-hint`, ...(error ? { "aria-invalid": true } : {}) })}
      <p id={`${id}-hint`} className={cn("m-0 text-xs leading-5", error ? "text-danger" : "text-muted")}>
        {error ?? hint}
      </p>
    </div>
  );
}
