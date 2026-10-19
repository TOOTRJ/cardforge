import "server-only";

import type { CreditGrantClient } from "@/lib/billing/credit-refill";

// ---------------------------------------------------------------------------
// Loud subscription credit-grant failures (2026-10-18). A failed grant used
// to be a count in the refill cron's 200 response and a warning in the
// invoice.paid handler — a `grant_credits` that stayed broken would have
// cost every subscriber every month it lasted with nobody told. Now each
// failure notifies every admin through ONE `credit_refill_failed` row per
// admin per DEDUPE KEY (migration 0140's unique index):
//   * the cron: `cron:<YYYY-MM-DD>` (UTC) — one alert per admin per run day
//     while failures persist, whatever the failure count or the reruns;
//   * invoice.paid: `invoice:<invoice id>` — one alert per invoice however
//     often Stripe redelivers it.
// Nothing here grants, retries or changes a grant: it only reports. It never
// throws — an alert that fails is logged and the caller carries on.
// ---------------------------------------------------------------------------

export const CREDIT_REFILL_FAILED = "credit_refill_failed";

/** How many failed user ids the cron's alert names (the log has them all). */
export const ALERT_USER_IDS_MAX = 20;
/** An error message in a payload is cut to this many characters. */
export const ALERT_ERROR_MAX = 300;

export type CronRefillFailurePayload = {
  source: "cron";
  dedupeKey: string;
  period: string;
  /** The UTC run day, YYYY-MM-DD. */
  day: string;
  /** null when a page read aborted the sweep (the counts so far are lost). */
  processed: number | null;
  granted: number | null;
  failed: number;
  /** The profiles page read that aborted the sweep, if one did. */
  pageError: string | null;
  /** The first ALERT_USER_IDS_MAX failed user ids. */
  userIds: string[];
  /** The first failed grant's error. */
  error: string | null;
};

export type InvoiceGrantFailurePayload = {
  source: "invoice";
  dedupeKey: string;
  invoiceId: string;
  userId: string;
  error: string;
};

export type CreditRefillFailedPayload = CronRefillFailurePayload | InvoiceGrantFailurePayload;

export function cutError(message: string): string {
  return message.length > ALERT_ERROR_MAX ? `${message.slice(0, ALERT_ERROR_MAX - 1)}…` : message;
}

export function cronAlertDedupeKey(now: Date): string {
  return `cron:${now.toISOString().slice(0, 10)}`;
}

export function invoiceAlertDedupeKey(invoiceId: string): string {
  return `invoice:${invoiceId}`;
}

/**
 * Notify every admin once per `payload.dedupeKey`. Returns how many rows it
 * inserted (0 when every admin already has this key's alert, or there is no
 * admin, or a step failed — each logged).
 */
export async function notifyAdminsCreditRefillFailed(
  admin: CreditGrantClient,
  payload: CreditRefillFailedPayload,
): Promise<number> {
  try {
    const { data: admins, error: adminError } = await admin
      .from("profiles")
      .select("id")
      .eq("is_admin", true);
    if (adminError) {
      console.error("[credit-alerts] admin lookup failed:", adminError.message);
      return 0;
    }
    const adminIds = ((admins ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (adminIds.length === 0) return 0;

    const { data: existing, error: existingError } = await admin
      .from("notifications")
      .select("recipient_id")
      .eq("type", CREDIT_REFILL_FAILED)
      .eq("payload->>dedupeKey", payload.dedupeKey);
    if (existingError) {
      // The unique index still refuses a duplicate: insert for everyone.
      console.error("[credit-alerts] dedupe read failed:", existingError.message);
    }
    const alerted = new Set(
      ((existing ?? []) as Array<{ recipient_id: string }>).map((row) => row.recipient_id),
    );
    const recipients = adminIds.filter((id) => !alerted.has(id));
    if (recipients.length === 0) return 0;

    const { error: insertError } = await admin.from("notifications").insert(
      recipients.map((recipientId) => ({
        recipient_id: recipientId,
        actor_id: null,
        type: CREDIT_REFILL_FAILED,
        payload,
      })),
    );
    if (insertError) {
      // 23505: a concurrent run alerted first (0140's unique index).
      if ((insertError as { code?: string }).code === "23505") return 0;
      console.error("[credit-alerts] admin alert failed:", insertError.message);
      return 0;
    }
    return recipients.length;
  } catch (error) {
    console.error(
      "[credit-alerts] admin alert failed:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}
