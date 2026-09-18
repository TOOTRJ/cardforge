import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { teamMessageEmail } from "@/lib/email/messages";
import { getRecipientFor } from "@/lib/email/preferences";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";

// Best-effort email to the USER when the team posts in their thread — the one
// notification kind mailed immediately rather than in the daily digest (a
// person is waiting on the other end). Sent only when email is configured
// (lib/email/send.ts — there is no fallback sender) AND the user has
// "Account & team messages" on, is not suppressed and has a confirmed address
// (email_recipients(), migration 0095). Otherwise the in-app bell + Messages
// badge are the only channel — and /admin/messages says so. Never throws: a
// delivery problem must not fail the message.

export function isUserEmailConfigured(): boolean {
  return isEmailConfigured();
}

export async function emailUserAboutMessage(
  admin: ReturnType<typeof createAdminClient>,
  input: { userId: string; threadId: string; subject: string; body: string },
): Promise<void> {
  if (!isEmailConfigured()) return;
  try {
    const recipient = await getRecipientFor(admin, input.userId, "account");
    if (!recipient) return;
    await sendEmail(teamMessageEmail(recipient, input));
  } catch {
    // best-effort
  }
}
