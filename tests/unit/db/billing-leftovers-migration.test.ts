import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0181 (the billing audit's three leftovers, owner 2026-11-06):
// `profiles.subscription_held_from` (pinned, returned to its owner and to
// admins), the one-time plan credits judged and granted in ONE statement
// under the user's row lock, and the admin "Credits granted" totals summed
// in SQL. Every function states its grants (service role only, but
// get_my_billing's owner read).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_billing_leftovers\.sql$/.test(f));
const flat = (FILE ? readFileSync(join(dir, FILE), "utf8") : "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

const fn = (name: string) => new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(flat)?.[0] ?? "";

describe("0181", () => {
  it("exists, numbered after 0180", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(180);
  });

  it("adds subscription_held_from with its CHECK and pins it beside every other billing column", () => {
    expect(flat).toContain(
      "alter table public.profiles add column if not exists subscription_held_from text check (subscription_held_from is null or subscription_held_from in ('active', 'trialing'));",
    );
    const trigger = /create or replace function public\.protect_billing_columns\(\)[\s\S]*?\$function\$;/.exec(flat)?.[0] ?? "";
    expect(trigger).toContain("new.subscription_held_from := null;");
    expect(trigger).toContain("new.subscription_held_from := old.subscription_held_from;");
    for (const col of ["billing_interval", "payment_failed_at", "subscription_ends_at", "credits", "is_admin", "comp_tier", "card_limit_override"]) {
      expect(trigger, col).toContain(`new.${col} := old.${col};`);
    }
  });

  it("get_my_billing and admin_list_users return the column (dropped and recreated: a RETURNS TABLE change), ACLs as before", () => {
    expect(flat).toContain("drop function if exists public.get_my_billing();");
    const billing = fn("get_my_billing");
    expect(billing).toContain("payment_failed_at timestamptz, subscription_held_from text )");
    expect(billing).toContain("p.payment_failed_at, p.subscription_held_from from public.profiles p where p.id = auth.uid();");
    expect(flat).toContain("grant execute on function public.get_my_billing() to authenticated, service_role;");
    expect(flat).toContain("drop function if exists public.admin_list_users(text, text, text, text, text, integer, integer);");
    const list = fn("admin_list_users");
    expect(list).toContain("subscription_canceled_at timestamptz, subscription_held_from text )");
    expect(list).toContain("p.subscription_canceled_at, p.subscription_held_from,");
    expect(list).toContain("b.subscription_ends_at, b.subscription_canceled_at, b.subscription_held_from from base b");
    expect(flat).toContain("grant execute on function public.admin_list_users(text, text, text, text, text, integer, integer) to service_role;");
  });

  it("grant_plan_credits_once locks the profile row, then checks the key, sums the account's plan keys and grants the difference through grant_credits — service role only", () => {
    const body = fn("grant_plan_credits_once");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    const lock = body.indexOf("perform 1 from public.profiles where id = p_user_id for no key update;");
    const key = body.indexOf("if exists (select 1 from public.credit_ledger where idempotency_key = v_key)");
    const sum = body.indexOf("select coalesce(sum(l.delta), 0) into v_already");
    const grant = body.indexOf("perform public.grant_credits(p_user_id, v_amount, 'plan_credits_once', v_key);");
    expect(lock).toBeGreaterThan(-1);
    expect(key).toBeGreaterThan(lock);
    expect(sum).toBeGreaterThan(key);
    expect(grant).toBeGreaterThan(sum);
    expect(body).toContain("v_key text := 'plan-once:' || p_user_id::text || ':' || p_tier;");
    expect(body).toContain("and l.idempotency_key like 'plan-once:' || p_user_id::text || ':%';");
    expect(body).toContain("if v_amount <= 0 then return 0;");
    expect(body).toContain("p_tier not in ('plus', 'pro') then raise exception");
    expect(flat).toContain("revoke all on function public.grant_plan_credits_once(uuid, text, integer) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.grant_plan_credits_once(uuid, text, integer) to service_role;");
  });

  it("admin_credit_grant_stats sums positive rows by the reason's head (the app's grouping), since a date or all time — service role only", () => {
    const body = fn("admin_credit_grant_stats");
    expect(body).toContain("returns table (reason text, credits bigint, grants bigint)");
    expect(body).toContain("coalesce(nullif(lower(btrim(split_part(l.reason, ':', 1))), ''), 'other') as reason");
    expect(body).toContain("where l.delta > 0 and (p_since is null or l.created_at >= p_since)");
    expect(body).toContain("order by 2 desc, 1 asc;");
    expect(flat).toContain("revoke all on function public.admin_credit_grant_stats(timestamptz) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.admin_credit_grant_stats(timestamptz) to service_role;");
  });
});
