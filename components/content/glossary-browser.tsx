"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  filterGlossary,
  GLOSSARY_LETTERS,
  GLOSSARY_TERMS,
  glossaryTerm,
  groupGlossaryByLetter,
  type GlossaryTerm,
} from "@/lib/content/glossary";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// GlossaryBrowser — /glossary's terms (lib/content/glossary.ts): the A–Z
// jump list, a filter box, and the entries by letter, each with its anchor
// (`#<id>`, letters `#letter-<x>`).
//
// The page is static: the server HTML holds every entry, so a link to
// /glossary#proxy lands without JavaScript and a crawler reads it all. The
// filter only narrows what is drawn once React is up; its count is a polite
// status line, and a letter with nothing to show is dimmed, never a link.
// An anchor the filter has hidden (a "See also" link, or the address bar)
// clears the filter and scrolls to the entry, so no in-page link is dead.
// ---------------------------------------------------------------------------

const PIPGLYPH_COUNT = GLOSSARY_TERMS.filter((entry) => entry.source === "pipglyph").length;

const letterId = (letter: string) => `letter-${letter.toLowerCase()}`;

const linkClass =
  "rounded-sm font-medium text-primary-bright underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

export function GlossaryBrowser() {
  const [query, setQuery] = useState("");
  // An entry to scroll to once a cleared filter has drawn it again.
  const scrollTo = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => filterGlossary(GLOSSARY_TERMS, query), [query]);
  const groups = useMemo(() => groupGlossaryByLetter(shown), [shown]);
  const lettersShown = new Set(groups.map((group) => group.letter));
  const filtering = query.trim().length > 0;

  useEffect(() => {
    const onHashChange = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && !document.getElementById(id) && glossaryTerm(id)) {
        scrollTo.current = id;
        setQuery("");
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // The cleared filter has drawn every entry again: land on the one asked for.
  useEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    scrollTo.current = null;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [groups]);

  const status = filtering
    ? shown.length === 0
      ? `No term matches "${query.trim()}".`
      : `${shown.length} of ${GLOSSARY_TERMS.length} terms match.`
    : `${GLOSSARY_TERMS.length} terms, ${PIPGLYPH_COUNT} of them PipGlyph's own.`;

  return (
    <div className="mt-10 lg:grid lg:grid-cols-[15rem_minmax(0,46rem)] lg:gap-x-14 xl:gap-x-20">
      {/* The rail: filter, A–Z, the badge's key. Sticky beside the list on
          large screens; above it on phones. */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div role="search" aria-label="Glossary">
          <label
            htmlFor="glossary-filter"
            className="mb-2 block text-xs font-semibold uppercase tracking-[0.16em] text-subtle"
          >
            Filter terms
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              ref={inputRef}
              id="glossary-filter"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pip, DFC, proxy…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="glossary-status"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-3 text-sm text-foreground shadow-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          <p id="glossary-status" role="status" className="mt-2 text-xs leading-5 text-subtle">
            {status}
          </p>
        </div>

        <nav aria-label="Glossary, A to Z" className="mt-6">
          <ul className="flex flex-wrap gap-1 lg:grid lg:grid-cols-6">
            {GLOSSARY_LETTERS.map((letter) =>
              lettersShown.has(letter) ? (
                <li key={letter}>
                  <a
                    href={`#${letterId(letter)}`}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-surface/60 font-display text-sm font-semibold text-foreground transition-colors hover:border-gold/50 hover:text-gold-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                  >
                    {letter}
                  </a>
                </li>
              ) : (
                // No entry under this letter (or none the filter keeps):
                // drawn for the shape of the alphabet, hidden from a
                // screen reader, never a link.
                <li key={letter} aria-hidden>
                  <span className="flex h-9 w-9 items-center justify-center font-display text-sm text-subtle/40">
                    {letter}
                  </span>
                </li>
              ),
            )}
          </ul>
        </nav>

        {/* The badge's key — on phones the badge speaks for itself, and the
            rail already stands between the reader and the first entry. */}
        <p className="mt-6 hidden items-center gap-2 text-xs leading-5 text-subtle lg:flex">
          <Badge variant="primary" aria-hidden>
            PipGlyph
          </Badge>
          marks a word PipGlyph uses for the cards you make here.
        </p>
      </div>

      {/* The entries */}
      <div className="mt-10 flex flex-col gap-10 lg:mt-0">
        {groups.length === 0 ? (
          <SurfaceCard className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm leading-6 text-muted">
              Nothing in the glossary matches that. Try a shorter word, or another name for it.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className={cn(linkClass, "text-sm")}
            >
              Clear the filter
            </button>
          </SurfaceCard>
        ) : (
          groups.map((group) => (
            <section key={group.letter} aria-labelledby={letterId(group.letter)}>
              <h2
                id={letterId(group.letter)}
                className="flex scroll-mt-24 items-center gap-4 font-display text-3xl font-semibold text-gold-strong"
              >
                {group.letter}
                <span aria-hidden className="divider-gold flex-1" />
              </h2>
              <dl className="mt-2 divide-y divide-border/50">
                {group.terms.map((entry) => (
                  <GlossaryEntry key={entry.id} entry={entry} />
                ))}
              </dl>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function GlossaryEntry({ entry }: { entry: GlossaryTerm }) {
  const related = (entry.related ?? [])
    .map((id) => glossaryTerm(id))
    .filter((term): term is GlossaryTerm => Boolean(term));
  return (
    // The anchor. scroll-mt keeps it clear of the sticky header; :target
    // marks the entry a link landed on (rounded only then: a radius would
    // curl the ends of the divider between entries).
    <div
      id={entry.id}
      className="-mx-3 scroll-mt-24 px-3 py-5 transition-colors target:rounded-card target:bg-gold/[0.06] target:ring-1 target:ring-inset target:ring-gold/35"
    >
      <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-xl font-semibold tracking-tight text-foreground">
          {entry.term}
        </span>
        {entry.source === "pipglyph" ? (
          <>
            {/* The name says it to a screen reader. */}
            <Badge variant="primary" aria-hidden className="self-center">
              PipGlyph
            </Badge>
            <span className="sr-only">(a PipGlyph term)</span>
          </>
        ) : null}
        {entry.aliases?.length ? (
          <span className="text-sm text-subtle">Also called {entry.aliases.join(", ")}</span>
        ) : null}
      </dt>
      <dd className="mt-2 text-[0.95rem] leading-7 text-muted">{entry.definition}</dd>
      {entry.guide || entry.tryIt ? (
        <dd className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {entry.guide ? (
            <Link href={entry.guide.href} className={cn(linkClass, "inline-flex items-center gap-1")}>
              {entry.guide.label}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
          {entry.tryIt ? (
            <Link
              href={entry.tryIt.href}
              className="rounded-sm text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              {entry.tryIt.label}
            </Link>
          ) : null}
        </dd>
      ) : null}
      {related.length > 0 ? (
        <dd className="mt-3 text-sm leading-6 text-subtle">
          See also{" "}
          {related.map((term, index) => (
            <span key={term.id}>
              {index > 0 ? ", " : null}
              <a
                href={`#${term.id}`}
                className="rounded-sm text-muted underline decoration-border-strong underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                {term.term}
              </a>
            </span>
          ))}
        </dd>
      ) : null}
    </div>
  );
}
