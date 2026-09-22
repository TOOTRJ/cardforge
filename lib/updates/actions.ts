"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { isUuid } from "@/lib/ids";
import { z } from "zod";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { SITE_UPDATES_TAG } from "@/lib/updates/queries";
import { isReleased } from "@/lib/updates/shared";
import { newsletterEmail } from "@/lib/email/messages";
import { isEmailConfigured, sendEmailBatch } from "@/lib/email/send";

// ---------------------------------------------------------------------------
// Site updates — admin writes (RLS admin policies on site_updates enforce the
// gate independently of the is_admin check here) and the viewer's
// acknowledgement. Every admin write purges the cached public feed so the
// /news page and the homepage banner change immediately.
// ---------------------------------------------------------------------------

export type UpdateActionResult = { ok: true; id?: string } | { ok: false; error: string };

const HTTPS_OR_RELATIVE = /^(https:\/\/[^\s]+|\/[^\s]*)$/;

const updateInputSchema = z.object({
  kind: z.enum(["update", "upcoming"]),
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(3).max(280),
  body: z.string().trim().max(4000).optional().or(z.literal("")),
  linkHref: z
    .string()
    .trim()
    .max(512)
    .refine((v) => v === "" || HTTPS_OR_RELATIVE.test(v), "Link must be https:// or a site path.")
    .optional()
    .or(z.literal("")),
  publishAt: z.string().trim().optional().or(z.literal("")),
  isPublished: z.coerce.boolean(),
  showInBanner: z.coerce.boolean(),
  bannerScope: z.enum(["home", "site"]).default("home"),
  requireAck: z.coerce.boolean(),
  ackUntil: z.string().trim().optional().or(z.literal("")),
});

function readForm(formData: FormData) {
  const bool = (key: string) => formData.get(key) === "on" || formData.get(key) === "true";
  return updateInputSchema.safeParse({
    kind: formData.get("kind"),
    title: formData.get("title"),
    summary: formData.get("summary"),
    body: formData.get("body") ?? "",
    linkHref: formData.get("linkHref") ?? "",
    publishAt: formData.get("publishAt") ?? "",
    isPublished: bool("isPublished"),
    showInBanner: bool("showInBanner"),
    bannerScope: formData.get("bannerScope") ?? "home",
    requireAck: bool("requireAck"),
    ackUntil: formData.get("ackUntil") ?? "",
  });
}

/** A `datetime-local` value (interpreted in UTC when it carries no zone) → ISO. */
function toIso(value: string | undefined, fallback: string | null): string | null {
  if (!value) return fallback;
  const d = new Date(value.length === 16 ? `${value}:00Z` : value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function purge() {
  revalidateTag(SITE_UPDATES_TAG, "max");
  revalidatePath("/");
  revalidatePath("/news");
  revalidatePath("/admin/updates");
}

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  return { ok: true, userId: profile.id };
}

function rowFromInput(input: z.infer<typeof updateInputSchema>, existingPublishAt: string | null) {
  return {
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    body: input.body ? input.body : null,
    link_href: input.linkHref ? input.linkHref : null,
    publish_at: toIso(input.publishAt, existingPublishAt) ?? new Date().toISOString(),
    is_published: input.isPublished,
    show_in_banner: input.showInBanner,
    banner_scope: input.bannerScope,
    require_ack: input.requireAck,
    ack_until: toIso(input.ackUntil, null),
  };
}

export async function createSiteUpdateAction(formData: FormData): Promise<UpdateActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_updates")
    .insert({ ...rowFromInput(parsed.data, null), created_by: gate.userId })
    .select("id")
    .single();
  if (error) {
    console.warn("createSiteUpdateAction:", error.message);
    return { ok: false, error: "Couldn't save the update." };
  }
  purge();
  return { ok: true, id: data.id as string };
}

export async function updateSiteUpdateAction(id: string, formData: FormData): Promise<UpdateActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown update." };
  const parsed = readForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("site_updates")
    .select("publish_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Unknown update." };
  const { error } = await supabase
    .from("site_updates")
    .update({ ...rowFromInput(parsed.data, existing.publish_at as string), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.warn("updateSiteUpdateAction:", error.message);
    return { ok: false, error: "Couldn't save the update." };
  }
  purge();
  return { ok: true, id };
}

