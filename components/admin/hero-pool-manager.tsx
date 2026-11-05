"use client";

// The home hero's pool (TODO HM4, migration 0169): the cards the hero rotates
// through, two a day. A pasted card URL adds any public card with
// a render; a suggestion (original cards only) adds through the full guard.
// A pool card the hero can't draw says why, and one that isn't an original
// carries a note — information only. Every change purges the home page at
// once.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { addHeroPoolCardAction, removeHeroPoolCardAction } from "@/lib/featured/actions";
import { heroRefusalLabel, notOriginalLabel } from "@/lib/featured/hero-rotation";

export type AdminHeroPoolCard = {
  cardId: string;
  title: string;
  slug: string;
  ownerUsername: string | null;
  /** Why the hero can't draw it (home_hero_shown_refusal's code, or the
   *  page's own); null = it rotates on the hero. */
  refusal: string | null;
  /** The original-card guard's first reason — a note, never a block. */
  notOriginal: string | null;
};

export type AdminHeroSuggestion = {
  cardId: string;
  title: string;
  slug: string;
  ownerUsername: string;
  likes: number;
  thumbUrl: string | null;
};

export type HeroDayPair = { label: string; titles: string[] };

export function HeroPoolManager({
  pool,
  suggestions,
  days,
}: {
  pool: AdminHeroPoolCard[];
  suggestions: AdminHeroSuggestion[];
  /** Today's and tomorrow's hero cards, as the home page will pick them. */
  days: HeroDayPair[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const add = (target: { cardUrl: string } | { cardId: string }) =>
    startTransition(async () => {
      setBusyId("cardId" in target ? target.cardId : null);
      const result = await addHeroPoolCardAction(target);
      setBusyId(null);
      if (!result.ok) {
        if ("cardUrl" in target) setError(result.error);
        else adminErrorToast("hero pool add", result.error);
        return;
      }
      setError(null);
      setUrl("");
      toast.success(result.already ? "Already in the pool." : "Added to the hero's pool.");
      router.refresh();
    });

  const remove = (cardId: string) =>
    startTransition(async () => {
      setBusyId(cardId);
      const result = await removeHeroPoolCardAction(cardId);
      setBusyId(null);
      if (!result.ok) {
        adminErrorToast("hero pool remove", result.error);
        return;
      }
      toast.success("Removed from the pool.");
      router.refresh();
    });

  const shown = pool.filter((c) => c.refusal === null).length;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-3 sm:grid-cols-2">
        {days.map((day) => (
          <div key={day.label} className="rounded-lg border border-border/50 bg-elevated/30 px-4 py-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-subtle">{day.label}</dt>
            <dd className="mt-1 text-sm text-foreground">
              {day.titles.length > 0 ? day.titles.join(" · ") : "The placeholder pair"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          In the pool{" "}
          <span className="font-normal text-subtle">
            · {shown} on the hero{pool.length > shown ? `, ${pool.length - shown} held back` : ""}
          </span>
        </h3>
        {pool.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing yet — the hero shows the fallback slots below, else its placeholder pair.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pool.map((card) => (
              <li
                key={card.cardId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-elevated/30 px-4 py-3"
              >
                <Star
                  className={`h-4 w-4 shrink-0 ${card.refusal ? "text-subtle" : "text-gold"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">
                    {card.ownerUsername ? (
                      <Link
                        href={`/card/${card.ownerUsername}/${card.slug}`}
                        className="hover:underline"
                      >
                        {card.title}
                      </Link>
                    ) : (
                      card.title
                    )}{" "}
                    <span className="text-subtle">
                      {card.ownerUsername ? `by @${card.ownerUsername}` : ""}
                    </span>
                  </p>
                  {card.refusal ? (
                    <p className="text-xs text-gold-strong">
                      Not on the hero: {heroRefusalLabel(card.refusal)}
                    </p>
                  ) : null}
                  {card.notOriginal ? (
                    <p className="text-xs text-subtle">
                      Not original: {notOriginalLabel(card.notOriginal)}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={`Remove ${card.title} from the pool`}
                  onClick={() => remove(card.cardId)}
                >
                  {busyId === card.cardId ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <X className="h-4 w-4" aria-hidden />
                  )}
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-1 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add({ cardUrl: url });
          }}
        >
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://www.pipglyph.com/card/username/card-slug"
            aria-label="Card URL to add to the hero's pool"
            aria-invalid={Boolean(error)}
            className={`w-full max-w-md rounded-md border bg-elevated/40 px-3 py-2 text-sm text-foreground placeholder:text-subtle focus:border-primary/60 focus:outline-none ${error ? "border-danger/60" : "border-border"}`}
          />
          <Button type="submit" size="sm" disabled={pending || !url.trim()}>
            {pending && busyId === null ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Add to pool
          </Button>
          {error ? (
            <p role="alert" className="w-full text-xs text-danger">
              {error}
            </p>
          ) : (
            <p className="w-full text-xs text-muted">
              Any public card with a render, whoever made it — imports and remixes included.
            </p>
          )}
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Suggestions</h3>
        <p className="text-xs text-muted">
          The last 120 days&apos; most-liked cards that pass the checks (public, baked, not made
          from a real card, not a remix, a creator&apos;s). Nothing automatic can tell a fan card of
          another company&apos;s character from an original — that call is yours.
        </p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted">No suggestions right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li
                key={s.cardId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 px-4 py-2"
              >
                {s.thumbUrl ? (
                  // A 600 px thumb drawn at 40 px: a plain <img>, like the
                  // other admin lists.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.thumbUrl}
                    alt=""
                    width={40}
                    height={56}
                    loading="lazy"
                    className="h-14 w-10 shrink-0 rounded-sm object-cover"
                  />
                ) : null}
                <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                  <Link href={`/card/${s.ownerUsername}/${s.slug}`} className="hover:underline">
                    {s.title}
                  </Link>{" "}
                  <span className="text-subtle">
                    by @{s.ownerUsername} · {s.likes} {s.likes === 1 ? "like" : "likes"}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  aria-label={`Add ${s.title} to the pool`}
                  onClick={() => add({ cardId: s.cardId })}
                >
                  {busyId === s.cardId ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden />
                  )}
                  Add to pool
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
