import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { getSiteBaseUrl } from "@/lib/site-url";
import { TEAM_DISPLAY_NAME } from "@/lib/messages/schemas";

// Best-effort email to the USER when the team posts in their thread. Reuses
// the Resend REST pattern the moderation alerts use (lib/moderation/notify.ts);
// needs RESEND_API_KEY (+ a verified ADMIN_ALERT_FROM sender). Silent no-op
// without the key — the in-app bell + Messages badge are the primary channel.
// Never throws: a delivery problem must not fail the message it announces.

export async function emailUserAboutMessage(
  admin: ReturnType<typeof createAdminClient>,
  input: { userId: string; threadId: string; subject: string; body: string },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return;
  const from =
    process.env.ADMIN_ALERT_FROM?.trim() || "PipGlyph <onboarding@resend.dev>";
  try {
    const { data } = await admin.auth.admin.getUserById(input.userId);
    const to = data?.user?.email;
    if (!to) return;
    const link = `${getSiteBaseUrl()}/messages/${input.threadId}`;
    const preview = input.body.length > 600 ? `${input.body.slice(0, 600)}…` : input.body;
    await fetch("https://api.resend.com/emails", {
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
  } catch {
    // best-effort
  }
}
