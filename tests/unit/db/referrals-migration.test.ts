import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The referrals migration (0177, onto the free-days mechanism): RLS on every
// table, grants stated revoke-first, users read a status and never a fraud
// reason or a Stripe detail, the caps are the service role's alone under a
// NAMED lock (the friends cap caps the friend too), a deleted friend keeps
// the cap's evidence, a grant's reference is unique, the settings row is
// seeded, and the notification list keeps every kind 0174 allowed. Found by
// NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_referrals\.sql$/.test(f));
const file = files[0] ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

function typeCheckKinds(text: string): string[] {
  const all = [...text.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The body of one `create [or replace] function public.<name>(` … `$$;`. */
function fn(name: string): string {
  const start = sql.search(new RegExp(`create (or replace )?function public\\.${name}\\(`));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("$", start);
  const tag = sql.slice(open, sql.indexOf("$", open + 1) + 1);
  const end = sql.indexOf(tag, sql.indexOf(tag, open) + tag.length);
  return sql.slice(start, end + tag.length);
}

describe("the referrals migration", () => {
  it("is one file", () => {
    expect(files).toHaveLength(1);
  });

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

  it("states every grant revoke-first; a user's column grant leaves out the fraud reason and reward details", () => {
    // referral_codes: revoke first, then select for users (P2 of the check).
    const codes = sql.indexOf("revoke all on public.referral_codes from public, anon, authenticated;");
    expect(codes).toBeGreaterThan(0);
    expect(sql.indexOf("grant select on public.referral_codes to authenticated;")).toBeGreaterThan(codes);
    expect(sql).toContain("grant select, insert, update, delete on public.referral_codes to service_role;");

    expect(sql).toContain("revoke all on public.referrals from public, anon, authenticated;");
    const grant = sql.match(/grant select \(([^)]*)\)\s+on public\.referrals to authenticated;/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(",").map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(["id", "status", "referrer_id", "referee_id"]));
    for (const hidden of ["block_reason", "referrer_reward_detail", "referee_reward_detail", "code", "grant_attempts"]) {
      expect(columns).not.toContain(hidden);
    }
    expect(sql).toContain("grant select, insert, update, delete on public.referrals to service_role;");
    expect(sql).not.toMatch(/grant all on all tables/i);
  });

  it("one email, one month: the fingerprints are a keyed hash with no user id, outlive every account, and are the service role's alone", () => {
    const table = sql.slice(
      sql.indexOf("create table if not exists public.referral_email_fingerprints"),
      sql.indexOf(");", sql.indexOf("create table if not exists public.referral_email_fingerprints")),
    );
    expect(table).toContain("fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$')");
    expect(table).toContain("referral_id uuid references public.referrals (id) on delete set null");
    // Nothing ties it to an account, so no account deletion removes it.
    expect(table).not.toMatch(/user_id|profiles|auth\.users|email\b|cascade/);
    expect(sql).toContain("alter table public.referral_email_fingerprints enable row level security;");
    expect(sql).not.toMatch(/create policy "[^"]+"\s+on public\.referral_email_fingerprints/);
    const revoke = sql.indexOf("revoke all on public.referral_email_fingerprints from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select, insert, update, delete on public.referral_email_fingerprints to service_role;")).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/grant [^;]*on public\.referral_email_fingerprints to (anon|authenticated)/);

    // The SQL twin of normalizeReferralEmail and the live-account check:
    // revoke-first, the service role only (the latter reads auth.users).
    for (const signature of ["normalize_referral_email(text)", "referral_email_in_use(uuid, text)"]) {
      const r = sql.indexOf(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(r, signature).toBeGreaterThan(0);
      expect(sql.indexOf(`grant execute on function public.${signature} to service_role;`), signature).toBeGreaterThan(r);
      expect(sql).not.toContain(`grant execute on function public.${signature} to authenticated`);
    }
    const inUse = fn("referral_email_in_use");
    expect(inUse).toContain("security definer");
    expect(inUse).toContain("u.id <> p_user_id");
    expect(inUse).toContain("u.deleted_at is null");
    // A reused email is a block reason a user never reads.
    expect(sql).toContain("'email_reused'");
  });

  it("a deleted friend keeps the referrer's cap evidence (SET NULL, never cascade)", () => {
    expect(sql).toMatch(/referee_id uuid unique references public\.profiles \(id\) on delete set null/);
    expect(sql).not.toMatch(/referee_id[^\n]*on delete cascade/);
    // The cap counts the referrer's rewarded rows, whoever they were for.
    const claim = fn("claim_referral_reward");
    expect(claim).toMatch(/where referrer_id = v_row\.referrer_id\s+and status = 'rewarded';/);
    expect(claim).not.toContain("referee_id is not null");
  });

  it("locks in a NAMED namespace — never a migration number", () => {
    const locks = [...sql.matchAll(/pg_advisory_xact_lock\(([^,]+),/g)].map((m) => m[1].trim());
    expect(locks.length).toBeGreaterThanOrEqual(1);
    for (const key of locks) expect(key).toBe("hashtext('pipglyph.referrals')");
    expect(sql).not.toMatch(/pg_advisory_xact_lock\(\d+/);
  });

  it("the caps step: service role only, the settings' caps as arguments, only a first_card row moves; the friends cap caps the FRIEND too", () => {
    expect(sql).toContain("drop function if exists public.claim_referral_reward(uuid, int, int);");
    expect(sql).toContain("drop function if exists public.claim_referral_reward(uuid, int, int, int);");
    expect(sql).toContain("revoke all on function public.claim_referral_reward(uuid, int, int, int, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_referral_reward(uuid, int, int, int, text) to service_role;");
    const claim = fn("claim_referral_reward");
    expect(claim).toContain("if v_row.status <> 'first_card' then");
    expect(claim).toContain("when p_friends_cap is not null and v_friends >= p_friends_cap then 'capped_friends'");
    expect(claim).toContain("referee_reward = case when v_outcome = 'capped_friends' then 'none' else referee_reward end");
    // A referrer-only block (same_domain) goes through the claim, and its friends count toward the cap.
    expect(claim).toContain("when p_block_reason is not null then 'blocked'");
    expect(claim).toContain("and status in ('rewarded', 'capped', 'blocked')");
    // The reward values are the free-days mechanism's — never money.
    expect(sql).toContain("referrer_reward in ('free_days', 'credits', 'none')");
    expect(sql).not.toMatch(/balance_credit|plus_month|referral_plus_until|grant_referral_plus_month|protect_billing_columns/);
  });

  it("a grant's reference is unique (a retried reward finds its grant), and the settings row is seeded with the defaults", () => {
    expect(sql).toContain("alter table public.plan_grants add column if not exists reference text");
    expect(sql).toContain("create unique index if not exists plan_grants_reference_idx on public.plan_grants (reference) where reference is not null;");
    expect(sql).toMatch(/insert into public\.site_settings \(key, value\)\s+values \('referrals', '\{"enabled": true, "friend": \{"kind": "free_days", "tier": "plus", "units": 1\}, "referrer": \{"kind": "free_days", "tier": "own", "units": 1\}, "caps": \{"perMonth": 3, "lifetime": 12, "friendsPerMonth": 5\}\}'::jsonb\)\s+on conflict \(key\) do nothing;/);
    expect(sql).not.toContain("'program_off'");
  });

  it("the admin stats refuse anyone but an admin (or the service role)", () => {
    expect(sql).toMatch(/if not public\.viewer_is_admin\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role' then/);
    expect(sql).toContain("revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;");
  });

  it("keeps every notification kind 0174 allowed (the last to redefine it) and adds the two referral kinds", () => {
    const before = typeCheckKinds(readFileSync(join(dir, "0174_dunning_grace_refunds_disputes.sql"), "utf8"));
    expect(before).toEqual(expect.arrayContaining(["comp_ending", "challenge_winner", "payment_failed", "billing_alert"]));
    expect(typeCheckKinds(sql)).toEqual([...before, "referral_signup", "referral_reward"]);
    expect(sql).toContain("-- REFERRAL KINDS");
  });

  it("no other migration after this one redefined the CHECK without the referral kinds", () => {
    const later = readdirSync(dir).filter(
      (f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) > file.slice(0, 4) && f !== file,
    );
    for (const f of later) {
      const text = readFileSync(join(dir, f), "utf8");
      if (!text.includes("notifications_type_check")) continue;
      // Merged after this one: it must keep the referral kinds (the union).
      expect(typeCheckKinds(text), f).toEqual(expect.arrayContaining(["referral_signup", "referral_reward"]));
    }
  });

  it("the seed file exercises it with no credential", () => {
    const seed = readdirSync(join(process.cwd(), "supabase/seeds")).find((f) => /_referrals\.sql$/.test(f));
    expect(seed).toBeTruthy();
    const text = readFileSync(join(process.cwd(), "supabase/seeds", seed!), "utf8");
    expect(text).toContain("Refusing to seed dev data");
    expect(text).toContain("insert into public.referrals");
    expect(text).not.toContain("comp_month");
    expect(text).not.toMatch(/password|sk_(live|test)_|service_role_key/i);
  });
});
