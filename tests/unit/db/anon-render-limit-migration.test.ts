import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// migration 0125 — the anonymous live-render limiter (TODO 7.8). There is no
// Postgres in unit tests, so this pins the SQL's shape:
//   * the table stores a 32-hex key, a minute and a count — no address, no
//     user, nothing else (the funnel rule: anonymous rows carry no
//     identifier);
//   * hit_anon_render_limit runs in the order tests/stubs/anon-render-db.ts
//     models (lock → drop stale windows → read → refuse on the minute, then
//     the hour → count), and a refused call writes nothing;
//   * service role only: RLS on with no policy, the API roles revoked from
//     the table, the function revoked from PUBLIC too (functions are
//     executable by PUBLIC by default) — the route writes it with the admin
//     client, so an anonymous PostgREST caller can't bump or read counters.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const SQL = readFileSync(join(dir, "0125_anon_render_limit.sql"), "utf8");
const body = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const flat = squash(body);

function fn(): string {
  const match = body.match(/create or replace function public\.hit_anon_render_limit\([\s\S]*?\n\$\$;/);
  if (!match) throw new Error("hit_anon_render_limit not found");
  return squash(match[0]);
}

describe("0125 — the anonymous live-render limiter", () => {
  it("stores only a 32-hex key, the minute and a count", () => {
    const table = flat.match(/create table if not exists public\.anon_render_hits \((.*?)\);/);
    expect(table).not.toBeNull();
    const columns = table![1]
      .split(/,(?![^(]*\))/)
      .map((c) => c.trim().split(" ")[0])
      .filter((c) => c !== "primary");
    expect(columns).toEqual(["key_hash", "window_start", "hits"]);
    expect(flat).toContain("key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$')");
    expect(flat).toContain("primary key (key_hash, window_start)");
  });

  it("serialises one key's calls, drops stale windows, then refuses before it counts", () => {
    const f = fn();
    const at = (s: string) => {
      const i = f.indexOf(squash(s));
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const lock = at("perform pg_advisory_xact_lock(hashtextextended('anon_render_hits:' || p_key_hash, 0));");
    const prune = at("delete from public.anon_render_hits as h where h.window_start <= v_window - interval '1 hour';");
    const read = at("where h.key_hash = p_key_hash and h.window_start > v_window - interval '1 hour';");
    const minute = at("if v_minute >= p_per_minute then");
    const hour = at("if v_hour >= p_per_hour then");
    const insert = at(
      "insert into public.anon_render_hits as h (key_hash, window_start, hits) values (p_key_hash, v_window, 1) on conflict (key_hash, window_start) do update set hits = h.hits + 1;",
    );
    expect([lock, prune, read, minute, hour, insert]).toEqual([...[lock, prune, read, minute, hour, insert]].sort((a, b) => a - b));
    // Exactly one write of a hit, after both refusals return.
    expect(f.match(/insert into public\.anon_render_hits/g)).toHaveLength(1);
    expect(f).toContain("v_window timestamptz := date_trunc('minute', now());");
    expect(f).toContain("greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now()))))::integer");
    expect(f).toContain("greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now()))))::integer");
    expect(f).toContain("returns table (allowed boolean, retry_after_seconds integer)");
    expect(f).toContain("set search_path = public");
  });

  it("rejects a key that isn't 32 hex digits and nonsense limits", () => {
    const f = fn();
    expect(f).toContain("if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{32}$' then");
    expect(f).toContain("p_per_minute is null or p_per_minute < 1 or p_per_hour is null or p_per_hour < p_per_minute");
  });

  it("is service-role only: RLS on, no policy, API roles and PUBLIC revoked", () => {
    expect(flat).toContain("alter table public.anon_render_hits enable row level security;");
    expect(flat).not.toMatch(/create policy/i);
    expect(flat).toContain("revoke all on table public.anon_render_hits from public, anon, authenticated;");
    expect(flat).toContain("grant select, insert, update, delete on table public.anon_render_hits to service_role;");
    expect(flat).toContain(
      "revoke all on function public.hit_anon_render_limit(text, integer, integer) from public, anon, authenticated;",
    );
    expect(flat).toContain("grant execute on function public.hit_anon_render_limit(text, integer, integer) to service_role;");
    expect(flat).not.toMatch(/grant [^;]* to (anon|authenticated)/);
    expect(flat).toContain("security invoker");
  });

  it("declares the RPC the route calls (types/supabase.ts)", () => {
    const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
    expect(squash(types)).toContain(
      "hit_anon_render_limit: { Args: { p_key_hash: string; p_per_minute: number; p_per_hour: number }; Returns: { allowed: boolean; retry_after_seconds: number }[]; };",
    );
  });
});
