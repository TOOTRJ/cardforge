// Small, pure display helpers shared by the user and admin messaging UIs.
// The relative-time formatter lives in lib/format/dates (every surface shows
// the same string now); it is re-exported here for the messaging importers.
export { formatRelativeTime } from "@/lib/format/dates";

/** Full timestamp for message bubbles' title/tooltips. */
export function formatFullTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Cap a badge count the way the bell does. */
export function formatBadgeCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}
