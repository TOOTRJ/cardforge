import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The days-bank migration (0179): the bank table with RLS and a column-level
// read for the user, every write the service role's; plan_grants gains an
// exact `days` beside `units` (never both), `grants_credits`, and the
// 'day_bank' source. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_day_bank\.sql$/.test(f));
const sql = files[0] ? readFileSync(join(dir, files[0]), "utf8") : "";

describe("the days-bank migration", () => {
  it("is one file", () => {
    expect(files).toHaveLength(1);
  });

  it("the bank table: statuses, sources, the reference unique, stamps enforced", () => {
    expect(sql).toContain("create table if not exists public.day_bank_entries");
    expect(sql).toContain("status in ('banked', 'reserved', 'applied', 'revoked')");
    expect(sql).toContain("source in ('signup', 'referral_friend', 'referral_step', 'admin', 'promo')");
    expect(sql).toContain("reference text unique");
    expect(sql).toContain("days integer not null check (days >= 1 and days <= 730)");
    expect(sql).toContain("constraint day_bank_entries_applied_stamped check (status <> 'applied' or applied_at is not null)");
    expect(sql).toContain("constraint day_bank_entries_reserved_batch check (status <> 'reserved' or batch_id is not null)");
  });

  it("RLS on, the user reads only their own rows' public columns, the service role writes", () => {
    expect(sql).toContain("alter table public.day_bank_entries enable row level security;");
    expect(sql).toContain("for select using (user_id = auth.uid());");
    const policies = [...sql.matchAll(/create policy "[^"]+"\s+on public\.day_bank_entries\s+for (\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(["select"]);
    const revoke = sql.indexOf("revoke all on table public.day_bank_entries from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    const grant = sql.match(/grant select \(([^)]*)\)\s+on table public\.day_bank_entries to authenticated;/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["days", "source", "status", "created_at"]));
    for (const hidden of ["reference", "note", "revoke_reason"]) expect(columns).not.toContain(hidden);
    expect(sql).toContain("grant select, insert, update, delete on table public.day_bank_entries to service_role;");
    expect(sql).not.toMatch(/grant all on all tables/i);
  });

  it("plan_grants: exact days beside units (never both), credits switchable, the day_bank source", () => {
    expect(sql).toContain("add column if not exists days integer check (days is null or (days >= 1 and days <= 730))");
    expect(sql).toContain("add column if not exists grants_credits boolean not null default true");
    expect(sql).toContain("check ((units is null and days is null) = (ends_at is null))");
    expect(sql).toContain("check (units is null or days is null)");
    expect(sql).toContain("check (source in ('comp', 'referral_friend', 'referral_referrer', 'promo', 'day_bank'))");
  });

  it("the seed exercises it with no credential", () => {
    const seed = readdirSync(join(process.cwd(), "supabase/seeds")).find((f) => /_day_bank\.sql$/.test(f));
    expect(seed).toBeTruthy();
    const text = readFileSync(join(process.cwd(), "supabase/seeds", seed!), "utf8");
    expect(text).toContain("Refusing to seed dev data");
    expect(text).toContain("insert into public.day_bank_entries");
    expect(text).not.toMatch(/password|sk_(live|test)_|service_role_key/i);
  });
});
