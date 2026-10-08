// ---------------------------------------------------------------------------
// Date display helpers — client-safe, dependency-free. One home for the
// relative-time and short-date strings the messaging UI, notifications,
// comments, the card page and the guides show, so they never drift again
// (they used to carry eight hand-written copies).
// ---------------------------------------------------------------------------

/** "just now", "5m ago", "3h ago", "2d ago", then "Aug 1" — with the year
 *  once it isn't this year. A value that isn't a date comes back untouched. */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  }).format(date);
}

/** The ONE home of the date shapes the app prints: "September 14, 2026"
 *  and "Sep 14, 2026". Every formatter below — and the `<LocalDate>`
 *  component, which prints the same shape in the viewer's own time zone —
 *  reads these, so a date never changes FORMAT between server and browser. */
export const DATE_FORMATS = {
  long: { month: "long", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric", year: "numeric" },
  /** A log row's moment, "Nov 7, 6:31 PM" — the usage page's ledger. */
  stamp: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateFormat = keyof typeof DATE_FORMATS;

/**
 * An instant as a date in ONE time zone. `timeZone: undefined` is the
 * runtime's own zone — the viewer's, in a browser; whatever the host runs in
 * on a server, so server code names a zone ("UTC"). A value that isn't a
 * date comes back untouched (Intl throws on an invalid Date).
 */
export function formatDateIn(
  value: string,
  format: DateFormat,
  timeZone: string | undefined,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { ...DATE_FORMATS[format], timeZone }).format(date);
}

/** "Sep 14, 2026". `fallback` (default: the input itself) when the value
 *  isn't a date — Intl throws on an invalid Date, so this never does. */
export function formatShortDate(value: string, fallback: string = value): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", DATE_FORMATS.short).format(date);
}

/** A calendar date ("2026-09-14", i.e. UTC midnight) as "September 14, 2026".
 *  Formatted in UTC so it never shifts a day back in negative-offset
 *  timezones — article frontmatter dates go through here. NOT for an instant
 *  a signed-in viewer reads as a day of THEIR calendar (a billing date):
 *  that is `<LocalDate>` (components/ui/local-date.tsx). */
export function formatCalendarDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { ...DATE_FORMATS.long, timeZone: "UTC" }).format(
    new Date(iso),
  );
}

/** A date for a page that cannot know its reader's zone and says so:
 *  "Oct 23, 2026 UTC" — the admin tools. */
export function formatUtcDate(value: string, format: DateFormat = "short"): string {
  const date = formatDateIn(value, format, "UTC");
  return date === value ? value : `${date} UTC`;
}

/** The time of day in UTC, labelled: "2:31 AM UTC" — beside a UTC date in a
 *  message whose reader's zone is unknown (an email), so the day it names
 *  cannot be mistaken for the reader's own. */
export function formatUtcTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const text = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${text} UTC`;
}

/** The same with the time of day: "Oct 23, 2026, 2:31 AM UTC". */
export function formatUtcDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const text = new Intl.DateTimeFormat("en-US", {
    ...DATE_FORMATS.short,
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
  return `${text} UTC`;
}

// ---------------------------------------------------------------------------
// A sentence with dates in it, kept as parts so ONE piece of copy serves both
// readers: a server-built string (UTC — an email, a test, an admin row) and
// the page, where `<LocalDateText>` prints each date in the viewer's zone.
// ---------------------------------------------------------------------------

export type DateTextPart = string | { date: string; format?: DateFormat };
export type DateText = readonly DateTextPart[];

/** The parts as one string, every date in `timeZone` — named by the caller
 *  every time ("UTC" on a server; `undefined` = the runtime's own zone), so
 *  it is never a default: a default parameter would turn the browser's
 *  `undefined` back into UTC. */
export function dateTextToString(parts: DateText, timeZone: string | undefined): string {
  return parts
    .map((part) =>
      typeof part === "string" ? part : formatDateIn(part.date, part.format ?? "long", timeZone),
    )
    .join("");
}
