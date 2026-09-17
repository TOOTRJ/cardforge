import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { describeNotification } from "@/lib/notifications/describe";
import {
  NOTIFICATION_SELECT_COLUMNS,
  hydrate,
  type NotificationRow,
} from "@/lib/notifications/queries";
import { activityDigestEmail, type DigestLine } from "@/lib/email/messages";
import { isEmailConfigured, sendEmailBatch, type OutgoingEmail } from "@/lib/email/send";

// ---------------------------------------------------------------------------
// The daily activity digest. Notifications are push-first (Realtime toast +
// bell); this is the catch-up for people who weren't on the site: ONE email a
// day, only when something is still UNREAD, never a mail per like.
//
// Window per user: notifications created after their last digest (capped at
// LOOKBACK so a long-idle account isn't sent a month of history) that are
// still unread at send time. `last_digest_at` then moves to "now", so nothing
// is mailed twice. Idempotent within a day: a second run finds no new rows.
//
// Not in the digest:
//   message      — emailed immediately (lib/messages/notify.ts)
//   site_update  — product news is the NEWSLETTER's list; mailing it to
//                  everyone here would sidestep that opt-in
// ---------------------------------------------------------------------------

const EXCLUDED_TYPES = ["message", "site_update"];
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const RECIPIENT_PAGE = 200;

export type DigestRunResult = {
  configured: boolean;
  recipients: number;
  sent: number;
  failed: number;
};

export async function sendActivityDigests(
  admin: ReturnType<typeof createAdminClient>,
): Promise<DigestRunResult> {
  if (!isEmailConfigured()) {
    return { configured: false, recipients: 0, sent: 0, failed: 0 };
  }

  const { data: recipients, error } = await admin.rpc("email_recipients", {
    p_list: "activity",
  });
  if (error) throw new Error(`email_recipients failed: ${error.message}`);

  const now = Date.now();
  const floor = new Date(now - LOOKBACK_MS).toISOString();
  const runKey = new Date(now).toISOString().slice(0, 10);
  let sent = 0;
  let failed = 0;
  let withActivity = 0;

  for (let start = 0; start < (recipients?.length ?? 0); start += RECIPIENT_PAGE) {
    const page = recipients!.slice(start, start + RECIPIENT_PAGE);
    const byUser = new Map(page.map((r) => [r.user_id, r]));

    const { data: rows, error: rowsError } = await admin
      .from("notifications")
      .select(`recipient_id, ${NOTIFICATION_SELECT_COLUMNS}`)
      .in("recipient_id", [...byUser.keys()])
      .is("read_at", null)
      .gte("created_at", floor)
      .not("type", "in", `(${EXCLUDED_TYPES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (rowsError) throw new Error(`notifications read failed: ${rowsError.message}`);

    type Row = NotificationRow & { recipient_id: string };
    const fresh = ((rows ?? []) as unknown as Row[]).filter((row) => {
      const watermark = byUser.get(row.recipient_id)?.last_digest_at;
      return !watermark || row.created_at > watermark;
    });
    if (fresh.length === 0) continue;

    const items = await hydrate(admin, fresh);
    const recipientOf = new Map(fresh.map((row) => [row.id, row.recipient_id]));
    const linesByUser = new Map<string, DigestLine[]>();
    for (const item of items) {
      const userId = recipientOf.get(item.id);
      if (!userId) continue;
      const line = describeNotification(item, { isAdmin: false });
      const list = linesByUser.get(userId) ?? [];
      list.push(line);
      linesByUser.set(userId, list);
    }

    const emails: OutgoingEmail[] = [];
    const userByAddress = new Map<string, string>();
    for (const [userId, lines] of linesByUser) {
      const recipient = byUser.get(userId);
      if (!recipient) continue;
      userByAddress.set(recipient.email, userId);
      emails.push(
        activityDigestEmail(
          { email: recipient.email, unsubscribeToken: recipient.unsubscribe_token },
          { lines, total: lines.length },
        ),
      );
    }
    withActivity += emails.length;

    const result = await sendEmailBatch(emails, {
      idempotencyPrefix: `digest:${runKey}:${start}`,
    });
    sent += result.accepted.length;
    failed += result.failed;

    const delivered = result.accepted
      .map((address) => userByAddress.get(address))
      .filter((id): id is string => Boolean(id));
    if (delivered.length > 0) {
      await admin
        .from("email_preferences")
        .update({ last_digest_at: new Date(now).toISOString() })
        .in("user_id", delivered);
    }
  }

  return { configured: true, recipients: withActivity, sent, failed };
}
