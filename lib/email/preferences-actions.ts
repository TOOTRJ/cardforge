"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isUnsubscribeToken, parseEmailList } from "@/lib/email/lists";
import { unsubscribeByToken } from "@/lib/email/preferences";

const preferencesSchema = z.object({
  account: z.boolean(),
  activity: z.boolean(),
  newsletter: z.boolean(),
});

export type EmailPreferencesInput = z.infer<typeof preferencesSchema>;
export type EmailPreferencesResult = { ok: true } | { ok: false; error: string };

/** Save the three switches. The newsletter consent timestamp is stamped by a
 *  DB trigger when the switch turns on — never taken from the client. */
export async function updateEmailPreferencesAction(
  input: EmailPreferencesInput,
): Promise<EmailPreferencesResult> {
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid preferences." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_preferences")
    .update({
      account_emails: parsed.data.account,
      activity_emails: parsed.data.activity,
      newsletter: parsed.data.newsletter,
    })
    .eq("user_id", user.id)
    .select("user_id");
  if (error || !data || data.length === 0) {
    console.warn("updateEmailPreferencesAction:", error?.message ?? "no preferences row");
    return { ok: false, error: "Couldn't save your email preferences. Please try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

export type UnsubscribeState =
  | { status: "idle" }
  | { status: "done"; list: string }
  | { status: "error" };

/** The button on /unsubscribe (the email's visible footer link). */
export async function unsubscribeAction(
  _prev: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const token = formData.get("token");
  const list = parseEmailList(formData.get("list"));
  if (!isUnsubscribeToken(token) || !list) return { status: "error" };
  const result = await unsubscribeByToken(token, list);
  return result.ok ? { status: "done", list } : { status: "error" };
}
