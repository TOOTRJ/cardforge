import "server-only";

// ---------------------------------------------------------------------------
// Outbound email through Resend's REST API — plain fetch, no SDK (the same
// pattern lib/moderation/notify.ts has always used). Auth emails do NOT come
// through here: Supabase sends those over SMTP (docs/EMAIL.md).
//
// Env:
//   RESEND_API_KEY          required for any send
//   EMAIL_FROM              verified sender, e.g. "PipGlyph <hello@pipglyph.com>"
//                           (falls back to the older ADMIN_ALERT_FROM)
//   EMAIL_FROM_NEWSLETTER   optional separate sender for the newsletter — a
//                           subdomain (news.pipglyph.com) keeps marketing
//                           reputation away from transactional mail
//   EMAIL_REPLY_TO          optional
//
// There is deliberately NO fallback to Resend's onboarding@resend.dev sender:
// it only delivers to the account owner, so a user-facing send would vanish.
// Nothing here throws — email is always best-effort beside the real write.
// ---------------------------------------------------------------------------

export type EmailStream = "transactional" | "newsletter";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

const RESEND_API = "https://api.resend.com";
/** Resend's batch endpoint takes at most 100 emails per call. */
export const EMAIL_BATCH_SIZE = 100;

export function emailFrom(stream: EmailStream = "transactional"): string | null {
  const base =
    process.env.EMAIL_FROM?.trim() || process.env.ADMIN_ALERT_FROM?.trim() || null;
  if (stream === "newsletter") {
    return process.env.EMAIL_FROM_NEWSLETTER?.trim() || base;
  }
  return base;
}

export function isEmailConfigured(stream: EmailStream = "transactional"): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim()) && Boolean(emailFrom(stream));
}

function toResendPayload(email: OutgoingEmail, from: string) {
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  return {
    from,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(email.headers ? { headers: email.headers } : {}),
  };
}

export type SendResult = { ok: true } | { ok: false; error: string };

/** One email. `idempotencyKey` makes a retried request a no-op for 24h. */
export async function sendEmail(
  email: OutgoingEmail,
  options: { stream?: EmailStream; idempotencyKey?: string } = {},
): Promise<SendResult> {
  const stream = options.stream ?? "transactional";
  const from = emailFrom(stream);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !from) return { ok: false, error: "Email isn't configured." };
  try {
    const response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(toResendPayload(email, from)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(`[email] Resend rejected "${email.subject}" (${response.status}).`);
      return { ok: false, error: `Provider error ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    console.warn("[email] send failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't reach the email provider." };
  }
}

/** Many emails, 100 per request. Returns the recipients that were accepted
 *  so callers can record exactly who was sent what. */
export async function sendEmailBatch(
  emails: OutgoingEmail[],
  options: { stream?: EmailStream; idempotencyPrefix?: string } = {},
): Promise<{ accepted: string[]; failed: number; error?: string }> {
  const stream = options.stream ?? "transactional";
  const from = emailFrom(stream);
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || !from) {
    return { accepted: [], failed: emails.length, error: "Email isn't configured." };
  }

  const accepted: string[] = [];
  let failed = 0;
  let lastError: string | undefined;
  for (let start = 0; start < emails.length; start += EMAIL_BATCH_SIZE) {
    const chunk = emails.slice(start, start + EMAIL_BATCH_SIZE);
    try {
      const response = await fetch(`${RESEND_API}/emails/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(options.idempotencyPrefix
            ? { "Idempotency-Key": `${options.idempotencyPrefix}:${start}` }
            : {}),
        },
        body: JSON.stringify(chunk.map((email) => toResendPayload(email, from))),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        failed += chunk.length;
        lastError = `Provider error ${response.status}.`;
        console.warn(`[email] Resend rejected a batch of ${chunk.length} (${response.status}).`);
        // A rate limit or outage won't clear within this request — stop and
        // let the caller resume later instead of burning the remaining chunks.
        if (response.status === 429 || response.status >= 500) {
          failed += emails.length - (start + chunk.length);
          break;
        }
        continue;
      }
      accepted.push(...chunk.map((email) => email.to));
    } catch (error) {
      failed += chunk.length;
      lastError = "Couldn't reach the email provider.";
      console.warn("[email] batch failed:", error instanceof Error ? error.message : error);
    }
  }
  return { accepted, failed, ...(lastError ? { error: lastError } : {}) };
}
