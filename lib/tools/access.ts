// ---------------------------------------------------------------------------
// THE access rule for beta tools (migration 0182) — pure, so the hub, a
// tool's page, its server actions and the tests all read the same answer.
// SQL `public.has_tool_access(slug)` mirrors it for a tool's own tables'
// RLS; change both together.
//
//   1. An admin may always open a tool (beta, paused, released).
//   2. A PAUSED tool is closed to everyone else — testers and plans too.
//   3. A tool RELEASED to a plan opens for that plan and every plan above.
//   4. Otherwise an unexpired tester grant opens it.
//
// A tool with no release row is in beta. `effectiveTier` is the
// entitlements' (getEntitlements): while billing is off it is "pro", so a
// tool released to any plan opens for everyone — a beta tool still does not.
// ---------------------------------------------------------------------------

import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";

export type ToolStage = "beta" | "released" | "paused";
export type ToolAccessPath = "admin" | "grant" | "release";

export type ToolRelease = {
  /** NULL = beta (admins + testers). */
  releaseTier: PlanTier | null;
  paused: boolean;
  releasedAt: string | null;
};

export type ToolGrant = {
  grantedAt: string;
  expiresAt: string | null;
};

export const BETA_RELEASE: ToolRelease = { releaseTier: null, paused: false, releasedAt: null };

export type ToolAccess = {
  allowed: boolean;
  /** Which rule let the viewer in (null when not allowed). */
  via: ToolAccessPath | null;
};

export function toolStageOf(release: ToolRelease | null | undefined): ToolStage {
  if (release?.paused) return "paused";
  return release?.releaseTier ? "released" : "beta";
}

export function grantIsLive(grant: ToolGrant | null | undefined, now: Date = new Date()): boolean {
  if (!grant) return false;
  return grant.expiresAt == null || new Date(grant.expiresAt).getTime() > now.getTime();
}

export function resolveToolAccess(input: {
  isAdmin: boolean;
  effectiveTier: PlanTier;
  release: ToolRelease | null | undefined;
  grant: ToolGrant | null | undefined;
  now?: Date;
}): ToolAccess {
  if (input.isAdmin) return { allowed: true, via: "admin" };
  const release = input.release ?? BETA_RELEASE;
  if (release.paused) return { allowed: false, via: null };
  if (release.releaseTier && TIER_RANK[input.effectiveTier] >= TIER_RANK[release.releaseTier]) {
    return { allowed: true, via: "release" };
  }
  if (grantIsLive(input.grant, input.now)) return { allowed: true, via: "grant" };
  return { allowed: false, via: null };
}

const TIER_LABEL: Record<PlanTier, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/** "Beta", "Paused", "Everyone", "Plus and Pro", "Pro" — the stage in words. */
export function releaseLabel(release: ToolRelease | null | undefined): string {
  const stage = toolStageOf(release);
  if (stage === "paused") return "Paused";
  if (stage === "beta") return "Beta";
  const tier = release!.releaseTier!;
  if (tier === "free") return "Everyone";
  if (tier === "plus") return "Plus and Pro";
  return TIER_LABEL[tier];
}
