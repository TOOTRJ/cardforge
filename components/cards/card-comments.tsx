"use client";

// ---------------------------------------------------------------------------
// CardComments
//
// Renders the comment thread on a public card detail page.
//
// - Anonymous viewers see the list and a sign-in CTA where the composer
//   would be.
// - Authenticated viewers can post; the author of each comment can edit
//   or delete their own row.
// - RLS already enforces who can do what; this component just surfaces
//   the right affordances and handles optimistic state.
//
// Server state lives in `lib/cards/comments-queries.ts` /
// `lib/cards/comments-actions.ts`. The page passes `initialComments` so
// the first render doesn't need a client fetch.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircle, Pencil, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import {
  createCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from "@/lib/cards/comments-actions";
import type { CardCommentWithAuthor } from "@/types/card";

const MAX_BODY = 2000;

type Props = {
  cardId: string;
  cardSlug: string;
  initialComments: CardCommentWithAuthor[];
  currentUserId: string | null;
};

export function CardComments({
  cardId,
  cardSlug,
  initialComments,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, startSubmit] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    startSubmit(async () => {
      const result = await createCommentAction(cardId, body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDraft("");
      // Server revalidates the path; refresh to pull the new comment row in
      // with its created_at + id rather than guessing locally.
      router.refresh();
    });
  };

  const handleLocalRemove = (commentId: string) => {
    setComments((current) => current.filter((c) => c.id !== commentId));
  };

  const handleLocalReplace = (commentId: string, body: string) => {
    setComments((current) =>
      current.map((c) =>
        c.id === commentId
          ? { ...c, body, updated_at: new Date().toISOString() }
          : c,
      ),
    );
  };

  // Re-seed when the parent re-renders with fresh server data (revalidation).
  // We compare against the array reference so users editing in place don't
  // lose their typed-but-unsaved draft.
  useReplaceWhenChanged(comments, initialComments, setComments);

  return (
    <SurfaceCard className="flex flex-col gap-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-foreground">
            Comments
            <span className="ml-2 text-xs font-normal text-subtle">
              {comments.length === 1 ? "1 comment" : `${comments.length} comments`}
            </span>
          </h2>
        </div>
      </header>

      {currentUserId ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Leave a note for the designer…"
            rows={3}
            maxLength={MAX_BODY}
            aria-label="Write a comment"
            className={cn(
              "w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-subtle",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-subtle">
              {draft.length}/{MAX_BODY}
            </span>
            <Button type="submit" size="sm" disabled={submitting || !draft.trim()}>
              <Send className="h-3.5 w-3.5" aria-hidden />
              {submitting ? "Posting…" : "Post comment"}
            </Button>
          </div>
        </form>
      ) : (
        <SignedOutNudge cardSlug={cardSlug} />
      )}

      <div className="flex flex-col gap-3">
        {comments.length === 0 ? (
          <p className="text-xs text-subtle">
            No comments yet. Be the first to leave one.
          </p>
        ) : (
          comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              onDelete={() => handleLocalRemove(comment.id)}
              onReplace={(body) => handleLocalReplace(comment.id, body)}
            />
          ))
        )}
      </div>
    </SurfaceCard>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SignedOutNudge({ cardSlug }: { cardSlug: string }) {
  const redirectTo = encodeURIComponent(`/card/${cardSlug}`);
  return (
    <div className="rounded-md border border-border/60 bg-elevated/60 px-4 py-3 text-xs text-muted">
      <Link
        href={`/login?redirectTo=${redirectTo}`}
        className="font-semibold text-primary hover:underline"
      >
        Sign in
      </Link>{" "}
      to leave a comment. Reading is open to everyone.
    </div>
  );
}

function CommentRow({
  comment,
  currentUserId,
  onDelete,
  onReplace,
}: {
  comment: CardCommentWithAuthor;
  currentUserId: string | null;
  onDelete: () => void;
  onReplace: (body: string) => void;
}) {
  const router = useRouter();
  const isAuthor = currentUserId !== null && currentUserId === comment.author_id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, startBusy] = useTransition();

  const handleSaveEdit = () => {
    const body = draft.trim();
    if (!body || body === comment.body) {
      setEditing(false);
      return;
    }
    startBusy(async () => {
      const result = await updateCommentAction(comment.id, body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onReplace(body);
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    startBusy(async () => {
      const result = await deleteCommentAction(comment.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDelete();
      router.refresh();
    });
  };

  const author = comment.author;
  const displayName =
    author?.display_name || author?.username || "Anonymous";

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 px-4 py-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {author?.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={author.avatar_url}
              alt={`${displayName}'s avatar`}
              className="h-6 w-6 rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated text-[10px] font-semibold text-foreground"
            >
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-xs font-medium text-foreground">
            {author?.username ? (
              <Link
                href={`/profile/${author.username}`}
                className="font-mono text-foreground hover:underline"
              >
                @{author.username}
              </Link>
            ) : (
              displayName
            )}
          </span>
          <span className="text-[10px] text-subtle" title={comment.created_at}>
            {formatRelative(comment.created_at)}
            {comment.updated_at !== comment.created_at ? " · edited" : null}
          </span>
        </div>
        {isAuthor && !editing ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Edit comment"
              className="rounded p-1 text-subtle transition-colors hover:bg-elevated hover:text-foreground"
            >
              <Pencil className="h-3 w-3" aria-hidden />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              aria-label="Delete comment"
              className="rounded p-1 text-subtle transition-colors hover:bg-elevated hover:text-danger"
            >
              <Trash2 className="h-3 w-3" aria-hidden />
            </button>
          </div>
        ) : null}
      </header>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={MAX_BODY}
            aria-label="Edit comment"
            className={cn(
              "w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            )}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              disabled={busy}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveEdit}
              disabled={busy || !draft.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm leading-6 text-foreground">
          {comment.body}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(value: string): string {
  try {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch {
    return value;
  }
}

// When the server-rendered `initialComments` changes (because of a
// router.refresh after a mutation), pull the new list in. We do this with a
// shallow id-array compare so we don't tromp on a user mid-edit.
function useReplaceWhenChanged<T extends { id: string }>(
  current: T[],
  incoming: T[],
  setLocal: React.Dispatch<React.SetStateAction<T[]>>,
) {
  const currentKey = current.map((c) => c.id).join(",");
  const incomingKey = incoming.map((c) => c.id).join(",");
  if (currentKey !== incomingKey) {
    // Defer the state update to the next tick so we don't update during
    // render.
    queueMicrotask(() => setLocal(incoming));
  }
}
