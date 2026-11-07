import { describe, expect, it } from "vitest";
import {
  grantIsLive,
  releaseLabel,
  resolveToolAccess,
  toolStageOf,
  type ToolRelease,
} from "@/lib/tools/access";
import type { PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// THE beta-tool access rule (lib/tools/access.ts, mirrored by SQL
// has_tool_access — tests/unit/db/beta-tools-migration.test.ts holds the SQL
// to the same order): admin → paused → released plan → live grant.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-06T12:00:00Z");
const beta: ToolRelease = { releaseTier: null, paused: false, releasedAt: null };
const release = (tier: PlanTier, paused = false): ToolRelease => ({
  releaseTier: tier,
  paused,
  releasedAt: "2026-11-01T00:00:00Z",
});
const liveGrant = { grantedAt: "2026-11-01T00:00:00Z", expiresAt: null };
const endedGrant = { grantedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-11-05T00:00:00Z" };
const futureGrant = { grantedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };

function access(over: Partial<Parameters<typeof resolveToolAccess>[0]>) {
  return resolveToolAccess({ isAdmin: false, effectiveTier: "free", release: beta, grant: null, now: NOW, ...over });
}

describe("resolveToolAccess", () => {
  it("lets an admin into every stage, paused included", () => {
    for (const r of [beta, release("pro"), release("free", true), null]) {
      expect(access({ isAdmin: true, release: r })).toEqual({ allowed: true, via: "admin" });
    }
  });

  it("keeps a beta tool closed to every plan without a grant", () => {
    for (const tier of ["free", "plus", "pro"] as const) {
      expect(access({ effectiveTier: tier }).allowed).toBe(false);
    }
    // No release row at all = beta.
    expect(access({ effectiveTier: "pro", release: null }).allowed).toBe(false);
  });

  it("opens a beta tool to a live grant only", () => {
    expect(access({ grant: liveGrant })).toEqual({ allowed: true, via: "grant" });
    expect(access({ grant: futureGrant })).toEqual({ allowed: true, via: "grant" });
    expect(access({ grant: endedGrant }).allowed).toBe(false);
  });

  it("opens a released tool to its plan and every plan above", () => {
    const table: [PlanTier, PlanTier, boolean][] = [
      ["free", "free", true],
      ["free", "plus", true],
      ["free", "pro", true],
      ["plus", "free", false],
      ["plus", "plus", true],
      ["plus", "pro", true],
      ["pro", "free", false],
      ["pro", "plus", false],
      ["pro", "pro", true],
    ];
    for (const [tier, viewer, allowed] of table) {
      expect(access({ release: release(tier), effectiveTier: viewer }), `${tier} ← ${viewer}`).toEqual(
        allowed ? { allowed: true, via: "release" } : { allowed: false, via: null },
      );
    }
  });

  it("lets a tester below the released plan in through the grant", () => {
    expect(access({ release: release("pro"), effectiveTier: "free", grant: liveGrant })).toEqual({
      allowed: true,
      via: "grant",
    });
  });

  it("closes a paused tool to plans and testers alike", () => {
    expect(access({ release: release("free", true), effectiveTier: "pro", grant: liveGrant })).toEqual({
      allowed: false,
      via: null,
    });
  });
});

describe("stage and labels", () => {
  it("reads the stage", () => {
    expect(toolStageOf(null)).toBe("beta");
    expect(toolStageOf(beta)).toBe("beta");
    expect(toolStageOf(release("plus"))).toBe("released");
    expect(toolStageOf(release("plus", true))).toBe("paused");
    expect(toolStageOf({ ...beta, paused: true })).toBe("paused");
  });

  it("names who it is open to", () => {
    expect(releaseLabel(null)).toBe("Beta");
    expect(releaseLabel(release("free"))).toBe("Everyone");
    expect(releaseLabel(release("plus"))).toBe("Plus and Pro");
    expect(releaseLabel(release("pro"))).toBe("Pro");
    expect(releaseLabel(release("pro", true))).toBe("Paused");
  });

  it("treats a grant as live until its end", () => {
    expect(grantIsLive(null, NOW)).toBe(false);
    expect(grantIsLive(liveGrant, NOW)).toBe(true);
    expect(grantIsLive(endedGrant, NOW)).toBe(false);
    expect(grantIsLive({ grantedAt: "x", expiresAt: NOW.toISOString() }, NOW)).toBe(false);
  });
});
