import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMANENT_FUNNEL_EVENTS, SIGNUP_METHODS } from "@/lib/analytics/funnel-events";

// ---------------------------------------------------------------------------
// Migration 0197 (the 2026-11-10 analytics audit): one signup row and one of
// each activation milestone per user, a signup row for every account that
// had none (Google / Discord accounts, accounts older than the funnel), and
// the three admin counts leave the team's own accounts out unless asked.
// ---------------------------------------------------------------------------

const sql = readFileSync("supabase/migrations/0197_funnel_correctness.sql", "utf8");
const statements = sql.replace(/^--.*$/gm, "");
const fn = (name: string) => {
  const start = statements.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return statements.slice(start, statements.indexOf("$$;", statements.indexOf("as $$", start)) + 3 || undefined);
};
/** A function's text up to the end of its body (`$$` alone or `$$;`). */
const fnBody = (name: string) => {
  const start = statements.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = statements.indexOf("as $$", start);
  const close = statements.indexOf("$$", open + 5);
  return statements.slice(start, close);
};
const quoted = (list: readonly string[]) => list.map((e) => `'${e}'`).join(", ");

describe("0197_funnel_correctness", () => {
  it("holds the SAME once-per-user events the prune cron never deletes", () => {
    const list = quoted(PERMANENT_FUNNEL_EVENTS);
    expect(PERMANENT_FUNNEL_EVENTS).toEqual(["signup", "first_card_saved", "first_ai_generation", "first_download"]);
    // The clean-up and the index name the same four.
    expect(statements.split(`event in (${list})`).length - 1).toBe(2);
  });

  it("removes the duplicates before it forbids them — keeping each user's EARLIEST row, with no writer in between", () => {
    // The live deployment still checks-then-inserts: a duplicate committed between the clean-up and the index would fail it.
    const lock = statements.indexOf("lock table public.funnel_events in share row exclusive mode;");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(statements.indexOf("delete from public.funnel_events f"));
    const dedupe = statements.indexOf("delete from public.funnel_events f");
    const index = statements.indexOf("create unique index if not exists funnel_events_once_per_user_idx");
    expect(dedupe).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(dedupe);
    expect(statements).toMatch(/keep\.user_id = f\.user_id\s+and keep\.event = f\.event\s+and \(keep\.created_at, keep\.id\) < \(f\.created_at, f\.id\);/);
    expect(statements).toMatch(/on public\.funnel_events \(user_id, event\)\s+where user_id is not null\s+and event in \(/);
  });

  it("takes the lock, cleans up and builds the index in ONE statement — the runner sends statements one at a time, and a bare LOCK TABLE is refused there", () => {
    // 25P01 "LOCK TABLE can only be used in transaction blocks": the first version failed its preview branch on it.
    const open = statements.indexOf("do $$");
    const close = statements.indexOf("end\n$$;", open);
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const block = statements.slice(open, close);
    expect(block).toContain("lock table public.funnel_events in share row exclusive mode;");
    expect(block).toContain("delete from public.funnel_events f");
    expect(block).toContain("create unique index if not exists funnel_events_once_per_user_idx");
    // …and nowhere outside a block: no top-level statement of this file needs a transaction of its own.
    expect(statements.slice(0, open) + statements.slice(close)).not.toMatch(/\block table\b/);
    expect(statements).not.toMatch(/^\s*(begin|commit);/m);
  });

  it("gives every account without a signup row one, dated when the account was made, saying how", () => {
    const start = statements.indexOf("insert into public.funnel_events (event, user_id, props, source, created_at)");
    expect(start).toBeGreaterThan(statements.indexOf("create unique index"));
    const backfill = statements.slice(start, statements.indexOf(";", start));
    expect(backfill).toMatch(/and not exists \(\s+select 1 from public\.funnel_events f where f\.user_id = u\.id and f\.event = 'signup'\s+\)\s+on conflict do nothing/);
    // Dated at the account's creation (an account with no date is dated now, never NULL: the column refuses it).
    expect(backfill).toMatch(/'server',\s+coalesce\(u\.created_at, now\(\)\)/);
    // How it signed up = its FIRST identity (the account's own provider field can change when one is linked).
    expect(backfill).toMatch(/select i\.provider from auth\.identities i\s+where i\.user_id = u\.id\s+order by i\.created_at asc nulls last, i\.id asc\s+limit 1/);
    // Anonymous and soft-deleted auth users are not accounts.
    expect(backfill).toMatch(/where u\.deleted_at is null\s+and not coalesce\(u\.is_anonymous, false\)/);
    expect(backfill).toContain("'backfilled', true");
    // The methods it can write are the app's own four.
    const named = [...backfill.matchAll(/'(email|google|discord|other)'/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(SIGNUP_METHODS));
    // Nothing of the account but its id, its provider and its date.
    expect(backfill).not.toMatch(/\bemail\b(?!')|raw_user_meta_data|phone/);
  });

  it.each([
    ["admin_funnel_counts", "timestamptz", "p_since timestamptz,\n  p_include_admins boolean default false", "e.user_id"],
    ["admin_trial_engagement", "timestamptz", "p_since timestamptz,\n  p_include_admins boolean default false", "e.user_id"],
    ["admin_credit_grant_stats", "timestamptz", "p_since timestamptz default null,\n  p_include_admins boolean default false", "l.user_id"],
  ])("%s leaves admins out unless asked, keeps its old callers, and stays the service role's", (name, oldArgs, newArgs, column) => {
    // The old one-argument signature goes; a call naming only p_since reaches the new one's default.
    expect(statements).toContain(`drop function if exists public.${name}(${oldArgs});`);
    expect(fn(name)).toContain(`public.${name}(\n  ${newArgs}\n)`);
    const body = fnBody(name);
    expect(body).toMatch(/security definer\s+set search_path = ''/);
    expect(body).toContain("p_include_admins");
    expect(body).toContain(`${column} not in (select p.id from public.profiles p where p.is_admin)`);
    expect(statements).toContain(`revoke all on function public.${name}(timestamptz, boolean) from public, anon, authenticated;`);
    expect(statements).toContain(`grant execute on function public.${name}(timestamptz, boolean) to service_role;`);
  });

  it("a row with no user — an anonymous step, a deleted account — is never an admin's", () => {
    expect(fnBody("admin_funnel_counts")).toMatch(/p_include_admins\s+or e\.user_id is null\s+or e\.user_id not in/);
  });

  it("changes no table's shape and grants nothing to a visitor", () => {
    expect(statements).not.toMatch(/\b(alter|create|drop) table\b/i);
    expect(statements).not.toMatch(/grant [^;]* to (anon|authenticated|public)\b/i);
    expect(statements).not.toMatch(/grant all/i);
  });

  it("leaves the trial table's 7-day window alone (that is the analytics page's change)", () => {
    const before = readFileSync("supabase/migrations/0113_trial_engagement.sql", "utf8");
    const tail = (text: string) => text.slice(text.indexOf("  activity as ("), text.indexOf("  limit 50"));
    expect(tail(fnBody("admin_trial_engagement") + "\n  limit 50")).toBe(tail(before));
  });
});
