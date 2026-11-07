"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import type { PlanTier } from "@/lib/billing/plans";
import { isToolSlug, toolBySlug } from "./catalog";

// ---------------------------------------------------------------------------
// /admin/tools' writes (migration 0182). Every action re-checks is_admin on
// the server (the page's 404 is not a guard) and writes through the service
// role — no API role writes these tables.
// ---------------------------------------------------------------------------

export type AdminToolResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

type AdminContext = { adminId: string; admin: ReturnType<typeof createAdminClient> };

async function adminContext(): Promise<AdminContext | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { error: "Admins only." };
  if (!isAdminConfigured()) return { error: "The service role isn't configured here." };
  return { adminId: profile.id, admin: createAdminClient() };
}

function revalidateTool(slug: string) {
  revalidatePath("/admin/tools");
  revalidatePath(`/admin/tools/${slug}`);
  revalidatePath("/dashboard/tools");
}

const RELEASE_TIERS = new Set<PlanTier>(["free", "plus", "pro"]);

/** Release a tool to a plan and up, or take it back to beta (null). */
export async function setToolReleaseAction(
  slug: string,
  tier: PlanTier | null,
): Promise<AdminToolResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const tool = toolBySlug(slug);
  if (!tool) return { ok: false, error: "That tool doesn't exist." };
  if (tier !== null && !RELEASE_TIERS.has(tier)) return { ok: false, error: "Pick Free, Plus or Pro." };
  if (tier !== null && !tool.built) {
    return { ok: false, error: `${tool.name} isn't built yet, so it can't be released.` };
  }

  const { data: current } = await ctx.admin
    .from("tool_releases")
    .select("release_tier, released_at")
    .eq("slug", slug)
    .maybeSingle();
  const now = new Date().toISOString();
  const { error } = await ctx.admin.from("tool_releases").upsert(
    {
      slug,
      release_tier: tier,
      // First release keeps its date; back to beta clears it.
      released_at: tier === null ? null : (current?.released_at ?? now),
      updated_at: now,
      updated_by: ctx.adminId,
    },
    { onConflict: "slug" },
  );
  if (error) {
    console.error(`[admin/tools] release ${slug} failed:`, error.message);
    return { ok: false, error: "The release didn't save." };
  }
  revalidateTool(slug);
  return { ok: true };
}

/** The kill switch: a paused tool opens for admins only. */
export async function setToolPausedAction(slug: string, paused: boolean): Promise<AdminToolResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isToolSlug(slug)) return { ok: false, error: "That tool doesn't exist." };
  const { error } = await ctx.admin.from("tool_releases").upsert(
    { slug, paused, updated_at: new Date().toISOString(), updated_by: ctx.adminId },
    { onConflict: "slug" },
  );
  if (error) {
    console.error(`[admin/tools] pause ${slug} failed:`, error.message);
    return { ok: false, error: "That didn't save." };
  }
  revalidateTool(slug);
  return { ok: true };
}

export type ToolUserMatch = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  tier: string;
  isAdmin: boolean;
};

/** The tester picker's search: username, display name or email. */
export async function searchToolUsersAction(query: string): Promise<AdminToolResult<ToolUserMatch[]>> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const q = query.trim().replace(/^@/, "").slice(0, 120);
  if (q.length < 2) return { ok: true, data: [] };
  const { data, error } = await ctx.admin.rpc("admin_list_users", {
    p_q: q,
    p_sort: "newest",
    p_limit: 8,
    p_offset: 0,
  });
  if (error) {
    console.error("[admin/tools] user search failed:", error.message);
    return { ok: false, error: "Search failed." };
  }
  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      email: row.email,
      tier: row.subscription_tier,
      isAdmin: row.is_admin,
    })),
  };
}

const MAX_GRANT_DAYS = 365;