/** Quick toggles from the list (publish / banner / ack). */
export async function setSiteUpdateFlagAction(
  id: string,
  flag: "is_published" | "show_in_banner" | "require_ack",
  value: boolean,
): Promise<UpdateActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown update." };
  const supabase = await createClient();
  const patch: { is_published?: boolean; show_in_banner?: boolean; require_ack?: boolean; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  patch[flag] = value;
  const { error } = await supabase.from("site_updates").update(patch).eq("id", id);
  if (error) {
    console.warn("setSiteUpdateFlagAction:", error.message);
    return { ok: false, error: "Couldn't update the flag." };
  }
  purge();
  return { ok: true, id };
}

export async function deleteSiteUpdateAction(id: string): Promise<UpdateActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown update." };
  const supabase = await createClient();
  const { error } = await supabase.from("site_updates").delete().eq("id", id);
  if (error) {
    console.warn("deleteSiteUpdateAction:", error.message);
    return { ok: false, error: "Couldn't delete the update." };
  }
  purge();
  return { ok: true };
}

/** Viewer: record that they have read the splash for these updates. RLS
 *  only lets a user insert rows for themselves; released-ness is enforced
 *  by the select policy on site_updates (a hidden id simply isn't there). */
export async function acknowledgeUpdatesAction(ids: string[]): Promise<UpdateActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const valid = ids.filter((id) => isUuid(id)).slice(0, 20);
  if (valid.length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("site_update_acks")
    .upsert(
      valid.map((update_id) => ({ update_id, user_id: user.id })),
      { onConflict: "update_id,user_id", ignoreDuplicates: true },
    );
  if (error) {
    console.warn("acknowledgeUpdatesAction:", error.message);
    return { ok: false, error: "Couldn't record that." };
  }
  return { ok: true };
}

const BROADCAST_PAGE = 1000;
const BROADCAST_INSERT_CHUNK = 500;

export type BroadcastResult =
  | { ok: true; sent: number; skipped: number }
  | { ok: false; error: string };

/**
 * Admin: push a released update to EVERY user as a `site_update` notification
 * (bell badge, /notifications page, realtime toast for anyone online).
 * Service-role insert in chunks; users who already hold a notification for
 * this update are skipped, so re-sending only reaches people who signed up
 * since. Admins are skipped too (they wrote it).
 */
