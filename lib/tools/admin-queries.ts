import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanTier } from "@/lib/billing/plans";
import type { Json } from "@/types/supabase";
import { TOOL_CATALOG, TOOL_USE_EVENTS, toolBySlug, type ToolDefinition } from "./catalog";
import { grantIsLive, toolStageOf, type ToolRelease, type ToolStage } from "./access";

// ---------------------------------------------------------------------------
// /admin/tools' reads (migration 0182) — service role; the page checks
// is_admin before calling. A failed read returns null so the page says so
// instead of drawing "0 testers".
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

export type AdminToolRow = {
  tool: ToolDefinition;
  release: ToolRelease | null;
  stage: ToolStage;
  testers: number;
  interested: number;
  users7d: number;
  users30d: number;
  opens30d: number;
  uses30d: number;
  lastEventAt: string | null;
};

type ReleaseRow = {
  slug: string;
  release_tier: PlanTier | null;
  paused: boolean;
  released_at: string | null;
  updated_at?: string;
};

function releaseOf(row: ReleaseRow | undefined): ToolRelease | null {
  return row ? { releaseTier: row.release_tier, paused: row.paused, releasedAt: row.released_at } : null;
}

/** What counts as a USE, per tool — the readers' `p_uses` (migration 0199):
 *  the app's list, never one restated in SQL. */
const USES = TOOL_USE_EVENTS as unknown as Json;

/** A database 0199 has not reached yet (the app can deploy first) has the
 *  readers without `p_uses`: asked the old way there — its "uses" are
 *  everything but `open` until the migration lands. */
const lacksUsesParam = (error: { code?: string } | null) => error?.code === "PGRST202";

async function readToolSummary(admin: AdminClient) {
  const read = await admin.rpc("admin_tool_summary", { p_uses: USES });
  return lacksUsesParam(read.error) ? admin.rpc("admin_tool_summary") : read;
}

async function readToolDetail(admin: AdminClient, slug: string, days: number) {
  const read = await admin.rpc("admin_tool_detail", { p_slug: slug, p_days: days, p_uses: USES });
  return lacksUsesParam(read.error) ? admin.rpc("admin_tool_detail", { p_slug: slug, p_days: days }) : read;
}

export async function getAdminToolsOverview(admin: AdminClient): Promise<AdminToolRow[] | null> {
  const [summary, releases] = await Promise.all([
    readToolSummary(admin),
    admin.from("tool_releases").select("slug, release_tier, paused, released_at"),
  ]);
  if (summary.error || releases.error) {
    console.error(
      "[admin/tools] overview read failed:",
      summary.error?.message ?? releases.error?.message,
    );
    return null;
  }
  const bySlug = new Map((summary.data ?? []).map((row) => [row.tool_slug, row]));
  const releaseBySlug = new Map(((releases.data ?? []) as ReleaseRow[]).map((row) => [row.slug, row]));
  return TOOL_CATALOG.map((tool) => {
    const row = bySlug.get(tool.slug);
    const release = releaseOf(releaseBySlug.get(tool.slug));
    return {
      tool,
      release,
      stage: toolStageOf(release),
      testers: Number(row?.testers ?? 0),
      interested: Number(row?.interested ?? 0),
      users7d: Number(row?.users_7d ?? 0),
      users30d: Number(row?.users_30d ?? 0),
      opens30d: Number(row?.opens_30d ?? 0),
      uses30d: Number(row?.uses_30d ?? 0),
      lastEventAt: row?.last_event_at ?? null,
    };
  });
}

export type ToolPerson = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type ToolTester = ToolPerson & {
  grantedAt: string;
  expiresAt: string | null;
  live: boolean;
  note: string | null;
  grantedBy: string | null;
};

export type ToolInterested = ToolPerson & { createdAt: string; hasAccess: boolean };

export type ToolDailyPoint = { day: string; opens: number; uses: number; users: number };

export type ToolDetail = {
  tool: ToolDefinition;
  release: ToolRelease | null;
  releaseUpdatedAt: string | null;
  stage: ToolStage;
  days: number;
  totals: { opens: number; uses: number; users: number; usingUsers: number; returningUsers: number };
  daily: ToolDailyPoint[];
  events: { event: string; count: number; users: number }[];
  access: { access: string; users: number; uses: number }[];
  topUsers: (ToolPerson & {
    opens: number;
    uses: number;
    activeDays: number;
    lastAt: string;
    access: string | null;
  })[];
  testers: ToolTester[];
  interested: ToolInterested[];
};

