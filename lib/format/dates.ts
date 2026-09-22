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

/** "Sep 14, 2026". `fallback` (default: the input itself) when the value
 *  isn't a date — Intl throws on an invalid Date, so this never does. */
export function formatShortDate(value: string, fallback: string = value): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** A calendar date ("2026-09-14", i.e. UTC midnight) as "September 14, 2026".
 *  Formatted in UTC so it never shifts a day back in negative-offset
 *  timezones — article frontmatter dates go through here. */
export function formatCalendarDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}
