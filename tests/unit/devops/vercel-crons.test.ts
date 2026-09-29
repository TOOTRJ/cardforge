import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// vercel.json's crons: every scheduled path is a real GET route, and the
// automatic re-bake (lib/cards/auto-rebake.ts) is registered every 5
// minutes (owner, 2026-09-28) — a ~700-card sweep finishes in about half an
// hour after a deploy. Each invocation stops itself (~240 s budget, 280 s hard
// stop) before the next one starts; a run that overran to maxDuration could
// meet the next one, and the shared lease refuses the second (it skips).
// ---------------------------------------------------------------------------

type Cron = { path: string; schedule: string };
const crons: Cron[] = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).crons;

function routeFile(path: string): string {
  return join(process.cwd(), "app", ...path.replace(/^\//, "").split("/"), "route.ts");
}

describe("vercel.json crons", () => {
  it("registers the automatic re-bake every 5 minutes", () => {
    expect(crons).toContainEqual({ path: "/api/cron/auto-rebake", schedule: "*/5 * * * *" });
    expect(crons.filter((c) => c.path === "/api/cron/auto-rebake")).toHaveLength(1);
  });

  it("points every cron at a GET route guarded by cronRouteGuard", () => {
    for (const cron of crons) {
      const file = routeFile(cron.path);
      expect(existsSync(file), cron.path).toBe(true);
      const src = readFileSync(file, "utf8");
      expect(src, cron.path).toMatch(/export async function GET\(/);
      expect(src, cron.path).toContain("cronRouteGuard(request");
    }
  });

  it("the re-bake's budget fits between two invocations", async () => {
    const { AUTO_REBAKE_BUDGET_MS, AUTO_REBAKE_HARD_STOP_MS } = await import("@/lib/cards/auto-rebake");
    const src = readFileSync(routeFile("/api/cron/auto-rebake"), "utf8");
    const maxDuration = Number(src.match(/export const maxDuration = (\d+);/)?.[1]);
    expect(AUTO_REBAKE_BUDGET_MS).toBeLessThan(AUTO_REBAKE_HARD_STOP_MS);
    expect(AUTO_REBAKE_HARD_STOP_MS).toBeLessThan(maxDuration * 1000);
    // The run stops itself before the next invocation; maxDuration may equal the
    // gap (the lease, TTL above maxDuration, keeps an overrun from overlapping).
    expect(AUTO_REBAKE_HARD_STOP_MS).toBeLessThan(5 * 60 * 1000);
    expect(maxDuration * 1000).toBeLessThanOrEqual(5 * 60 * 1000);
    const { SWEEP_LEASE_TTL_SECONDS } = await import("@/lib/cards/sweep-lease");
    expect(SWEEP_LEASE_TTL_SECONDS).toBeGreaterThan(maxDuration);
  });
});
