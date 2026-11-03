"use client";

// "Featured themed decks" (migration 0167) — the admin's control on
// /admin/featured: make a theme (title + blurb), paste deck links into it,
// order themes and decks, put a theme live or rest it. The first three live
// themes with a visible deck show on /decks (the first two on the home
// page), each with its first four decks a visitor may see. A pick that a
// visitor can't see right now (turned private, emptied, its maker no
// longer a creator) is marked "Hidden" — it stays, and shows again once it
// qualifies.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { adminErrorToast } from "@/lib/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/field-classes";
import {
  addDeckToThemeAction,
  createDeckThemeAction,
  deleteDeckThemeAction,
  moveDeckInThemeAction,
  moveDeckThemeAction,
  removeDeckFromThemeAction,
  setDeckThemeLiveAction,
  updateDeckThemeAction,
  type DeckThemeActionResult,
} from "@/lib/featured/deck-theme-actions";
import { DECK_THEME_BLURB_MAX, DECK_THEME_TITLE_MAX } from "@/lib/validation/deck-theme";

export type AdminDeckThemePick = {
  deckId: string;
  title: string;
  slug: string;
  /** Why a visitor can't see it now; null = shown. */
  hiddenReason: string | null;
};

export type AdminDeckTheme = {
  id: string;
  title: string;
  blurb: string | null;
  isLive: boolean;
  picks: AdminDeckThemePick[];
};

export function FeaturedDeckThemesManager({ themes }: { themes: AdminDeckTheme[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<DeckThemeActionResult>, done: string, onError?: (error: string) => void) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        const result = await action();
        if (!result.ok) {
          if (onError) onError(result.error);
          else adminErrorToast("featured deck themes", result.error);
          resolve(false);
          return;
        }
        toast.success(done);
        router.refresh();
        resolve(true);
      }),
    );

  return (
    <div className="flex flex-col gap-6">
      {themes.length === 0 ? (
        <p className="text-sm text-muted">No themes yet — the section stays hidden until a live theme holds a deck.</p>
      ) : (
        <ol className="flex flex-col gap-5">
          {themes.map((theme, index) => (
            <li key={theme.id}>
              <ThemeCard
                theme={theme}
                first={index === 0}
                last={index === themes.length - 1}
                pending={pending}
                run={run}
              />
            </li>
          ))}
        </ol>
      )}
      <NewThemeForm pending={pending} run={run} />
      <p className="text-[11px] text-subtle">
        /decks shows the first three live themes that hold a visible deck, the home page the first two — each with its
        first four visible decks. A deck shows only while it is public, has cards, and its maker is a creator (a public
        card of their own, not an admin).
      </p>
    </div>
  );
}

type Run = (action: () => Promise<DeckThemeActionResult>, done: string, onError?: (error: string) => void) => Promise<boolean>;

function NewThemeForm({ pending, run }: { pending: boolean; run: Run }) {
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const blurbId = useId();
  const errorId = useId();
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border/70 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await run(() => createDeckThemeAction({ title, blurb }), "Theme created.", setError);
        if (ok) {
          setTitle("");
          setBlurb("");
          setError(null);
        }
      }}
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">New theme</span>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label htmlFor={titleId} className="flex flex-col gap-1 text-xs text-muted">
          Title
          <input
            id={titleId}
            value={title}
            maxLength={DECK_THEME_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Dragons ascendant"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            className={inputClass(Boolean(error))}
          />
        </label>
        <label htmlFor={blurbId} className="flex flex-col gap-1 text-xs text-muted">
          Blurb (optional)
          <input
            id={blurbId}
            value={blurb}
            maxLength={DECK_THEME_BLURB_MAX}
            onChange={(event) => setBlurb(event.target.value)}
            placeholder="Fire-breathing tribal decks, from mono-red to five colours."
            className={inputClass(false)}
          />
        </label>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" className="self-start" disabled={pending || !title.trim()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        Create theme
      </Button>
    </form>
  );
}

