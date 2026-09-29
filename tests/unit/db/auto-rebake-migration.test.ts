import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANUAL_PARK_SECONDS, SWEEP_LEASE_TTL_SECONDS } from "@/lib/cards/sweep-lease";

// ---------------------------------------------------------------------------
// migration 0120 — the automatic re-bake's lease, breaker and admin view.
// There is no Postgres in unit tests, so this pins the SQL's shape:
//   * the lease is taken by ONE conditional UPDATE whose WHERE has exactly
//     the four branches tests/stubs/sweep-db.ts models (free / expired /
//     own token / parked for the same holder) — the lease tests run against
//     that model;
//   * release only by the holder's token; parking keeps the holder;
//   * the table is service-role only (it names unlisted cards): RLS on, no
//     policy, API roles revoked; every function revoked from PUBLIC too
//     (functions are executable by PUBLIC by default);
//   * the notification CHECK is 0111's list plus render_sweep_paused —
//     dropping a kind would break every insert of it.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const SQL = readFileSync(join(dir, "0120_auto_rebake.sql"), "utf8");
const body = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function fn(name: string): string {
  const match = body.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!match) throw new Error(`function ${name} not found`);
  return squash(match[0]);
}

function typeCheckKinds(sql: string): string[] {
  const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("0120 — the sweep lease", () => {
  it("takes the lease with one conditional UPDATE: free, expired, own token, or parked for the same holder", () => {
    const acquire = fn("acquire_render_sweep_lease");
    expect(acquire).toContain(
      squash(`where s.id = 1
        and (
          s.lease_expires_at is null
          or s.lease_expires_at <= now()
          or s.lease_token = p_token
          or (s.lease_token is null and s.lease_holder = p_holder)
        )`),
    );
    expect(acquire).toContain("lease_expires_at = now() + make_interval(secs => p_ttl_seconds)");
    expect(acquire).toContain("yield_requested_at = null");
    expect(acquire.match(/update public\.render_sweep_state/g)).toHaveLength(1);
    expect(acquire).toMatch(/p_holder not in \('cron', 'manual'\)/);
  });

  it("releases only for the holder's token; parking keeps the holder and drops the token", () => {
    const release = fn("release_render_sweep_lease");
    expect(release).toContain("where s.id = 1 and s.lease_token = p_token");
    expect(release).toContain("set lease_token = null");
    expect(release).toMatch(/lease_holder = case when coalesce\(p_park_seconds, 0\) > 0 then s\.lease_holder else null end/);
  });

  it("asks only a live CRON lease to yield", () => {
    const request = fn("request_render_sweep_yield");
    expect(request).toContain("s.lease_holder = 'cron' and s.lease_token is not null and s.lease_expires_at > now()");
  });

  it("seeds the single row and keeps it single", () => {
    expect(squash(body)).toContain("id smallint primary key default 1 check (id = 1)");
    expect(squash(body)).toContain("insert into public.render_sweep_state (id) values (1) on conflict (id) do nothing;");
  });

  it("has every column the cron writes, with jsonb shapes the parser expects", () => {
    const flat = squash(body);
    expect(flat).toContain("strikes jsonb not null default '{}'::jsonb check (jsonb_typeof(strikes) = 'object')");
    expect(flat).toContain("poison jsonb not null default '[]'::jsonb check (jsonb_typeof(poison) = 'array')");
    expect(flat).toContain("in_flight jsonb not null default '[]'::jsonb check (jsonb_typeof(in_flight) = 'array')");
    for (const column of ["last_run jsonb", "idle jsonb", "last_checked_at timestamptz", "revalidate_pending boolean"]) {
      expect(flat).toContain(column);
    }
  });

  it("the app's TTLs fit the SQL bounds, and the lease outlives every route's maxDuration", () => {
    expect(body).toMatch(/p_ttl_seconds < 1 or p_ttl_seconds > 900/);
    expect(SWEEP_LEASE_TTL_SECONDS).toBeLessThanOrEqual(900);
    expect(MANUAL_PARK_SECONDS).toBeLessThanOrEqual(900);
    for (const route of [
      "app/api/cron/auto-rebake/route.ts",
      "app/api/admin/rebake/route.ts",
      "app/api/admin/rebake-marked/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), route), "utf8");
      const maxDuration = Number(src.match(/export const maxDuration = (\d+);/)?.[1]);
      expect(maxDuration, route).toBeGreaterThan(0);
      expect(SWEEP_LEASE_TTL_SECONDS, route).toBeGreaterThan(maxDuration);
    }
  });
});

describe("0120 — grants and exposure", () => {
  it("keeps the state table service-role only: RLS on, no policy, API roles revoked", () => {
    const flat = squash(body);
    expect(flat).toContain("alter table public.render_sweep_state enable row level security;");
    expect(flat).not.toMatch(/create policy/i);
    expect(flat).toContain("revoke all on table public.render_sweep_state from public, anon, authenticated;");
    expect(flat).toContain("grant select, insert, update, delete on table public.render_sweep_state to service_role;");
    expect(flat).not.toMatch(/grant [^;]* to (anon|authenticated)/);
  });

  it("revokes every function from PUBLIC and grants it to service_role only", () => {
    const flat = squash(body);
    for (const signature of [
      "acquire_render_sweep_lease(text, uuid, integer)",
      "release_render_sweep_lease(uuid, integer)",
      "request_render_sweep_yield()",
    ]) {
      expect(flat).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(flat).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(flat).not.toMatch(/security definer/i);
  });

  it("the notification CHECK is 0111's kinds plus render_sweep_paused", () => {
    const before = typeCheckKinds(readFileSync(join(dir, "0111_trial_lapsed_notifications.sql"), "utf8"));
    const after = typeCheckKinds(body);
    expect(after).toEqual([...before, "render_sweep_paused"]);
  });
});
