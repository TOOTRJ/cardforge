// ---------------------------------------------------------------------------
// Site updates — shared (client-safe) types and pure helpers for the /news
// page, the homepage banner, the acknowledgement splash and the admin page.
// ---------------------------------------------------------------------------

export type SiteUpdateKind = "update" | "upcoming";
export type BannerScope = "home" | "site";

export type SiteUpdate = {
  id: string;
  kind: SiteUpdateKind;
  title: string;
  summary: string;
  body: string | null;
  link_href: string | null;
  publish_at: string;
  is_published: boolean;
  show_in_banner: boolean;
  /** Where the ribbon shows this update: the homepage only, or every page. */
  banner_scope: BannerScope;
  require_ack: boolean;
  ack_until: string | null;
  /** Broadcast bookkeeping: when it was last pushed as a notification to
   *  every user, and how many received it in total. */
  notified_at: string | null;
  notified_count: number;
  /** Newsletter bookkeeping: when it was last emailed to newsletter
   *  subscribers, and how many were sent it in total. */
  emailed_at: string | null;
  emailed_count: number;
  created_at: string;
  updated_at: string;
};

export type SiteUpdateStatus = "draft" | "scheduled" | "live";

/** Draft (unpublished), scheduled (published but release time ahead), or live. */
export function siteUpdateStatus(
  update: Pick<SiteUpdate, "is_published" | "publish_at">,
  now: Date = new Date(),
): SiteUpdateStatus {
  if (!update.is_published) return "draft";
  return new Date(update.publish_at) > now ? "scheduled" : "live";
}

/** Released = visible to the public right now. */
export function isReleased(
  update: Pick<SiteUpdate, "is_published" | "publish_at">,
  now: Date = new Date(),
): boolean {
  return siteUpdateStatus(update, now) === "live";
}

/** Still asking for acknowledgement: released, flagged, and not past ack_until. */
export function needsAck(
  update: Pick<SiteUpdate, "is_published" | "publish_at" | "require_ack" | "ack_until">,
  now: Date = new Date(),
): boolean {
  if (!update.require_ack || !isReleased(update, now)) return false;
  return !update.ack_until || new Date(update.ack_until) > now;
}

/** Kind label + eyebrow copy for the public surfaces. */
export const KIND_COPY: Record<SiteUpdateKind, { label: string; eyebrow: string }> = {
  update: { label: "New", eyebrow: "Just shipped" },
  upcoming: { label: "Coming soon", eyebrow: "On the forge" },
};

/** `datetime-local` input value for a timestamp, expressed in UTC (the admin
 *  form labels its pickers UTC and the actions parse them as UTC, so a saved
 *  time round-trips exactly regardless of the admin's timezone). */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatReleaseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
