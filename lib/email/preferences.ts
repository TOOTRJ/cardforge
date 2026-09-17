import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { EMAIL_LIST_COPY, type EmailList } from "@/lib/email/lists";

// ---------------------------------------------------------------------------
// Reads/writes of email_preferences (migration 0095). The signed-in user's own
// row goes through their RLS session; the token-keyed unsubscribe (no session —
// the link is opened from an inbox) uses the service role and touches exactly
// one boolean on the row the token names.
// ---------------------------------------------------------------------------

export type EmailPreferences = Record<EmailList, boolean> & {
  /** Set when a hard bounce / complaint stopped all non-auth email. */
  suppressed: boolean;
};

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  account: EMAIL_LIST_COPY.account.defaultOn,
  activity: EMAIL_LIST_COPY.activity.defaultOn,
  newsletter: EMAIL_LIST_COPY.newsletter.defaultOn,
  suppressed: false,
};

export async function getMyEmailPreferences(): Promise<EmailPreferences> {
  const user = await getCurrentUser();
  if (!user) return DEFAULT_EMAIL_PREFERENCES;
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_preferences")
    .select("account_emails, activity_emails, newsletter, suppressed_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return DEFAULT_EMAIL_PREFERENCES;
  return {
    account: data.account_emails,
    activity: data.activity_emails,
    newsletter: data.newsletter,
    suppressed: Boolean(data.suppressed_at),
  };
}

/** One user's delivery row for a list, or null when they must not be emailed
 *  (opted out, suppressed, unconfirmed address). Service role. */
export async function getRecipientFor(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  list: EmailList,
): Promise<{ email: string; unsubscribeToken: string } | null> {
  const { data, error } = await admin.rpc("email_recipients", {
    p_list: list,
    p_user_ids: [userId],
  });
  if (error || !data?.[0]) return null;
  return { email: data[0].email, unsubscribeToken: data[0].unsubscribe_token };
}

export type UnsubscribeResult = { ok: true; list: EmailList } | { ok: false };

export async function unsubscribeByToken(
  token: string,
  list: EmailList,
): Promise<UnsubscribeResult> {
  if (!isAdminConfigured()) return { ok: false };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_preferences")
    .update(
      list === "account"
        ? { account_emails: false }
        : list === "activity"
          ? { activity_emails: false }
          : { newsletter: false },
    )
    .eq("unsubscribe_token", token)
    .select("user_id");
  if (error || !data || data.length === 0) return { ok: false };
  return { ok: true, list };
}
