import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Migration 0135 (subscription_ends_at / subscription_canceled_at): the
// rules a new billing column must keep — private, pinned against a user's
// own write, returned to its owner, grants stated (a branch database does
// not auto-grant; a dropped function loses its ACL).
const sql = readFileSync(join(process.cwd(), "supabase/migrations/0135_subscription_ends_at.sql"), "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("migration 0135", () => {
  it("adds both columns idempotently and never widens what the API roles can read", () => {
    expect(code).toMatch(/add column if not exists subscription_ends_at timestamptz/);
    expect(code).toMatch(/add column if not exists subscription_canceled_at timestamptz/);
    expect(code).not.toMatch(/grant\s+(all|select)[^;]*on\s+(table\s+)?public\.profiles/i);
    expect(code).not.toMatch(/grant all on all tables/i);
  });
  it("pins both columns in protect_billing_columns, on insert and on update", () => {
    for (const column of ["subscription_ends_at", "subscription_canceled_at"]) {
      expect(code).toContain(`new.${column} := null;`);
      expect(code).toContain(`new.${column} := old.${column};`);
    }
    // …and still pins every column the 0060 body pinned.
    for (const column of ["stripe_customer_id", "subscription_tier", "subscription_status", "stripe_subscription_id", "current_period_end", "cancel_at_period_end", "credits", "is_admin", "featured_at", "comp_tier", "comp_expires_at", "card_limit_override"]) {
      expect(code).toContain(`new.${column} := old.${column};`);
    }
  });
  it("re-creates get_my_billing() for the signed-in owner only, with its grants", () => {
    expect(code).toMatch(/drop function if exists public\.get_my_billing\(\);/);
    expect(code).toMatch(/where p\.id = auth\.uid\(\)/);
    expect(code).toMatch(/revoke all on function public\.get_my_billing\(\) from public, anon, authenticated;/);
    expect(code).toMatch(/grant execute on function public\.get_my_billing\(\) to authenticated, service_role;/);
  });
  it("re-creates admin_list_users for the service role only, with the 'ending' segment", () => {
    expect(code).toMatch(/revoke all on function public\.admin_list_users\(text, text, text, text, text, integer, integer\)\s+from public, anon, authenticated;/);
    expect(code).toMatch(/grant execute on function public\.admin_list_users\(text, text, text, text, text, integer, integer\)\s+to service_role;/);
    expect(code).toMatch(/p_flag = 'ending' and p\.subscription_status in \('active', 'trialing'\)/);
  });
});
