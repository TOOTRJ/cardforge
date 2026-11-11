import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCreditFlow } from "@/lib/admin/analytics/credits";

// ---------------------------------------------------------------------------
// admin_credit_flow's migration (the "Credits and AI" tab): the function's
// signature as types/supabase.ts declares it, the period and admin rules
// every analytics function shares, what counts as spent / refunded /
// granted, the keys the app reads, and the service role's grant alone.
// Found by NAME, never by number (it may be renumbered past another PR's).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_admin_credit_flow\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comment lines. */
const body = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const flat = body.replace(/\s+/g, " ");
const header = sql.slice(0, sql.indexOf("create or replace function"));

describe("the admin_credit_flow migration", () => {
  it("exists, once", () => {
    expect(file).not.toBe("");
    expect(readdirSync(dir).filter((f) => f.includes("admin_credit_flow"))).toHaveLength(1);
  });

  it("declares the function as the app's types do: (p_since, p_until default now(), p_include_admins default false) → jsonb", () => {
    expect(flat).toContain(
      "create or replace function public.admin_credit_flow( p_since timestamptz, p_until timestamptz default now(), p_include_admins boolean default false ) returns jsonb",
    );
    const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8").replace(/\s+/g, " ");
    expect(types).toContain("admin_credit_flow: { Args: { p_since: string; p_until?: string; p_include_admins?: boolean }; Returns: Json; };");
  });

  it("is a stable SQL function that runs as its owner with an empty search path, every table schema-qualified", () => {
    expect(flat).toContain("language sql stable security definer set search_path = ''");
    expect(body.match(/\bfrom\s+public\.credit_ledger\b/g)).toHaveLength(2);
    expect(body).toContain("from public.profiles p where p.is_admin");
    // No unqualified table: with an empty search path it would not resolve.
    expect(body).not.toMatch(/\b(from|join)\s+(credit_ledger|profiles)\b/);
  });

  it("reads the period [p_since, p_until) — a null p_until is now — and groups by UTC day", () => {
    expect(flat).toContain("select p_since as since, coalesce(p_until, now()) as until");
    expect(flat).toContain("l.created_at >= b.since and l.created_at < b.until");
    expect(flat).toContain("(l.created_at at time zone 'utc')::date as day");
  });

  it("leaves admins' rows out unless asked", () => {
    expect(flat).toContain("p_include_admins or l.user_id not in (select p.id from public.profiles p where p.is_admin)");
  });

  it("a charge is spent, a refunded pack's clawback is not, a 'refund' is refunded, everything else is granted", () => {
    expect(flat).toContain(
      "case when l.delta < 0 and l.head = 'pack_refund' then 'taken_back' when l.delta < 0 then 'spent' when l.head = 'refund' then 'refunded' else 'granted' end as kind",
    );
    // Grouped as admin_credit_grant_stats groups: the reason before its first colon.
    expect(flat).toContain("coalesce(nullif(lower(btrim(split_part(l.reason, ':', 1))), ''), 'other') as head");
    expect(flat).toContain("l.delta <> 0");
  });

  it("matches a refund to its charge by the key, on the same user — never by guessing", () => {
    expect(flat).toContain("s.idempotency_key = substr(c.idempotency_key, 8)");
    expect(flat).toContain("c.idempotency_key like 'refund:%'");
    expect(flat).toContain("s.user_id = c.user_id");
    expect(flat).toContain("s.delta < 0");
    // The older key named the reason itself — taken only when it names this row's user.
    expect(flat).toContain("split_part(c.idempotency_key, ':', 3) = c.user_id::text");
  });

  it("answers the keys the app reads, and documents them", () => {
    const keys = ["since", "until", "totals", "spent_by_reason", "refunded_unattributed", "granted_by_reason", "days"];
    for (const key of keys) {
      expect(body, key).toContain(`'${key}', `);
      expect(header, `${key} in the header`).toContain(key);
    }
    for (const key of ["spent", "spends", "refunded", "refunds", "granted", "grants", "taken_back", "take_backs", "reason", "credits", "day"]) {
      expect(body, key).toContain(`'${key}', `);
    }
    // The parser reads those very keys: an answer in the function's shape comes back whole.
    const flow = parseCreditFlow({
      totals: { spent: 1, spends: 2, refunded: 3, refunds: 4, granted: 5, grants: 6, taken_back: 7, take_backs: 8 },
      spent_by_reason: [{ reason: "fill_card", spent: 1, spends: 2, refunded: 3, refunds: 4 }],
      refunded_unattributed: { credits: 9, refunds: 10 },
      granted_by_reason: [{ reason: "pack_purchase", credits: 5, grants: 6 }],
      days: [{ day: "2026-11-10", spent: 1, granted: 5, refunded: 3 }],
    });
    expect(flow?.totals).toEqual({ spent: 1, spends: 2, refunded: 3, refunds: 4, granted: 5, grants: 6, takenBack: 7, takeBacks: 8 });
    expect(flow?.refundedUnattributed).toEqual({ credits: 9, refunds: 10 });
  });

  it("is the service role's alone, and says how it ships", () => {
    expect(flat).toContain("revoke all on function public.admin_credit_flow(timestamptz, timestamptz, boolean) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.admin_credit_flow(timestamptz, timestamptz, boolean) to service_role;");
    expect(body.match(/\bgrant\b/gi)).toHaveLength(1);
    expect(body).not.toMatch(/grant execute[^;]*\bto\s+(public|anon|authenticated)\b/i);
    expect(header).toContain("Ships through a PR; never applied ad-hoc.");
    expect(header).toMatch(/admins generate free/);
  });

  it("holds no top-level lock, begin or commit (the runner sends statements one at a time), and is idempotent", () => {
    expect(body).not.toMatch(/^\s*(lock\s+table|begin|commit)\b/im);
    expect(body).not.toMatch(/\bcreate function\b/i);
    // One statement to create, two for the grants — nothing that changes data.
    expect(body).not.toMatch(/\b(insert|update|delete|alter|drop)\b/i);
  });
});
