import {
  FEEDBACK_STATUSES,
  isFeedbackArea,
  type FeedbackArea,
  type FeedbackStatus,
} from "@/lib/feedback/schemas";

// ---------------------------------------------------------------------------
// The admin feedback inbox's two filter rows — status and area (migration
// 0146, TODO DK10.1) — read from and written to its URL. Pure, so the page
// and its tests share one answer. Each row's links keep the other row's
// choice; the defaults (unresolved, every area) are the bare address.
// ---------------------------------------------------------------------------

/** Which submissions the admin inbox shows: one status, everything, or the
 *  default "unresolved" (new + reviewed — anything still needing a look). */
export type FeedbackInboxFilter = FeedbackStatus | "unresolved" | "all";

export function parseFeedbackInboxParams(params: {
  status?: string;
  area?: string;
}): { filter: FeedbackInboxFilter; area: FeedbackArea | null } {
  const { status, area } = params;
  const filter: FeedbackInboxFilter =
    status === "all"
      ? "all"
      : (FEEDBACK_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as FeedbackStatus)
        : "unresolved";
  return { filter, area: isFeedbackArea(area) ? area : null };
}

export function feedbackInboxHref(
  filter: FeedbackInboxFilter,
  area: FeedbackArea | null,
): string {
  const params = new URLSearchParams();
  if (filter !== "unresolved") params.set("status", filter);
  if (area) params.set("area", area);
  const query = params.toString();
  return query ? `/admin/feedback?${query}` : "/admin/feedback";
}
