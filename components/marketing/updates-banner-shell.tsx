"use client";

import { useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, X } from "lucide-react";

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

// ---------------------------------------------------------------------------
// UpdatesBannerShell — the "what's new" ribbon under the site header. One
// tap target: the whole ribbon links to the news (or the update's own link),
// with a pulsing NEW beacon, the headline, the teased features and an arrow
// that slides on hover. Dismiss is a small X that doesn't follow the link.
// ---------------------------------------------------------------------------
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

  const href = headline?.href ?? "/news";

  return (
    <section aria-label="What's new on PipGlyph" className="relative z-10 border-b border-gold/25">
      {/* A soft gold glow behind the ribbon so it reads as a highlight, not chrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-r from-gold/15 via-primary/10 to-gold/15"
      />
      <div className="relative mx-auto flex w-full max-w-7xl items-stretch px-4 sm:px-6 lg:px-8">
        <Link
          href={href}
          className="group flex min-w-0 flex-1 flex-col gap-1 py-3 pr-10 text-sm sm:flex-row sm:items-center sm:gap-4"
        >
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold-strong" />
            </span>
            <span className="rounded-full border border-gold/50 bg-gold/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-strong">
              {headline ? "Just shipped" : "Coming soon"}
            </span>
          </span>
          {headline ? (
            <span className="min-w-0 truncate">
              <span className="font-display text-base font-semibold text-foreground">{headline.title}</span>
              <span className="hidden text-muted md:inline"> — {headline.summary}</span>
            </span>
          ) : null}
          {upcoming.length > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-muted sm:border-l sm:border-border/60 sm:pl-4">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary-bright" aria-hidden />
              <span className="truncate">
                <span className="font-medium text-foreground/90">Next up:</span> {upcoming.join(" · ")}
              </span>
            </span>
          ) : null}
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary-bright sm:ml-auto">
            See what&apos;s new
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update banner"
          className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-subtle transition-colors hover:bg-elevated hover:text-foreground sm:right-4"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
