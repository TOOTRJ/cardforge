// ---------------------------------------------------------------------------
// One-off (owner 2026-11-06, question 5): plan credits are ONE-TIME now —
// Plus 60 / Pro 120 with the first paid invoice (lib/billing/credit-refill.ts
// grantPlanCreditsOnce). Subscribers who were already paying when the rule
// changed would otherwise get nothing more (their monthly refill stopped),
// so each ACTIVE Plus / Pro subscriber receives the tier's one-time stock
// ONCE here, under the same key the webhook uses (`plan-once:<user>:<tier>`),
// so their next paid invoice grants nothing twice. A trialing plan is left
// alone: its first paid invoice grants the stock by itself.
//
//   SUPABASE_URL=https://<ref>.supabase.co node scripts/grant-plan-credits-once.mjs
//   SUPABASE_URL=... node scripts/grant-plan-credits-once.mjs --apply
//
// Dry run by default (lists what would be granted, writes nothing). The
// service-role key: SUPABASE_SECRET_KEY for a dev / branch database; for
// PRODUCTION it is asked for on the terminal only (promptHidden — never an
// env var, never echoed). Idempotent: an account whose plan-once rows
// already reach the tier's stock is skipped; a rerun grants nothing twice
// (grant_credits dedupes on the key).
// ---------------------------------------------------------------------------
import { createClient } from "@supabase/supabase-js";
import { promptHidden } from "./lib/hidden-prompt.mjs";
import { isProductionSupabaseUrl } from "./lib/prod-guard.mjs";

// Mirrors lib/billing/plans.ts PLAN_CREDITS_ONCE (an ESM script can't import the TS module).
const PLAN_CREDITS_ONCE = { plus: 60, pro: 120 };
const REASON = "plan_credits_once";
const PAGE = 500;

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const apply = process.argv.includes("--apply");
if (!url) {
  console.error("SUPABASE_URL is required.");
  process.exit(1);
}
let secret = process.env.SUPABASE_SECRET_KEY ?? "";
if (isProductionSupabaseUrl(url)) {
  if (secret) {
    console.error("Production's key is never read from the environment: unset SUPABASE_SECRET_KEY and type it when asked.");
    process.exit(1);
  }
  secret = await promptHidden("Production service-role key (not echoed): ");
}
if (!secret) {
  console.error("SUPABASE_SECRET_KEY is required (or the production prompt).");
  process.exit(1);
}
const supabase = createClient(url, secret, { auth: { persistSession: false } });

console.log(`${apply ? "APPLYING" : "DRY RUN"} against ${new URL(url).hostname}`);
let seen = 0;
let granted = 0;
let skipped = 0;
let failed = 0;
for (let from = 0; ; from += PAGE) {
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, username, subscription_tier, subscription_status, is_admin")
    .eq("subscription_status", "active")
    .in("subscription_tier", ["plus", "pro"])
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error(`Page read failed: ${error.message}`);
    process.exit(1);
  }
  for (const row of rows ?? []) {
    seen += 1;
    if (row.is_admin) {
      skipped += 1;
      continue;
    }
    const tier = row.subscription_tier;
    const target = PLAN_CREDITS_ONCE[tier] ?? 0;
    const { data: ledger, error: ledgerError } = await supabase
      .from("credit_ledger")
      .select("delta, idempotency_key")
      .like("idempotency_key", `plan-once:${row.id}:%`);
    if (ledgerError) {
      failed += 1;
      console.error(`${row.username ?? row.id}: ledger read failed — ${ledgerError.message}`);
      continue;
    }
    const key = `plan-once:${row.id}:${tier}`;
    if ((ledger ?? []).some((r) => r.idempotency_key === key)) {
      skipped += 1;
      continue;
    }
    const already = (ledger ?? []).reduce((sum, r) => sum + (typeof r.delta === "number" ? r.delta : 0), 0);
    const amount = target - already;
    if (amount <= 0) {
      skipped += 1;
      continue;
    }
    if (!apply) {
      console.log(`would grant ${amount} to ${row.username ?? row.id} (${tier})`);
      granted += 1;
      continue;
    }
    const { error: grantError } = await supabase.rpc("grant_credits", {
      p_user_id: row.id,
      p_amount: amount,
      p_reason: REASON,
      p_idempotency_key: key,
    });
    if (grantError) {
      failed += 1;
      console.error(`${row.username ?? row.id}: grant failed — ${grantError.message}`);
      continue;
    }
    granted += 1;
    console.log(`granted ${amount} to ${row.username ?? row.id} (${tier})`);
  }
  if ((rows?.length ?? 0) < PAGE) break;
}
console.log(`${apply ? "granted" : "would grant"}: ${granted} · skipped: ${skipped} · failed: ${failed} · active subscribers seen: ${seen}`);
process.exit(failed > 0 ? 1 : 0);
