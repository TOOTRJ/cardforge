"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { TOOL_EVENT_RE, isToolSlug, toolBySlug } from "./catalog";
import { checkToolAccess } from "./queries";
import { recordToolEvent } from "./events";

// ---------------------------------------------------------------------------
// The viewer's own beta-tool actions: "Notify me" on a tool they can't open
// yet, and a tool's client-side events. Admin actions live in
// admin-actions.ts.
// ---------------------------------------------------------------------------

export type ToolActionResult = { ok: true } | { ok: false; error: string };

/** "Notify me" on / off for a tool the viewer can't open yet. */
export async function setToolInterestAction(
  slug: string,
  interested: boolean,
): Promise<ToolActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in to hear about new tools." };
  if (!isToolSlug(slug)) return { ok: false, error: "That tool doesn't exist." };
  if (!isAdminConfigured()) return { ok: false, error: "This isn't available right now." };

  const admin = createAdminClient();
  const { error } = interested
    ? await admin
        .from("tool_interest")
        .upsert({ tool_slug: slug, user_id: profile.id }, { onConflict: "tool_slug,user_id", ignoreDuplicates: true })
    : await admin.from("tool_interest").delete().eq("tool_slug", slug).eq("user_id", profile.id);
  if (error) {
    console.error(`[tools] interest ${slug} not saved:`, error.message);
    return { ok: false, error: "That didn't save. Try again in a moment." };
  }
  revalidatePath("/dashboard/tools");
  revalidatePath(`/admin/tools/${slug}`);
  return { ok: true };
}

/**
 * A tool's event from the browser (a click that never reaches a server
 * action of its own: a copy, an export opened). Recorded only for a viewer
 * the access rule lets in, with the path that let them in.
 */
export async function trackToolEventAction(
  slug: string,
  event: string,
  props?: Record<string, unknown>,
): Promise<void> {
  if (!toolBySlug(slug) || !TOOL_EVENT_RE.test(event)) return;
  const access = await checkToolAccess(slug);
  if (!access) return;
  await recordToolEvent({ slug, userId: access.userId, event, access: access.via, props });
}
