import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { verifySvixSignature } from "@/lib/email/webhook-signature";

// ---------------------------------------------------------------------------
// Resend → PipGlyph delivery feedback. A hard bounce or a spam complaint
// suppresses ALL non-auth email to that address (suppress_email(), migration
// 0095); a complaint also withdraws newsletter consent. Continuing to mail
// dead or complaining addresses is what gets a sending domain throttled
// (Resend enforces <4% bounce, <0.08% complaint).
//
// Resend signs with Svix: headers svix-id / svix-timestamp / svix-signature
// ("v1,<base64>" — possibly several, space-separated), HMAC-SHA256 over
// `${id}.${timestamp}.${rawBody}` with the base64 secret after "whsec_".
// Verified in lib/email/webhook-signature.ts — no SDK dependency. Set
// RESEND_WEBHOOK_SECRET and subscribe the endpoint to email.bounced +
// email.complained.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendEvent = {
  type?: string;
  data?: { to?: string[] | string; bounce?: { type?: string } };
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret || !isAdminConfigured()) {
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const verified = verifySvixSignature({
    rawBody,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    secret,
  });
  if (!verified) {
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad payload." }, { status: 400 });
  }

  const reason =
    event.type === "email.complained"
      ? "complained"
      : event.type === "email.bounced" &&
          // Transient bounces (full mailbox, greylisting) retry on their own.
          (event.data?.bounce?.type ?? "Permanent") === "Permanent"
        ? "bounced"
        : null;
  if (!reason) return NextResponse.json({ ok: true, ignored: true });

  const recipients = Array.isArray(event.data?.to)
    ? event.data.to
    : event.data?.to
      ? [event.data.to]
      : [];
  const admin = createAdminClient();
  for (const address of recipients) {
    const { error } = await admin.rpc("suppress_email", {
      p_email: address,
      p_reason: reason,
    });
    if (error) console.warn("[resend webhook] suppress_email failed:", error.message);
  }
  return NextResponse.json({ ok: true, suppressed: recipients.length });
}
