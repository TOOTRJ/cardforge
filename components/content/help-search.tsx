"use client";

import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListChecks, MessageSquare, Search } from "lucide-react";
import type { HelpSearchItem } from "@/lib/content/help";
import { typedForMatching } from "@/lib/validation/typed-forms";

// ---------------------------------------------------------------------------
// HelpSearch — the help centre hub's filter box (TODO NV6). A plain client
// filter over the answers and how-tos the server hands it; the page stays
// static and nothing is fetched.
//
//   * a labelled search input in a role="search" landmark; Enter does not
//     submit (there is nowhere to go — the results are right below);
//   * every word typed must appear in a result (title or text), title hits
//     ranked first; typed and printed quotes and dashes match each other
//     (typedForMatching, the My Cards rule), and so do accented letters;
//   * the count is announced POLITELY, once typing settles — never per
//     keystroke — and the list itself is plain links, one tab stop each.
// ---------------------------------------------------------------------------

/** Results shown at once; the count line says how many more matched. */
const MAX_RESULTS = 8;
/** Pause before the live region speaks (a screen reader user is typing). */
const ANNOUNCE_DELAY_MS = 600;
/** Characters of answer text shown around the first hit. */
const SNIPPET_CHARS = 150;

function fold(text: string): string {
  return typedForMatching(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function wordsOf(query: string): string[] {
  return fold(query)
    .split(/[^a-z0-9'/{}+-]+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length > 0);
}

type Ranked = { item: HelpSearchItem; score: number; order: number };

export function HelpSearch({ items }: { items: readonly HelpSearchItem[] }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const words = useMemo(() => wordsOf(deferred), [deferred]);

  const index = useMemo(
    () => items.map((item) => ({ item, title: fold(item.title), text: fold(item.text) })),
    [items],
  );

  const matches = useMemo<HelpSearchItem[]>(() => {
    if (words.length === 0) return [];
    const ranked: Ranked[] = [];
    index.forEach(({ item, title, text }, order) => {
      let score = 0;
      for (const word of words) {
        if (title.includes(word)) score += 3;
        else if (text.includes(word)) score += 1;
        else return;
      }
      // A how-to answers "how do I…" better than any one answer does.
      if (item.kind === "how-to") score += 1;
      ranked.push({ item, score, order });
    });
    return ranked
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((entry) => entry.item);
  }, [index, words]);

  const shown = matches.slice(0, MAX_RESULTS);
  const searching = words.length > 0;
  const summary = searching ? helpSearchSummary(matches.length, shown.length, deferred) : "";

  // The live region speaks the summary once the typing pauses.
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(summary), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [summary]);

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        aria-label="Help centre"
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          Search the help centre
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “bleed”, “import” or “credits”"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-card border border-border bg-surface pl-10 pr-4 text-base text-foreground shadow-sm placeholder:text-subtle transition-colors hover:border-border-strong focus-visible:border-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/40"
          />
        </div>
      </form>

      {/* The count twice: at once for the eye, and once the typing settles
          for a screen reader (the polite live region). */}
      {searching ? (
        <p aria-hidden className="text-sm text-muted">
          {summary}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>

      {searching ? (
        shown.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border/50 overflow-hidden rounded-card border border-border/70 bg-surface/60">
            {shown.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <Link
                  href={item.href}
                  className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-bright/60"
                >
                  {item.kind === "how-to" ? (
                    <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
                  ) : (
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-foreground group-hover:text-primary-bright">
                      <Highlighted text={item.title} words={words} />
                    </span>
                    <span className="text-xs leading-5 text-muted">
                      <Highlighted text={snippetOf(item.text, words)} words={words} />
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">
                      {item.kind === "how-to" ? "How-to" : "Answer"}
                      <span aria-hidden> · </span>
                      <span className="sr-only">, in </span>
                      {item.sectionTitle}
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary-bright"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-card border border-dashed border-border/70 px-4 py-5 text-sm leading-6 text-muted">
            Try a shorter word or a different one — or browse the topics below.
          </p>
        )
      ) : null}
    </div>
  );
}

/** The count line ("9 results for “bleed”."). The query is quoted once: a
 *  query typed WHOLE in quotes of its own, straight or curly, loses them
 *  first (never ““bleed””); quotes inside it, or at one end only, stay. */
export function helpSearchSummary(total: number, shown: number, query: string): string {
  const typed = query.trim();
  const inner = /^["'“”‘’]+([\s\S]*?)["'“”‘’]+$/.exec(typed)?.[1].trim();
  const quoted = `“${inner || typed}”`;
  if (total === 0) return `Nothing matches ${quoted}.`;
  const noun = total === 1 ? "result" : "results";
  if (total > shown) return `${total} ${noun} for ${quoted} — showing the best ${shown}.`;
  return `${total} ${noun} for ${quoted}.`;
}

/** A window of `text` around its first hit, cut on word boundaries. */
function snippetOf(text: string, words: readonly string[]): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const folded = fold(text);
  const hits = words.map((word) => folded.indexOf(word)).filter((at) => at >= 0);
  const first = hits.length > 0 ? Math.min(...hits) : 0;
  let start = Math.max(0, first - Math.floor(SNIPPET_CHARS / 3));
  let end = Math.min(text.length, start + SNIPPET_CHARS);
  start = Math.max(0, end - SNIPPET_CHARS);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space > -1 && space < first) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** `text` with every hit of `words` marked. The fold keeps one character per
 *  character for everything the help text holds, so indexes line up. */
function Highlighted({ text, words }: { text: string; words: readonly string[] }) {
  const folded = fold(text);
  if (folded.length !== text.length || words.length === 0) return <>{text}</>;
  const marks: boolean[] = new Array(text.length).fill(false);
  for (const word of words) {
    let at = folded.indexOf(word);
    while (at > -1) {
      for (let i = at; i < at + word.length; i += 1) marks[i] = true;
      at = folded.indexOf(word, at + word.length);
    }
  }
  const parts: Array<{ text: string; mark: boolean }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = parts[parts.length - 1];
    if (last && last.mark === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], mark: marks[i] });
  }
  return (
    <>
      {parts.map((part, i) =>
        part.mark ? (
          <mark key={i} className="rounded-[3px] bg-gold/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
