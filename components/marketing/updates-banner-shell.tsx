"use client";

import { useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles, X } from "lucide-react";

const STORAGE_KEY = "pipglyph:updates-banner:dismissed";

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function UpdatesBannerShell({
  dismissKey,
  headline,
  upcoming,
}: {
  /** Changes whenever the banner's content changes, so a dismissed banner
   *  comes back the next time there is genuinely new news. */
  dismissKey: string;
  headline: { title: string; summary: string; href: string } | null;
  upcoming: string[];
}) {
  // Read the stored dismissal without an effect. The server (and hydration)
  // snapshot is "not dismissed", so the banner is in the static HTML and
  // never pops in late; a viewer who dismissed it sees it vanish right after
  // hydration instead — the rarer case, and no layout shift for everyone else.
  const stored = useSyncExternalStore(
    subscribeStorage,
    () => readDismissed(),
    () => null,
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  if (dismissedNow || stored === dismissKey) return null;

  const dismiss = () => {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, dismissKey);
    } catch {
      // storage blocked — the banner just shows again next visit
    }
  };

  return (
    <section
      aria-label="What's new on PipGlyph"
      className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
    >
      <div className="relative mt-2 flex flex-col gap-3 rounded-xl border border-gold/30 bg-linear-to-r from-gold/10 via-surface to-primary/10 px-5 py-4 shadow-[0_18px_60px_-30px_rgba(201,165,76,0.6)] sm:flex-row sm:items-center sm:gap-6">
        {headline ? (
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <Megaphone className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-strong">
                Just shipped
              </p>
              <p className="truncate font-display text-base font-semibold text-foreground">
                {headline.title}
              </p>
              <p className="line-clamp-2 text-sm leading-5 text-muted">{headline.summary}</p>
            </div>
          </div>
        ) : null}
        {upcoming.length > 0 ? (
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:border-l sm:border-border/60 sm:pl-6">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-bright">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-bright">
                On the forge next
              </p>
              <p className="text-sm leading-6 text-foreground">
                {upcoming.join(" · ")}
              </p>
            </div>
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-2 sm:pr-8">
          <Link
            href={headline?.href ?? "/news"}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-bright hover:underline"
          >
            See what&apos;s new
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update banner"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-subtle transition-colors hover:bg-elevated hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
