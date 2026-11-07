import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { PlanTier } from "@/lib/billing/plans";
import { TOOL_CATALOG, toolBySlug, type ToolDefinition } from "./catalog";
import { recordToolEvent } from "./events";
import {
  resolveToolAccess,
  toolStageOf,
  type ToolAccessPath,
  type ToolGrant,
  type ToolRelease,
  type ToolStage,
} from "./access";

// ---------------------------------------------------------------------------
// What the signed-in viewer may do with each beta tool — the hub, a tool's
// page and a tool's server actions read it through here (one request-cached
// read of the release rows, the viewer's grants and interest).
// ---------------------------------------------------------------------------

export type ViewerTool = {
  tool: ToolDefinition;
  stage: ToolStage;
  release: ToolRelease | null;
  allowed: boolean;
  via: ToolAccessPath | null;
  /** The viewer's live tester grant, if any. */
  grant: ToolGrant | null;
  /** The viewer asked to hear about it ("Notify me"). */
  interested: boolean;
  /** Released to a plan in the last 30 days (the hub's "New" badge). */
  isNew: boolean;
};

const NEW_FOR_MS = 30 * 86_400_000;

type ReleaseRow = {
  slug: string;
  release_tier: PlanTier | null;
  paused: boolean;
  released_at: string | null;
};

function releaseOf(row: ReleaseRow | undefined): ToolRelease | null {
  if (!row) return null;
  return { releaseTier: row.release_tier, paused: row.paused, releasedAt: row.released_at };
}

export const getViewerTools = cache(async (): Promise<ViewerTool[]> => {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const slugs = TOOL_CATALOG.map((tool) => tool.slug);

  const [entitlements, releases, grants, interest] = await Promise.all([
    getEntitlements(),
    supabase
      .from("tool_releases")
      .select("slug, release_tier, paused, released_at")
      .in("slug", slugs),
    profile
      ? supabase
          .from("tool_access_grants")
          .select("tool_slug, granted_at, expires_at")
          .eq("user_id", profile.id)
      : Promise.resolve({ data: [], error: null }),
    profile
      ? supabase.from("tool_interest").select("tool_slug").eq("user_id", profile.id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // A failed read closes tools (fail closed) and is logged; it never opens one.
  for (const [label, result] of [
    ["releases", releases],
    ["grants", grants],
    ["interest", interest],
  ] as const) {
    if (result.error) console.error(`[tools] ${label} read failed:`, result.error.message);
  }

  const releaseBySlug = new Map(
    ((releases.data ?? []) as ReleaseRow[]).map((row) => [row.slug, row]),
  );
  const grantBySlug = new Map(
    (grants.data ?? []).map((row) => [
      row.tool_slug as string,
      { grantedAt: row.granted_at as string, expiresAt: (row.expires_at as string | null) ?? null },
    ]),
  );
  const interested = new Set((interest.data ?? []).map((row) => row.tool_slug as string));
  const isAdmin = Boolean(profile?.is_admin);
  const now = Date.now();

  return TOOL_CATALOG.map((tool) => {
    const release = releaseOf(releaseBySlug.get(tool.slug));
    const grant = grantBySlug.get(tool.slug) ?? null;
    const access = profile
      ? resolveToolAccess({
          isAdmin,
          effectiveTier: entitlements.effectiveTier,
          release: releases.error ? { releaseTier: null, paused: true, releasedAt: null } : release,
          grant: grants.error ? null : grant,
        })
      : { allowed: false, via: null };
    return {
      tool,
      stage: toolStageOf(release),
      release,
      // An unbuilt tool opens for nobody — not even an admin.
      allowed: tool.built && access.allowed,
      via: tool.built ? access.via : null,
      grant,
      interested: interested.has(tool.slug),
      isNew:
        release?.releaseTier != null &&
        release.releasedAt != null &&
        now - new Date(release.releasedAt).getTime() < NEW_FOR_MS,
    };
  });
});

export async function getViewerTool(slug: string): Promise<ViewerTool | null> {
  const tools = await getViewerTools();
  return tools.find((entry) => entry.tool.slug === slug) ?? null;
}

/**
 * The first line of every tool page and tool server action: a signed-out
 * visitor goes to sign-in, anyone the rule doesn't let in gets a 404 (the
 * route doesn't say it exists). Returns the viewer's access for the page.
 */
export async function requireToolAccess(slug: string): Promise<ViewerTool & { userId: string }> {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?redirectTo=${encodeURIComponent(`/dashboard/tools/${slug}`)}`);
  if (!toolBySlug(slug)) notFound();
  const entry = await getViewerTool(slug);
  if (!entry?.allowed) notFound();
  return { ...entry, userId: profile.id };
}

/** A tool's server action's check: the viewer's access, or null when the
 *  rule doesn't let them in (the action answers with an error, never a
 *  404 throw). */
export async function checkToolAccess(slug: string): Promise<(ViewerTool & { userId: string }) | null> {
  const profile = await getCurrentProfile();
  if (!profile || !toolBySlug(slug)) return null;
  const entry = await getViewerTool(slug);
  return entry?.allowed ? { ...entry, userId: profile.id } : null;
}

/**
 * A tool PAGE's first line: `requireToolAccess` plus the `open` event the
 * admin analytics count (written after the response, never in its way).
 */
export async function openTool(slug: string): Promise<ViewerTool & { userId: string }> {
  const entry = await requireToolAccess(slug);
  after(() =>
    recordToolEvent({ slug, userId: entry.userId, event: "open", access: entry.via }),
  );
  return entry;
}