type DetailJson = {
  days: number;
  totals: { opens: number; uses: number; users: number; using_users: number; returning_users: number };
  daily: ToolDailyPoint[];
  events: { event: string; count: number; users: number }[];
  access: { access: string; users: number; uses: number }[];
  top_users: {
    user_id: string;
    opens: number;
    uses: number;
    active_days: number;
    last_at: string;
    access: string | null;
  }[];
};

export const TOOL_DETAIL_RANGES = [7, 30, 90] as const;
export type ToolDetailRange = (typeof TOOL_DETAIL_RANGES)[number];

export function toolDetailRangeOf(value: unknown): ToolDetailRange {
  const n = Number(value);
  return (TOOL_DETAIL_RANGES as readonly number[]).includes(n) ? (n as ToolDetailRange) : 30;
}

export async function getAdminToolDetail(
  admin: AdminClient,
  slug: string,
  days: ToolDetailRange,
): Promise<ToolDetail | null> {
  const tool = toolBySlug(slug);
  if (!tool) return null;
  const [detail, release, grants, interest] = await Promise.all([
    readToolDetail(admin, slug, days),
    admin
      .from("tool_releases")
      .select("slug, release_tier, paused, released_at, updated_at")
      .eq("slug", slug)
      .maybeSingle(),
    admin
      .from("tool_access_grants")
      .select("user_id, granted_at, expires_at, note, granted_by")
      .eq("tool_slug", slug)
      .order("granted_at", { ascending: false })
      .limit(500),
    admin
      .from("tool_interest")
      .select("user_id, created_at")
      .eq("tool_slug", slug)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const failed = detail.error ?? release.error ?? grants.error ?? interest.error;
  if (failed) {
    console.error(`[admin/tools] ${slug} detail read failed:`, failed.message);
    return null;
  }
  const json = (detail.data ?? {}) as unknown as DetailJson;
  const grantRows = grants.data ?? [];
  const interestRows = interest.data ?? [];

  const ids = new Set<string>();
  for (const row of grantRows) {
    ids.add(row.user_id);
    if (row.granted_by) ids.add(row.granted_by);
  }
  for (const row of interestRows) ids.add(row.user_id);
  for (const row of json.top_users ?? []) ids.add(row.user_id);
  const people = await readPeople(admin, [...ids]);
  const person = (id: string): ToolPerson =>
    people.get(id) ?? { id, username: null, displayName: null, avatarUrl: null };

  const testers: ToolTester[] = grantRows.map((row) => ({
    ...person(row.user_id),
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    live: grantIsLive({ grantedAt: row.granted_at, expiresAt: row.expires_at }),
    note: row.note,
    grantedBy: row.granted_by ? (people.get(row.granted_by)?.username ?? null) : null,
  }));
  const liveTesters = new Set(testers.filter((t) => t.live).map((t) => t.id));
  const releaseRow = (release.data ?? undefined) as ReleaseRow | undefined;
  const rel = releaseOf(releaseRow);

  return {
    tool,
    release: rel,
    releaseUpdatedAt: releaseRow?.updated_at ?? null,
    stage: toolStageOf(rel),
    days: json.days ?? days,
    totals: {
      opens: Number(json.totals?.opens ?? 0),
      uses: Number(json.totals?.uses ?? 0),
      users: Number(json.totals?.users ?? 0),
      usingUsers: Number(json.totals?.using_users ?? 0),
      returningUsers: Number(json.totals?.returning_users ?? 0),
    },
    daily: (json.daily ?? []).map((d) => ({
      day: d.day,
      opens: Number(d.opens),
      uses: Number(d.uses),
      users: Number(d.users),
    })),
    events: (json.events ?? []).map((e) => ({ event: e.event, count: Number(e.count), users: Number(e.users) })),
    access: (json.access ?? []).map((a) => ({ access: a.access, users: Number(a.users), uses: Number(a.uses) })),
    topUsers: (json.top_users ?? []).map((u) => ({
      ...person(u.user_id),
      opens: Number(u.opens),
      uses: Number(u.uses),
      activeDays: Number(u.active_days),
      lastAt: u.last_at,
      access: u.access,
    })),
    testers,
    interested: interestRows.map((row) => ({
      ...person(row.user_id),
      createdAt: row.created_at,
      hasAccess: liveTesters.has(row.user_id),
    })),
  };
}

async function readPeople(admin: AdminClient, ids: string[]): Promise<Map<string, ToolPerson>> {
  const out = new Map<string, ToolPerson>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", chunk);
    if (error) {
      console.warn("[admin/tools] profile read failed:", error.message);
      continue;
    }
    for (const row of data ?? []) {
      out.set(row.id, {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      });
    }
  }
  return out;
}
