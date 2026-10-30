import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0153 (referrals): RLS on every table, grants stated, users read a status
// and never a fraud reason or a Stripe detail, the caps step is the service
// role's alone, and the notification list keeps every kind 0149 allowed.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const sql = readFileSync(join(dir, "0153_referrals.sql"), "utf8");

function typeCheckKinds(text: string): string[] {
  const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("migration 0153 — referrals", () => {
  it("enables RLS on both tables, with own-or-admin read policies through viewer_is_admin()", () => {
    for (const table of ["referral_codes", "referrals"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(sql).toContain("using (user_id = auth.uid() or public.viewer_is_admin());");
    expect(sql).toContain("using (referrer_id = auth.uid() or referee_id = auth.uid() or public.viewer_is_admin());");
    // No write policy for any API role: both policies are select policies.
    const policies = [...sql.matchAll(/create policy "[^"]+"\s+on public\.\w+ for (\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(["select", "select"]);
  });

  it("states every grant; a user's column grant leaves out the fraud reason and reward details", () => {
    expect(sql).toContain("grant select on public.referral_codes to authenticated;");
    expect(sql).toContain("revoke all on public.referrals from anon, authenticated;");
    const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.referrals to authenticated;/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "status", "referrer_id", "referee_id"]));
    for (const hidden of ["block_reason", "referrer_reward_detail", "referee_reward_detail", "code"]) {
      expect(columns).not.toContain(hidden);
    }
    expect(sql).toContain("grant select, insert, update, delete on public.referrals to service_role;");
    expect(sql).not.toMatch(/grant all on all tables/i);
  });

  it("the caps step is service-role only and takes the caps as arguments under an advisory lock", () => {
    expect(sql).toContain("revoke all on function public.claim_referral_reward(uuid, int, int) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_referral_reward(uuid, int, int) to service_role;");
    expect(sql).toContain("pg_advisory_xact_lock(153, hashtext(v_row.referrer_id::text))");
    expect(sql).toContain("if v_row.status <> 'first_card' then");
  });

  it("the admin stats refuse anyone but an admin (or the service role)", () => {
    expect(sql).toMatch(/if not public\.viewer_is_admin\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role' then/);
    expect(sql).toContain("revoke all on function public.admin_referral_stats(timestamptz) from public, anon;");
  });

  it("keeps every notification kind 0149 allowed and adds the two referral kinds", () => {
    const before = typeCheckKinds(readFileSync(join(dir, "0149_deck_tiles_trending.sql"), "utf8"));
    const after = typeCheckKinds(sql);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toEqual(expect.arrayContaining(["referral_signup", "referral_reward"]));
    expect(after.length).toBe(before.length + 2);
  });

  it("the seed file exercises it with no credential", () => {
    const seed = readFileSync(join(process.cwd(), "supabase/seeds/31_referrals.sql"), "utf8");
    expect(seed).toContain("Refusing to seed dev data");
    expect(seed).toContain("insert into public.referrals");
    expect(seed).not.toMatch(/password|sk_(live|test)_|service_role_key/i);
  });
});
