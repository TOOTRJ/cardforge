"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";
import { effectiveTierForProfile } from "@/lib/billing/entitlements";
import { isBillingEnabled } from "@/lib/billing/flags";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";
import { isToolSlug, toolBySlug, type ToolDefinition } from "./catalog";

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

/** The people of a tool's "Notify me" list read at once. A list longer
 *  than this is told in the first release's worth; the rest stay listed. */
const RELEASE_NOTIFY_MAX = 5000;

/**
 * "We'll tell you when it opens" — kept. Everyone on the tool's waiting
 * list whom this release lets in gets ONE `tool_access` notification
 * (`released: true`) and leaves the list; someone whose plan the release
 * does not reach stays on it and is told when a wider one does. Admins and
 * live testers are not told (they are in already) but leave the list too.
 * Best effort: a failure here never undoes the release. Answers how many
 * were told.
 */
async function notifyWaitingList(ctx: AdminContext, tool: ToolDefinition, tier: PlanTier): Promise<number> {
  const waiting = await selectAllRows<{ user_id: string }>(
    (from, to) =>
      ctx.admin
        .from("tool_interest")
        .select("user_id")
        .eq("tool_slug", tool.slug)
        .order("created_at", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, to),
    { maxRows: RELEASE_NOTIFY_MAX },
  );
  const ids = waiting.data.map((row) => row.user_id).slice(0, RELEASE_NOTIFY_MAX);
  if (ids.length === 0) return 0;

  const [{ data: grants }, profiles] = await Promise.all([
    ctx.admin.from("tool_access_grants").select("user_id, expires_at").eq("tool_slug", tool.slug),
    Promise.all(
      chunkIds(ids).map((chunk) =>
        ctx.admin
          .from("profiles")
          .select("id, is_admin, subscription_tier, subscription_status, comp_tier, comp_expires_at, payment_failed_at")
          .in("id", chunk),
      ),
    ),
  ]);
  const now = new Date();
  const testers = new Set(
    (grants ?? []).filter((row) => row.expires_at == null || new Date(row.expires_at) > now).map((row) => row.user_id),
  );
  const billing = isBillingEnabled();
  const reached: string[] = [];
  const inAlready: string[] = [];
  for (const { data } of profiles) {
    for (const profile of data ?? []) {
      if (profile.is_admin || testers.has(profile.id)) inAlready.push(profile.id);
      // With billing off everyone has the Pro perks (getEntitlements).
      else if (!billing || TIER_RANK[effectiveTierForProfile(profile, now)] >= TIER_RANK[tier]) reached.push(profile.id);
    }
  }
  if (reached.length > 0) {
    const { error } = await ctx.admin.from("notifications").insert(
      reached.map((recipientId) => ({
        recipient_id: recipientId,
        actor_id: ctx.adminId,
        type: "tool_access",
        payload: { tool: tool.slug, toolName: tool.name, built: tool.built, released: true },
      })),
    );
    if (error) {
      console.warn(`[admin/tools] release notify ${tool.slug} failed:`, error.message);
      return 0;
    }
  }
  // Told (or in already): off the list, so a later change tells nobody twice.
  for (const chunk of chunkIds([...reached, ...inAlready])) {
    const { error } = await ctx.admin.from("tool_interest").delete().eq("tool_slug", tool.slug).in("user_id", chunk);
    if (error) console.warn(`[admin/tools] waiting list ${tool.slug} not trimmed:`, error.message);
  }
  return reached.length;
}

/** Release a tool to a plan and up, or take it back to beta (null). Answers
 *  how many people on its waiting list were told it opened for them. */
export async function setToolReleaseAction(
  slug: string,
  tier: PlanTier | null,
): Promise<AdminToolResult<{ notified: number }>> {
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
    .select("release_tier, released_at, paused")
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
  // The release reaches people it did not before (out of beta, or down to a
  // lower plan) and the tool is open: the waiting list hears of it.
  const before = (current?.release_tier ?? null) as PlanTier | null;
  const widened = tier !== null && (before === null || TIER_RANK[tier] < TIER_RANK[before]);
  let notified = 0;
  if (widened && !current?.paused) {
    try {
      notified = await notifyWaitingList(ctx, tool, tier);
    } catch (notifyError) {
      console.warn(`[admin/tools] release notify ${slug} failed:`, notifyError instanceof Error ? notifyError.message : notifyError);
    }
  }
  revalidateTool(slug);
  return { ok: true, data: { notified } };
}

/** The kill switch: a paused tool opens for admins only. Taking it OFF a
 *  released tool opens it to people again — its waiting list hears of it
 *  (a tool released while paused told nobody; this is when it reaches them).
 *  Answers how many were told. */
export async function setToolPausedAction(
  slug: string,
  paused: boolean,
): Promise<AdminToolResult<{ notified: number }>> {
  const ctx = await adminContext();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const tool = toolBySlug(slug);
  if (!tool) return { ok: false, error: "That tool doesn't exist." };
  const { data: row, error } = await ctx.admin
    .from("tool_releases")
    .upsert({ slug, paused, updated_at: new Date().toISOString(), updated_by: ctx.adminId }, { onConflict: "slug" })
    .select("release_tier")
    .maybeSingle();
  if (error) {
    console.error(`[admin/tools] pause ${slug} failed:`, error.message);
    return { ok: false, error: "That didn't save." };
  }
  let notified = 0;
  const tier = (row?.release_tier ?? null) as PlanTier | null;
  if (!paused && tier !== null && RELEASE_TIERS.has(tier)) {
    try {
      notified = await notifyWaitingList(ctx, tool, tier);
    } catch (notifyError) {
      console.warn(`[admin/tools] unpause notify ${slug} failed:`, notifyError instanceof Error ? notifyError.message : notifyError);
    }
  }
  revalidateTool(slug);
  return { ok: true, data: { notified } };
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
  // The WHOLE list first, live testers out, THEN the batch of 200: cutting
  // to 200 before the filter granted nobody once the first 200 were in.
  const [interest, { data: grants }] = await Promise.all([
    selectAllRows<{ user_id: string }>((from, to) =>
      ctx.admin
        .from("tool_interest")
        .select("user_id")
        .eq("tool_slug", input.slug)
        .order("created_at", { ascending: true })
        .order("user_id", { ascending: true })
        .range(from, to),
    ),
    ctx.admin.from("tool_access_grants").select("user_id, expires_at").eq("tool_slug", input.slug),
  ]);
  if (interest.error) return { ok: false, error: "Couldn't read the interest list." };
  const live = new Set(
    (grants ?? [])
      .filter((row) => row.expires_at == null || new Date(row.expires_at) > new Date())
      .map((row) => row.user_id),
  );
  const userIds = interest.data.map((row) => row.user_id).filter((id) => !live.has(id));
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