function ThemeCard({
  theme,
  first,
  last,
  pending,
  run,
}: {
  theme: AdminDeckTheme;
  first: boolean;
  last: boolean;
  pending: boolean;
  run: Run;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(theme.title);
  const [blurb, setBlurb] = useState(theme.blurb ?? "");
  const [url, setUrl] = useState("");
  const [themeError, setThemeError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const titleId = useId();
  const blurbId = useId();
  const urlId = useId();
  const deckErrorId = useId();
  const visible = theme.picks.filter((pick) => !pick.hiddenReason).length;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/60 bg-elevated/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 flex-col gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await run(() => updateDeckThemeAction(theme.id, { title, blurb }), "Theme saved.", setThemeError);
              if (ok) {
                setEditing(false);
                setThemeError(null);
              }
            }}
          >
            <label htmlFor={titleId} className="flex flex-col gap-1 text-xs text-muted">
              Title
              <input
                id={titleId}
                value={title}
                maxLength={DECK_THEME_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClass(Boolean(themeError))}
              />
            </label>
            <label htmlFor={blurbId} className="flex flex-col gap-1 text-xs text-muted">
              Blurb (optional)
              <input
                id={blurbId}
                value={blurb}
                maxLength={DECK_THEME_BLURB_MAX}
                onChange={(event) => setBlurb(event.target.value)}
                className={inputClass(false)}
              />
            </label>
            {themeError ? (
              <p role="alert" className="text-xs text-danger">
                {themeError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending || !title.trim()}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setTitle(theme.title);
                  setBlurb(theme.blurb ?? "");
                  setThemeError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold text-foreground">{theme.title}</h3>
              <Badge variant={theme.isLive ? "gold" : "outline"}>{theme.isLive ? "Live" : "Resting"}</Badge>
              <span className="text-xs text-subtle">
                {visible} of {theme.picks.length} deck{theme.picks.length === 1 ? "" : "s"} visible
              </span>
            </div>
            {theme.blurb ? <p className="text-sm text-muted">{theme.blurb}</p> : null}
          </div>
        )}
        {!editing ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" size="sm" variant="ghost" disabled={pending || first} aria-label={`Move ${theme.title} up`}
              onClick={() => run(() => moveDeckThemeAction(theme.id, -1), "Theme moved.")}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending || last} aria-label={`Move ${theme.title} down`}
              onClick={() => run(() => moveDeckThemeAction(theme.id, 1), "Theme moved.")}>
              <ArrowDown className="h-4 w-4" aria-hidden />
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending}
              onClick={() => run(() => setDeckThemeLiveAction(theme.id, !theme.isLive), theme.isLive ? "Theme resting." : "Theme live.")}>
              {theme.isLive ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              {theme.isLive ? "Rest" : "Go live"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete the theme "${theme.title}" and its picks? The decks themselves stay.`)) {
                  void run(() => deleteDeckThemeAction(theme.id), "Theme deleted.");
                }
              }}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {theme.picks.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {theme.picks.map((pick, index) => (
            <li key={pick.deckId} className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm">
              <span className="w-5 text-xs tabular-nums text-subtle">{index + 1}.</span>
              <Link href={`/deck/${pick.slug}`} className="min-w-0 flex-1 truncate text-foreground underline-offset-4 hover:underline">
                {pick.title}
              </Link>
              {pick.hiddenReason ? <Badge variant="outline">Hidden: {pick.hiddenReason}</Badge> : null}
              <Button type="button" size="sm" variant="ghost" disabled={pending || index === 0} aria-label={`Move ${pick.title} up`}
                onClick={() => run(() => moveDeckInThemeAction(theme.id, pick.deckId, -1), "Deck moved.")}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending || index === theme.picks.length - 1}
                aria-label={`Move ${pick.title} down`}
                onClick={() => run(() => moveDeckInThemeAction(theme.id, pick.deckId, 1), "Deck moved.")}>
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${pick.title} from ${theme.title}`}
                onClick={() => run(() => removeDeckFromThemeAction(theme.id, pick.deckId), "Deck removed.")}>
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted">No decks yet — paste a deck link below.</p>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!url.trim()) return;
          const ok = await run(() => addDeckToThemeAction(theme.id, url), "Deck added.", setDeckError);
          if (ok) {
            setUrl("");
            setDeckError(null);
          }
        }}
      >
        <label htmlFor={urlId} className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Add a deck to {theme.title}
          <input
            id={urlId}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (deckError) setDeckError(null);
            }}
            placeholder="https://www.pipglyph.com/deck/deck-slug"
            aria-describedby={deckError ? deckErrorId : undefined}
            aria-invalid={Boolean(deckError)}
            className={inputClass(Boolean(deckError))}
          />
        </label>
        <Button type="submit" size="sm" disabled={pending || !url.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          Add deck
        </Button>
        {deckError ? (
          <p id={deckErrorId} role="alert" className="w-full text-xs text-danger">
            {deckError}
          </p>
        ) : null}
      </form>
    </div>
  );
}
