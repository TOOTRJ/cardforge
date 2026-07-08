import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Sparkles } from "lucide-react";

// Coming-soon stub — the route, nav item, and chrome are wired so Decks can
// ship incrementally; the page itself is a static teaser. noindex until the
// feature exists (a thin "coming soon" page shouldn't rank), and the static
// guard keeps it CDN-cacheable like every other marketing page.
export const dynamic = "error";

export const metadata: Metadata = {
  title: "Decks",
  description:
    "Build, organize, and share decks of your custom cards. Coming soon to PipGlyph.",
  robots: { index: false },
  alternates: { canonical: "/decks" },
};

export default function DecksPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <div
        aria-hidden
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-gold/30 bg-elevated/60"
      >
        <Layers className="h-8 w-8 text-gold" />
      </div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-gold">
        Coming soon
      </p>
      <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
        Decks
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
        Build decks from your custom cards and the community gallery, organize
        them by format or theme, and share a whole deck as easily as a single
        card. We&apos;re forging this now.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/gallery"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Explore the gallery
        </Link>
        <Link
          href="/sets"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          Browse community sets
        </Link>
      </div>
    </div>
  );
}
