"use client";

import { Fragment, useSyncExternalStore } from "react";
import {
  dateTextToString,
  formatDateIn,
  formatRelativeTime,
  type DateFormat,
  type DateText,
} from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// A date in the VIEWER's own time zone.
//
// The server cannot know that zone, and a billing instant is a different
// calendar day depending on it: a period ending 2026-11-08T02:31Z is
// "November 7" in New York — which is what Stripe's portal shows there —
// and the app, formatting in UTC, said "November 8".
//
// So: the server (and the first client render, which must match it) prints
// the UTC date inside <time dateTime=…>, and once the page has hydrated the
// same shape is printed again in the browser's zone. Same format options
// (lib/format/dates.ts DATE_FORMATS), so at most the day changes — the text
// keeps its place and its form. A component mounted after hydration (a
// dialog, a menu) is local from its first paint.
//
// Use it for an instant the signed-in viewer reads as a day of THEIR
// calendar (every billing date). A calendar date with no time (an article's
// frontmatter date) stays `formatCalendarDate`.
// ---------------------------------------------------------------------------

const subscribe = () => () => {};

/**
 * "UTC" on the server and while hydrating; `undefined` — the browser's own
 * zone, to `Intl` — from then on. For a client component that builds a
 * STRING around a date (an aria-label, a menu row).
 */
export function useViewerTimeZone(): string | undefined {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return hydrated ? undefined : "UTC";
}

export function LocalDate({
  iso,
  format = "long",
  className,
}: {
  /** The instant, ISO 8601. */
  iso: string;
  format?: DateFormat;
  className?: string;
}) {
  const timeZone = useViewerTimeZone();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatDateIn(iso, format, timeZone)}
    </time>
  );
}

/**
 * "3h ago", then "Aug 1" — a relative time in a component that HYDRATES.
 *
 * `formatRelativeTime` reads two things the server and the browser disagree
 * on: the clock, and (for the date it prints from a week on) the time zone.
 * Printed as bare text in a client component, a notification from 02:00 UTC
 * was "Oct 30" in the server's HTML and "Oct 29" in a Mountain-time browser
 * — React's hydration error #418, and the page rendered a second time
 * (2026-11-11). On a cached page (a card's comments) the clock alone did it:
 * "2h ago" in HTML that was a day old.
 *
 * So, like `<LocalDate>`: the server and the hydrating render print the UTC
 * reading, and the element is allowed to differ by the clock
 * (`suppressHydrationWarning` — a minute may pass, a cached page may be
 * hours old). Once hydrated it is a NEW element (the `key`): React never
 * rewrites a text it was told to leave alone, and its own two renders are
 * the same string whenever only the clock differs — so without the key,
 * day-old HTML kept saying "2h ago" for good.
 */
export function RelativeTime({ iso, className, title }: { iso: string; className?: string; title?: string }) {
  const timeZone = useViewerTimeZone();
  return (
    <time
      key={timeZone === undefined ? "viewer" : "hydrating"}
      dateTime={iso}
      className={className}
      title={title}
      suppressHydrationWarning
    >
      {formatRelativeTime(iso, undefined, timeZone)}
    </time>
  );
}

/** A sentence kept as parts (lib/format/dates.ts `DateText`): its strings as
 *  they are, each date a `<LocalDate>`. */
export function LocalDateText({ parts }: { parts: DateText }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <LocalDate key={index} iso={part.date} format={part.format ?? "long"} />
        ),
      )}
    </>
  );
}

/** The same sentence as ONE string in the viewer's zone — for an attribute
 *  or a label that cannot hold elements. */
export function useLocalDateText(parts: DateText): string {
  return dateTextToString(parts, useViewerTimeZone());
}