/** Let users into a tool's beta (re-granting updates the end date / note). */
export async function grantToolAccessAction(input: {
  slug: string;
  userIds: string[];
  /** Days until it ends; null = until revoked. */
  expiresInDays: number | null;
  note?: string | null;
}): Promise<AdminToolResult<{ granted: number }>> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const tool = toolBySlug(input.slug);
  if (!tool) return { ok: false, error: "That tool doesn't exist." };
  const userIds = [...new Set(input.userIds)].filter(isUuid).slice(0, 200);
  if (userIds.length === 0) return { ok: false, error: "Pick at least one user." };
  if (
    input.expiresInDays !== null &&
    (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > MAX_GRANT_DAYS)
  ) {
    return { ok: false, error: `Pick an end between 1 and ${MAX_GRANT_DAYS} days, or no end.` };
  }
  const note = input.note?.trim().slice(0, 200) || null;
  const expiresAt =
    input.expiresInDays === null
      ? null
      : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();

  // Who already holds a live grant: they are updated, not notified again.
  const { data: existing } = await ctx.admin
    .from("tool_access_grants")
    .select("user_id, expires_at")
    .eq("tool_slug", tool.slug)
    .in("user_id", userIds);
  const live = new Set(
    (existing ?? [])
      .filter((row) => row.expires_at == null || new Date(row.expires_at) > new Date())
      .map((row) => row.user_id),
  );

  const { error } = await ctx.admin.from("tool_access_grants").upsert(
    userIds.map((userId) => ({
      tool_slug: tool.slug,
      user_id: userId,
      granted_by: ctx.adminId,
      granted_at: new Date().toISOString(),
      expires_at: expiresAt,
      note,
    })),
    { onConflict: "tool_slug,user_id" },
  );
  if (error) {
    console.error(`[admin/tools] grant ${tool.slug} failed:`, error.message);
    return { ok: false, error: "The access didn't save." };
  }

  const fresh = userIds.filter((id) => !live.has(id) && id !== ctx.adminId);
  if (fresh.length > 0) {
    const { error: notifyError } = await ctx.admin.from("notifications").insert(
      fresh.map((recipientId) => ({
        recipient_id: recipientId,
        actor_id: ctx.adminId,
        type: "tool_access",
        payload: { tool: tool.slug, toolName: tool.name, built: tool.built, expiresAt },
      })),
    );
    if (notifyError) console.warn("[admin/tools] tool_access notify failed:", notifyError.message);
  }
  revalidateTool(tool.slug);
  return { ok: true, data: { granted: userIds.length } };
}

/** Everyone who asked to hear about it gets in (skips live testers). */
export async function grantInterestedAction(input: {
  slug: string;
  expiresInDays: number | null;
}): Promise<AdminToolResult<{ granted: number }>> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isToolSlug(input.slug)) return { ok: false, error: "That tool doesn't exist." };
  const [{ data: interest, error }, { data: grants }] = await Promise.all([
    ctx.admin.from("tool_interest").select("user_id").eq("tool_slug", input.slug).order("created_at", { ascending: true }).limit(200),
    ctx.admin.from("tool_access_grants").select("user_id, expires_at").eq("tool_slug", input.slug),
  ]);
  if (error) return { ok: false, error: "Couldn't read the interest list." };
  const live = new Set(
    (grants ?? [])
      .filter((row) => row.expires_at == null || new Date(row.expires_at) > new Date())
      .map((row) => row.user_id),
  );
  const userIds = (interest ?? []).map((row) => row.user_id).filter((id) => !live.has(id));
  if (userIds.length === 0) return { ok: true, data: { granted: 0 } };
  return grantToolAccessAction({
    slug: input.slug,
    userIds,
    expiresInDays: input.expiresInDays,
    note: "From the interest list",
  });
}

export async function revokeToolAccessAction(slug: string, userId: string): Promise<AdminToolResult> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isToolSlug(slug) || !isUuid(userId)) return { ok: false, error: "That grant doesn't exist." };
  const { error } = await ctx.admin
    .from("tool_access_grants")
    .delete()
    .eq("tool_slug", slug)
    .eq("user_id", userId);
  if (error) {
    console.error(`[admin/tools] revoke ${slug} failed:`, error.message);
    return { ok: false, error: "The access wasn't removed." };
  }
  revalidateTool(slug);
  return { ok: true };
}
