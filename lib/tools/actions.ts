"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isToolSlug } from "./catalog";

// ---------------------------------------------------------------------------
// The viewer's own beta-tool action: "Notify me" on a tool they can't open
// yet. Admin actions live in admin-actions.ts; a tool's browser-side events
// go to POST /api/tools/usage (lib/tools/track-client.ts) — a route, never a
// server action: Next runs a page's actions one at a time, and a tracking
// action made the real one behind it wait.
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
