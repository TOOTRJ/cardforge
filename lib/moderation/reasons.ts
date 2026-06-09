// Client-safe report reason catalog (shared by the report dialog + the server
// action + the moderation dashboard). Kept out of the "use server" actions file,
// which may only export async functions.

export const REPORT_REASONS = ["nsfw", "ip", "spam", "hateful", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  nsfw: "Adult / explicit content",
  ip: "Copyright / trademark infringement",
  spam: "Spam or misleading",
  hateful: "Hateful or abusive",
  other: "Something else",
};
