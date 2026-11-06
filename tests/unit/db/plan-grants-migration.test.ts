import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0176 — free 30 days: the plan_grants table, its grants (service
// role owns it; a user reads their own rows' public columns), and the
// conversion of the comps in place.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_plan_grants\.sql$/.test(f));
const flat = (FILE ? readFileSync(join(dir, FILE), "utf8") : "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("0176", () => {
  it("exists, numbered after 0175", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(175);
  });

  it("creates plan_grants with the shapes the code writes: tier, 30-day units (null = no end), source, applied_as, status", () => {
    expect(flat).toContain("create table if not exists public.plan_grants (");
    expect(flat).toContain("tier text not null check (tier in ('plus', 'pro'))");
    expect(flat).toContain("units integer check (units is null or units >= 1)");
    expect(flat).toContain("source text not null check (source in ('comp', 'referral_friend', 'referral_referrer', 'promo'))");
    expect(flat).toContain("applied_as text not null check (applied_as in ('overlay', 'subscription_hold', 'below_plan'))");
    expect(flat).toContain("status text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'revoked'))");
    expect(flat).toContain("constraint plan_grants_end_matches_units check ((units is null) = (ends_at is null))");
    expect(flat).toContain("credits_from timestamptz not null");
  });

  it("the service role owns it; a user reads their OWN rows and only the public columns; anon nothing", () => {
    expect(flat).toContain("alter table public.plan_grants enable row level security;");
    expect(flat).toContain('create policy "Users read their own plan grants" on public.plan_grants for select using (auth.uid() = user_id);');
    expect(flat).toContain("revoke all on table public.plan_grants from public, anon, authenticated, service_role;");
    expect(flat).toContain("grant select (id, tier, units, source, applied_as, starts_at, ends_at, status, created_at) on table public.plan_grants to authenticated;");
    expect(flat).toContain("grant select, insert, update, delete on table public.plan_grants to service_role;");
    // Never the admin's note or who granted it.
    expect(flat).not.toMatch(/grant select \([^)]*(note|granted_by)[^)]*\) on table public\.plan_grants to authenticated/);
  });

  it("converts the comps in place once (idempotent), never an admin's, their first allotment on the first of next month", () => {
    const convert = /insert into public\.plan_grants[\s\S]*?;/.exec(flat)?.[0] ?? "";
    expect(convert).toContain("where p.comp_tier in ('plus', 'pro')");
    expect(convert).toContain("and (p.comp_expires_at is null or p.comp_expires_at > now())");
    expect(convert).toContain("and coalesce(p.is_admin, false) = false");
    expect(convert).toContain("and not exists (select 1 from public.plan_grants g where g.user_id = p.id)");
    expect(convert).toContain("(date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'");
    expect(convert).toContain("'applied'");
  });
});