export async function notifyAllUsersAction(id: string): Promise<BroadcastResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown update." };
  if (!isAdminConfigured()) return { ok: false, error: "Admin client isn't configured." };
  const supabase = await createClient();
  const { data: update } = await supabase
    .from("site_updates")
    .select("id, kind, title, summary, link_href, is_published, publish_at, notified_count")
    .eq("id", id)
    .maybeSingle();
  if (!update) return { ok: false, error: "Unknown update." };
  if (!isReleased(update)) {
    return { ok: false, error: "Publish it first — only a live update can be sent to users." };
  }

  const admin = createAdminClient();
  // Everyone who already has this notification (from an earlier send).
  const already = new Set<string>();
  for (let from = 0; ; from += BROADCAST_PAGE) {
    const { data, error } = await admin
      .from("notifications")
      .select("recipient_id")
      .eq("type", "site_update")
      .filter("payload->>updateId", "eq", id)
      .range(from, from + BROADCAST_PAGE - 1);
    if (error) return { ok: false, error: "Couldn't read earlier sends." };
    for (const row of data ?? []) already.add(row.recipient_id as string);
    if ((data?.length ?? 0) < BROADCAST_PAGE) break;
  }

  const payload = {
    updateId: update.id,
    kind: update.kind,
    title: update.title,
    summary: update.summary,
    link: update.link_href,
  };
  let sent = 0;
  let skipped = 0;
  let pending: { recipient_id: string; actor_id: string; type: "site_update"; payload: typeof payload }[] = [];
  const flush = async () => {
    if (pending.length === 0) return true;
    const { error } = await admin.from("notifications").insert(pending);
    if (error) {
      console.warn("notifyAllUsersAction: insert error", error.message);
      return false;
    }
    sent += pending.length;
    pending = [];
    return true;
  };
  for (let from = 0; ; from += BROADCAST_PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, is_admin")
      .order("id", { ascending: true })
      .range(from, from + BROADCAST_PAGE - 1);
    if (error) return { ok: false, error: "Couldn't list users." };
    for (const profile of data ?? []) {
      if (profile.is_admin || already.has(profile.id)) {
        skipped += 1;
        continue;
      }
      pending.push({ recipient_id: profile.id, actor_id: gate.userId, type: "site_update", payload });
      if (pending.length >= BROADCAST_INSERT_CHUNK && !(await flush())) {
        return { ok: false, error: `Stopped after ${sent} notifications — try again to resume.` };
      }
    }
    if ((data?.length ?? 0) < BROADCAST_PAGE) break;
  }
  if (!(await flush())) {
    return { ok: false, error: `Stopped after ${sent} notifications — try again to resume.` };
  }
  await admin
    .from("site_updates")
    .update({
      notified_at: new Date().toISOString(),
      notified_count: (update.notified_count ?? 0) + sent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  purge();
  return { ok: true, sent, skipped };
}

export type NewsletterResult =
  | { ok: true; sent: number; skipped: number; failed: number }
  | { ok: false; error: string };

/** Admin: email a LIVE update to everyone subscribed to the newsletter
 *  (email_preferences.newsletter — explicit opt-in, confirmed address, not
 *  suppressed). newsletter_deliveries records each accepted send, so pressing
 *  it again only reaches people who subscribed since; a provider failure
 *  mid-way is resumable the same way. Every email carries the RFC 8058
 *  one-click unsubscribe headers (lib/email/messages.ts). */
export async function emailNewsletterAction(id: string): Promise<NewsletterResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  if (!isUuid(id)) return { ok: false, error: "Unknown update." };
  if (!isAdminConfigured()) return { ok: false, error: "Admin client isn't configured." };
  if (!isEmailConfigured("newsletter")) {
    return {
      ok: false,
      error: "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM (docs/EMAIL.md).",
    };
  }

  const supabase = await createClient();
  const { data: update } = await supabase
    .from("site_updates")
    .select("id, kind, title, summary, body, link_href, is_published, publish_at, emailed_count")
    .eq("id", id)
    .maybeSingle();
  if (!update) return { ok: false, error: "Unknown update." };
  if (!isReleased(update)) {
    return { ok: false, error: "Publish it first — only a live update can be emailed." };
  }

  const admin = createAdminClient();
  const already = new Set<string>();
  for (let from = 0; ; from += BROADCAST_PAGE) {
    const { data, error } = await admin
      .from("newsletter_deliveries")
      .select("user_id")
      .eq("update_id", id)
      .range(from, from + BROADCAST_PAGE - 1);
    if (error) return { ok: false, error: "Couldn't read earlier sends." };
    for (const row of data ?? []) already.add(row.user_id);
    if ((data?.length ?? 0) < BROADCAST_PAGE) break;
  }

  const { data: subscribers, error: subscribersError } = await admin.rpc("email_recipients", {
    p_list: "newsletter",
  });
  if (subscribersError) return { ok: false, error: "Couldn't list subscribers." };

  const pending = (subscribers ?? []).filter((s) => !already.has(s.user_id));
  const skipped = (subscribers?.length ?? 0) - pending.length;
  if (pending.length === 0) return { ok: true, sent: 0, skipped, failed: 0 };

  const content = {
    kind: update.kind as "update" | "upcoming",
    title: update.title,
    summary: update.summary,
    body: update.body,
    linkHref: update.link_href,
  };
  const userByAddress = new Map(pending.map((s) => [s.email, s.user_id]));
  const result = await sendEmailBatch(
    pending.map((s) =>
      newsletterEmail({ email: s.email, unsubscribeToken: s.unsubscribe_token }, content),
    ),
    { stream: "newsletter", idempotencyPrefix: `newsletter:${id}:${already.size}` },
  );

  const delivered = result.accepted
    .map((address) => userByAddress.get(address))
    .filter((userId): userId is string => Boolean(userId));
  if (delivered.length > 0) {
    const { error } = await admin
      .from("newsletter_deliveries")
      .upsert(
        delivered.map((userId) => ({ update_id: id, user_id: userId })),
        { onConflict: "update_id,user_id", ignoreDuplicates: true },
      );
    if (error) console.warn("emailNewsletterAction: delivery log failed", error.message);
    await admin
      .from("site_updates")
      .update({
        emailed_at: new Date().toISOString(),
        emailed_count: (update.emailed_count ?? 0) + delivered.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
  }
  purge();
  if (delivered.length === 0 && result.error) return { ok: false, error: result.error };
  return { ok: true, sent: delivered.length, skipped, failed: result.failed };
}

/** Admin: the global ribbon switch. Off hides the ribbon on every page
 *  without touching any update's own banner flag. */
export async function setBannerEnabledAction(enabled: boolean): Promise<UpdateActionResult> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  const supabase = await createClient();
  const { error } = await supabase.from("site_settings").upsert(
    {
      key: "updates_banner",
      value: { enabled: Boolean(enabled) },
      updated_at: new Date().toISOString(),
      updated_by: gate.userId,
    },
    { onConflict: "key" },
  );
  if (error) {
    console.warn("setBannerEnabledAction:", error.message);
    return { ok: false, error: "Couldn't change the ribbon setting." };
  }
  purge();
  return { ok: true };
}
