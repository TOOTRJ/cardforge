import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0175 (billing audit 2026-11-05, P2-1 / P2-6): the plan's
// interval on the profile (pinned), and grant_credits locking the user's row
// before its idempotency check.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_billing_interval_grant_lock\.sql$/.test(f));
const flat = (FILE ? readFileSync(join(dir, FILE), "utf8") : "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("0175", () => {
  it("exists, numbered after 0174", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(174);
  });

  it("adds billing_interval with its CHECK and pins it beside every other billing column", () => {
    expect(flat).toContain(
      "alter table public.profiles add column if not exists billing_interval text check (billing_interval is null or billing_interval in ('month', 'year'));",
    );
    const trigger = /create or replace function public\.protect_billing_columns\(\)[\s\S]*?\$function\$;/.exec(flat)?.[0] ?? "";
    expect(trigger).toContain("new.billing_interval := null;");
    expect(trigger).toContain("new.billing_interval := old.billing_interval;");
    for (const col of ["payment_failed_at", "subscription_ends_at", "credits", "is_admin", "comp_tier", "card_limit_override"]) {
      expect(trigger, col).toContain(`new.${col} := old.${col};`);
    }
  });

  it("grant_credits locks the profile row BEFORE the idempotency check and keeps 0027's ACL", () => {
    const body = /create or replace function public\.grant_credits\([\s\S]*?\$\$;/.exec(flat)?.[0] ?? "";
    const lock = body.indexOf("where id = p_user_id for update;");
    const check = body.indexOf("select 1 from public.credit_ledger where idempotency_key = p_idempotency_key");
    expect(lock).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(lock);
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(flat).toContain("revoke all on function public.grant_credits(uuid, integer, text, text) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.grant_credits(uuid, integer, text, text) to service_role;");
  });
});
