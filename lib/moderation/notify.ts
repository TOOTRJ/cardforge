import "server-only";

import { getSiteBaseUrl } from "@/lib/site-url";

// Best-effort admin alerts when a new report is filed. Slack via an incoming
// webhook (SLACK_WEBHOOK_URL) and/or email via Resend's REST API
// (RESEND_API_KEY + ADMIN_ALERT_EMAIL) — both over plain fetch, no extra deps.
// Every channel is fire-and-forget: a notification failure never fails the
// report it's announcing.

type ReportAlert = {
  kind: "card" | "comment";
  reason: string;
  details?: string | null;
  /** Card title or comment snippet for context. */
  context?: string | null;
};

export async function notifyAdminsOfReport(alert: ReportAlert): Promise<void> {
  const link = `${getSiteBaseUrl()}/admin/moderation`;
  const parts = [`New ${alert.kind} report — reason: ${alert.reason}`];
  if (alert.context) parts.push(`“${alert.context.slice(0, 140)}”`);
  if (alert.details) parts.push(`note: ${alert.details.slice(0, 200)}`);
  const summary = parts.join(" · ");

  await Promise.allSettled([sendSlack(summary, link), sendEmail(summary, link)]);
}

async function sendSlack(summary: string, link: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: ${summary}\n<${link}|Open the moderation queue>`,
      }),
    });
  } catch {
    // best-effort
  }
}

async function sendEmail(summary: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (!apiKey || !to) return;
  const from =
    process.env.ADMIN_ALERT_FROM?.trim() || "PipGlyph <onboarding@resend.dev>";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        subject: "[PipGlyph] New content report",
        text: `${summary}\n\n${link}`,
      }),
    });
  } catch {
    // best-effort
  }
}
