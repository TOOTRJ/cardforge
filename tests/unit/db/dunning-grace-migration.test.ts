import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0174 (billing audit 2026-11-05): the dunning grace column and
// rule, two notification kinds, refunds / disputes on the revenue logs and
// the pack claw-back. The rules live in SQL; this holds the file to them
// (also run against the local stack in a rolled-back transaction — the PR).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_dunning_grace_refunds_disputes\.sql$/.test(f));

function strip(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const SQL = strip(FILE ? readFileSync(join(dir, FILE), "utf8") : "");
const flat = SQL.replace(/\s+/g, " ");

/** The CHECK list of the newest migration BEFORE this one that defines it. */
function previousKinds(): string[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < FILE!)
    .sort()
    .reverse();
  for (const f of files) {
    const text = strip(readFileSync(join(dir, f), "utf8")).replace(/\s+/g, " ");
    const m = /add constraint notifications_type_check check \( type in \(([^)]*)\) \)/.exec(text);
    if (m) return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  }
  return [];
}

describe("0174 — the dunning grace", () => {
  it("exists, numbered after 0173", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(173);
  });

  it("adds payment_failed_at, pins it, and returns it to its owner", () => {
    expect(flat).toContain("alter table public.profiles add column if not exists payment_failed_at timestamptz;");
    const trigger = /create or replace function public\.protect_billing_columns\(\)[\s\S]*?\$function\$;/.exec(flat)?.[0] ?? "";
    expect(trigger).toContain("new.payment_failed_at := null;");
    expect(trigger).toContain("new.payment_failed_at := old.payment_failed_at;");
    // Every column 0135 pinned is still pinned.
    for (const col of ["stripe_customer_id", "subscription_ends_at", "subscription_canceled_at", "credits", "is_admin", "comp_tier", "card_limit_override"]) {
      expect(trigger, col).toContain(`new.${col} := old.${col};`);
    }
    const billing = /create function public\.get_my_billing\(\)[\s\S]*?\$\$;/.exec(flat)?.[0] ?? "";
    expect(billing).toContain("payment_failed_at timestamptz )");
    expect(billing).toContain("p.subscription_ends_at, p.subscription_canceled_at, p.payment_failed_at from public.profiles p where p.id = auth.uid()");
    expect(flat).toContain("grant execute on function public.get_my_billing() to authenticated, service_role;");
  });

  it("states the helper's grants and keeps the three readers' grants as they were", () => {
    expect(flat).toContain("revoke all on function public.subscription_perks_on(text, timestamptz) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.subscription_perks_on(text, timestamptz) to service_role;");
    expect(flat).toContain("grant execute on function public.card_capacity_for(uuid) to service_role;");
    expect(flat).toContain("grant execute on function public.owner_export_stamp(uuid) to anon, authenticated;");
  });
});

describe("0174 — the notification kinds", () => {
  it("is the previous list plus payment_failed and billing_alert, nothing dropped", () => {
    const m = /add constraint notifications_type_check check \( type in \(([^)]*)\) \)/.exec(flat);
    expect(m).not.toBeNull();
    const kinds = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    const before = previousKinds();
    expect(before.length).toBeGreaterThan(20);
    for (const kind of before) expect(kinds, kind).toContain(kind);
    expect(kinds).toContain("payment_failed");
    expect(kinds).toContain("billing_alert");
    expect(kinds.length).toBe(before.length + 2);
  });

  it("dedupes both: a failed invoice once per invoice and recipient, an alert once per key and admin", () => {
    expect(flat).toContain(
      "create unique index if not exists notifications_payment_failed_once_idx on public.notifications ((payload ->> 'invoiceId'), recipient_id) where type = 'payment_failed';",
    );
    expect(flat).toContain(
      "create unique index if not exists notifications_billing_alert_once_idx on public.notifications ((payload ->> 'dedupeKey'), recipient_id) where type = 'billing_alert';",
    );
  });
});

describe("0174 — refunds and disputes", () => {
  it("adds the columns to both logs and an index on the payment intent", () => {
    for (const table of ["billing_payments", "billing_pack_payments"]) {
      const alter = new RegExp(`alter table public\\.${table} add column[^;]*;`).exec(flat)?.[0] ?? "";
      for (const col of ["refunded_cents integer not null default 0 check (refunded_cents >= 0)", "refunded_at timestamptz", "dispute_id text", "dispute_status text", "disputed_cents integer not null default 0 check (disputed_cents >= 0)", "disputed_at timestamptz"]) {
        expect(alter, `${table}.${col}`).toContain(col);
      }
      expect(flat).toContain(`on public.${table} (payment_intent_id) where payment_intent_id is not null;`);
    }
    expect(flat).toContain("alter table public.billing_payments add column if not exists payment_intent_id text,");
    expect(flat).toContain("clawed_credits integer not null default 0 check (clawed_credits >= 0)");
  });

  it("reconcile_pack_withdrawal is the service role's alone, locks the row, never takes a balance below zero", () => {
    const body = /create or replace function public\.reconcile_pack_withdrawal\([\s\S]*?\$\$;/.exec(flat)?.[0] ?? "";
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public");
    expect(body).toContain("where checkout_session_id = p_session for update;");
    expect(body).toContain("v_take := least(v_delta, greatest(v_balance, 0));");
    expect(body).toContain("'pack_refund'");
    expect(body).toContain("'pack_refund_reversed'");
    expect(body).toContain("'refund:pack:' || p_session || ':' || (v_row.clawed_credits + v_take)");
    // A give-back's key is its own namespace: a claw to 15, then 30, then a give-back to 15 never collide.
    expect(body).toContain("'refund:pack:' || p_session || ':back:' || v_target");
    expect(flat).toContain("revoke all on function public.reconcile_pack_withdrawal(text, integer) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.reconcile_pack_withdrawal(text, integer) to service_role;");
  });
});
