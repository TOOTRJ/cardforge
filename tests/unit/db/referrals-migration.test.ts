import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The referrals migration: RLS on every table, grants stated revoke-first,
// users read a status and never a fraud reason or a Stripe detail, the caps
// and the Plus month are the service role's alone under a NAMED lock, a
// deleted friend keeps the cap's evidence, the referral month is a pinned
// billing column the plan readers take as Plus, and the notification list
// keeps every kind 0161 allowed. Found by NAME, never by number — the file is
// renumbered at merge.
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
    expect(locks.length).toBeGreaterThanOrEqual(2);
    for (const key of locks) expect(key).toBe("hashtext('pipglyph.referrals')");
    expect(sql).not.toMatch(/pg_advisory_xact_lock\(\d+/);
  });

  it("the caps step: service role only, caps as arguments, only a first_card row moves", () => {
    expect(sql).toContain("revoke all on function public.claim_referral_reward(uuid, int, int) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_referral_reward(uuid, int, int) to service_role;");
    expect(fn("claim_referral_reward")).toContain("if v_row.status <> 'first_card' then");
  });

  it("the Plus month: service role only, one transaction with its credits, once per referral and side", () => {
    expect(sql).toContain(
      "revoke all on function public.grant_referral_plus_month(uuid, text, int, int) from public, anon, authenticated;",
    );
    expect(sql).toContain("grant execute on function public.grant_referral_plus_month(uuid, text, int, int) to service_role;");
    const grant = fn("grant_referral_plus_month");
    // Idempotent: a side already decided returns its stored detail.
    expect(grant).toContain("v_row.referrer_reward is not null");
    expect(grant).toContain("v_row.referee_reward is not null");
    // The end date is read and written in SQL, under the user's lock + a row lock.
    expect(grant).toMatch(/select \* into v_profile from public\.profiles where id = v_user for update;/);
    expect(grant).toContain("update public.profiles set referral_plus_until = v_end where id = v_user;");
    // ONE credit grant per month, keyed per referral and side.
    expect(grant).toContain("perform public.grant_credits(");
    expect(grant).toContain("'referral:' || p_referral_id::text || ':' || p_side");
    // Never the admin comp's columns.
    expect(grant).not.toMatch(/set comp_tier|set comp_expires_at|comp_expires_at\s*=/);
  });

  it("the referral month is a pinned, private billing column every plan reader takes as Plus", () => {
    expect(sql).toContain("add column if not exists referral_plus_until timestamptz;");
    const protect = fn("protect_billing_columns");
    expect(protect).toContain("new.referral_plus_until := null;");
    expect(protect).toContain("new.referral_plus_until := old.referral_plus_until;");
    expect(fn("get_my_billing")).toContain("p.referral_plus_until");
    expect(sql).toContain("revoke all on function public.get_my_billing() from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.get_my_billing() to authenticated, service_role;");
    expect(fn("card_capacity_for")).toContain("or referral_plus_until > now() then 'plus'");
    expect(fn("owner_export_stamp")).toContain("p.referral_plus_until > now()");
    // No column grant to the API roles (0074's list stays private).
    expect(sql).not.toMatch(/grant select \([^)]*referral_plus_until/);
  });

  it("the admin stats refuse anyone but an admin (or the service role)", () => {
    expect(sql).toMatch(/if not public\.viewer_is_admin\(\) and coalesce\(auth\.role\(\), ''\) <> 'service_role' then/);
    expect(sql).toContain("revoke all on function public.admin_referral_stats(timestamptz) from public, anon, authenticated;");
  });

  it("keeps every notification kind 0161 allowed (the last to redefine it) and adds the two referral kinds", () => {
    const before = typeCheckKinds(readFileSync(join(dir, "0161_comp_ending_notifications.sql"), "utf8"));
    expect(before).toEqual(expect.arrayContaining(["moderation_unhidden", "comp_ending"]));
    expect(typeCheckKinds(sql)).toEqual([...before, "referral_signup", "referral_reward"]);
    expect(sql).toContain("-- REFERRAL KINDS");
  });

  it("no other migration after 0161 redefined the CHECK without the referral kinds", () => {
    const later = readdirSync(dir).filter(
      (f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) > "0161" && f !== file,
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
