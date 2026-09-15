"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { SITE_UPDATES_TAG } from "@/lib/updates/queries";

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
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Unknown update." };
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
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Unknown update." };
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
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Unknown update." };
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
  const valid = ids.filter((id) => z.string().uuid().safeParse(id).success).slice(0, 20);
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
