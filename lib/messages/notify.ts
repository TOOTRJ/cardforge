import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { getSiteBaseUrl } from "@/lib/site-url";
import { TEAM_DISPLAY_NAME } from "@/lib/messages/schemas";

// Best-effort email to the USER when the team posts in their thread. Reuses
// the Resend REST pattern the moderation alerts use (lib/moderation/notify.ts)
// but, unlike the admin alerts, there is NO fallback sender: Resend's
// onboarding@resend.dev address only delivers to the account owner, so a
// user-facing email is sent only when BOTH RESEND_API_KEY and a verified
// ADMIN_ALERT_FROM are configured (isUserEmailConfigured). Otherwise the
// in-app bell + Messages badge are the only channel — and /admin/messages
// says so. Never throws: a delivery problem must not fail the message.

export function isUserEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) &&
    Boolean(process.env.ADMIN_ALERT_FROM?.trim());
}

export async function emailUserAboutMessage(
  admin: ReturnType<typeof createAdminClient>,
  input: { userId: string; threadId: string; subject: string; body: string },
): Promise<void> {
  if (!isUserEmailConfigured()) return;
  const apiKey = process.env.RESEND_API_KEY!.trim();
  const from = process.env.ADMIN_ALERT_FROM!.trim();
  try {
    const { data } = await admin.auth.admin.getUserById(input.userId);
    const to = data?.user?.email;
    if (!to) return;
    const link = `${getSiteBaseUrl()}/messages/${input.threadId}`;
    const preview = input.body.length > 600 ? `${input.body.slice(0, 600)}…` : input.body;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: `[PipGlyph] ${input.subject}`,
        text: `The ${TEAM_DISPLAY_NAME} sent you a message:\n\n${preview}\n\nReply here: ${link}`,
      }),
    });
    if (!response.ok) {
      console.warn(`[messages] Resend rejected the email (${response.status}).`);
    }
  } catch {
    // best-effort
  }
}
