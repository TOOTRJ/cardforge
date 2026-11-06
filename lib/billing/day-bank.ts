import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { grantFreeDays } from "@/lib/billing/free-days-apply";
import type { PaidTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The DAYS BANK (owner 2026-11-06; migration 0179; docs/BILLING.md "The days
// bank"). A free trial is no longer a thing of its own:
//
//   * every new account gets SIGNUP_BANK_DAYS in its bank (the entry is
//     written at onboarding, and lazily at the first checkout for an older
//     account — under the one-free-period rule the trial had: never
//     subscribed on this account, no Stripe history under the email);
//   * the referral program banks more (lib/referrals: the friend's days,
//     the referrer's ladder steps);
//   * the FIRST checkout applies the whole bank as the free period before
//     the first charge — card required, `trial_end` = now + days, the plan
//     bills by itself when it ends (lib/stripe/actions.ts
//     `createCheckoutSessionAction` → `prepareCheckoutBank`);
//   * days earned AFTER that wait, and the user applies them by hand
//     (`applyBankToPlan` — on a live, renewing plan or free period the days
//     are added to its time through the free-days mechanism, a plan_grants
//     row of source 'day_bank' with an exact `days` and NO credits of its
//     own; with no live plan the billing page sends them to a checkout,
//     which applies the bank as above).
//
// The bank is TIER-LESS: banked days are days of whatever plan the user
// checks out on or already has. Stripe needs a free period at least 48 h
// out, so a checkout applies the bank only from MIN_BANK_DAYS_AT_CHECKOUT;
// fewer days wait.
//
// States: banked → reserved (a Checkout batch, `bank_batch` in the session
// metadata; or a plan application in flight) → applied — or back to banked
// when the session expires (the webhook) or the application fails; a
// reservation nothing settled is released after BANK_RESERVATION_MAX_AGE_MS
// (`releaseStaleReservations`, the referral sweep's run). The signup entry
// is `revoked` when the checkout finds the account not owed it.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;
type UserClient = Awaited<ReturnType<typeof createClient>>;

/** What a new account starts with (the 7-day trial, as a bank). */
export const SIGNUP_BANK_DAYS = 7;
/** Stripe's minimum for a Checkout `trial_end` is 48 h: under this many
 *  banked days a checkout applies nothing and the days wait. */
export const MIN_BANK_DAYS_AT_CHECKOUT = 2;
/** A reservation older than this with no settlement is released (Checkout
 *  sessions expire after 24 h). */
export const BANK_RESERVATION_MAX_AGE_MS = 25 * 60 * 60 * 1000;
/** Stripe allows at most 730 days of free time ahead. */
export const MAX_BANK_DAYS_APPLIED = 730;

export type BankSource = "signup" | "referral_friend" | "referral_step" | "admin" | "promo";
export type BankEntryStatus = "banked" | "reserved" | "applied" | "revoked";

export type BankEntry = {
  id: string;
  days: number;
  source: BankSource;
  status: BankEntryStatus;
  createdAt: string;
  appliedAt: string | null;
};

export type Bank = {
  /** Days waiting (status banked). */
  banked: number;
  /** Days held by a checkout or an application in flight. */
  reserved: number;
  entries: BankEntry[];
};

export function signupBankReference(userId: string): string {
  return `signup:${userId}`;
}

const ENTRY_COLUMNS = "id, days, source, status, created_at, applied_at";

type EntryRow = { id: string; days: number; source: string; status: string; created_at: string; applied_at: string | null };

function toEntry(row: EntryRow): BankEntry {
  return {
    id: row.id,
    days: row.days,
    source: row.source as BankSource,
    status: row.status as BankEntryStatus,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

/** The bank as a client reads it — the user's own rows (RLS) or the admin's
 *  read of one user. Never throws: an unreadable bank reads as empty. */
export async function readBank(client: UserClient | AdminClient, userId: string): Promise<Bank> {
  try {
    const { data, error } = await client
      .from("day_bank_entries")
      .select(ENTRY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !data) return { banked: 0, reserved: 0, entries: [] };
    const entries = (data as EntryRow[]).map(toEntry);
    return {
      banked: entries.filter((e) => e.status === "banked").reduce((n, e) => n + e.days, 0),
      reserved: entries.filter((e) => e.status === "reserved").reduce((n, e) => n + e.days, 0),
      entries,
    };
  } catch {
    return { banked: 0, reserved: 0, entries: [] };
  }
}

/**
 * Bank days for a user under a reference — once per reference (a retried
 * call finds the entry it made and adds nothing). Returns the entry id, or
 * null when the write failed.
 */
export async function bankDays(
  admin: AdminClient,
  input: { userId: string; days: number; source: BankSource; reference: string; note?: string | null },
): Promise<{ ok: true; entryId: string; created: boolean } | { ok: false; error: string }> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_BANK_DAYS_APPLIED) {
    return { ok: false, error: `Days must be a whole number from 1 to ${MAX_BANK_DAYS_APPLIED}.` };
  }
  const { data, error } = await admin
    .from("day_bank_entries")
    .insert({ user_id: input.userId, days: input.days, source: input.source, reference: input.reference, note: input.note ?? null })
    .select("id")
    .maybeSingle();
  if (!error && data) return { ok: true, entryId: (data as { id: string }).id, created: true };
  if (error?.code === "23505") {
    const { data: existing } = await admin.from("day_bank_entries").select("id").eq("reference", input.reference).maybeSingle();
    if (existing) return { ok: true, entryId: (existing as { id: string }).id, created: false };
  }
  return { ok: false, error: error?.message ?? "Couldn't bank the days." };
}

/** The signup days, once per account. */
export async function ensureSignupBankEntry(admin: AdminClient, userId: string) {
  return bankDays(admin, { userId, days: SIGNUP_BANK_DAYS, source: "signup", reference: signupBankReference(userId) });
}

/** The signup days are NOT owed (the account's email already had a free
 *  period): the banked entry is revoked; an applied one is left alone. */
export async function revokeSignupBankEntry(admin: AdminClient, userId: string, reason: string, now: Date = new Date()): Promise<void> {
  await admin
    .from("day_bank_entries")
    .update({ status: "revoked", revoked_at: now.toISOString(), revoke_reason: reason.slice(0, 200) })
    .eq("reference", signupBankReference(userId))
    .eq("status", "banked");
}

/** Reserve every banked day under a new batch. Returns the batch and the
 *  days it holds (0 = nothing banked; nothing reserved then). */
export async function reserveBank(
  admin: AdminClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; batchId: string; days: number } | { ok: false; error: string }> {
  const batchId = randomUUID();
  const { data, error } = await admin
    .from("day_bank_entries")
    .update({ status: "reserved", batch_id: batchId, reserved_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("status", "banked")
    .select("days");
  if (error) return { ok: false, error: error.message };
  const days = ((data ?? []) as Array<{ days: number }>).reduce((n, r) => n + r.days, 0);
  return { ok: true, batchId, days };
}

/** A batch's entries: applied (with what used them), or back to banked. */
export async function settleBankBatch(
  admin: AdminClient,
  batchId: string,
  outcome: { kind: "applied"; via: "checkout" | "plan_hold"; ref: string } | { kind: "banked" },
  now: Date = new Date(),
): Promise<{ ok: boolean; days: number }> {
  const patch =
    outcome.kind === "applied"
      ? { status: "applied", applied_at: now.toISOString(), applied_via: outcome.via, applied_ref: outcome.ref }
      : { status: "banked", batch_id: null, reserved_at: null };
  const { data, error } = await admin
    .from("day_bank_entries")
    .update(patch)
    .eq("batch_id", batchId)
    .eq("status", "reserved")
    .select("days");
  if (error) {
    console.error(`[day-bank] batch ${batchId} → ${outcome.kind} failed: ${error.message}`);
    return { ok: false, days: 0 };
  }
  return { ok: true, days: ((data ?? []) as Array<{ days: number }>).reduce((n, r) => n + r.days, 0) };
}

/** Reservations nothing settled (a Checkout never completed AND whose
 *  expiry event was lost): back to banked after BANK_RESERVATION_MAX_AGE_MS. */
export async function releaseStaleReservations(admin: AdminClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - BANK_RESERVATION_MAX_AGE_MS).toISOString();
  const { data, error } = await admin
    .from("day_bank_entries")
    .update({ status: "banked", batch_id: null, reserved_at: null })
    .eq("status", "reserved")
    .lt("reserved_at", cutoff)
    .select("id");
  if (error) {
    console.error(`[day-bank] stale reservation sweep failed: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * What a fresh checkout applies (lib/stripe/actions.ts): the signup entry
 * is made or revoked by the one-free-period rule the caller judged, then
 * every banked day is reserved under a batch — when there are at least
 * MIN_BANK_DAYS_AT_CHECKOUT of them. Null = the checkout starts no free
 * period (nothing banked, or too few days: they wait).
 */
export async function prepareCheckoutBank(
  admin: AdminClient,
  userId: string,
  opts: { signupEligible: boolean; now?: Date },
): Promise<{ batchId: string; days: number } | null> {
  const now = opts.now ?? new Date();
  if (opts.signupEligible) await ensureSignupBankEntry(admin, userId);
  else await revokeSignupBankEntry(admin, userId, "not owed: the account's email already had a free period", now);
  const bank = await readBank(admin, userId);
  if (bank.banked < MIN_BANK_DAYS_AT_CHECKOUT) return null;
  const reserved = await reserveBank(admin, userId, now);
  if (!reserved.ok || reserved.days < MIN_BANK_DAYS_AT_CHECKOUT) {
    if (reserved.ok) await settleBankBatch(admin, reserved.batchId, { kind: "banked" }, now);
    return null;
  }
  return { batchId: reserved.batchId, days: Math.min(reserved.days, MAX_BANK_DAYS_APPLIED) };
}

/** The webhook's two answers for a Checkout that carried a batch
 *  (`checkout.session.completed` / `.expired`). */
export async function settleCheckoutBank(
  admin: AdminClient,
  session: Pick<Stripe.Checkout.Session, "id" | "mode" | "metadata">,
  outcome: "completed" | "expired",
): Promise<void> {
  const batchId = session.metadata?.bank_batch;
  if (session.mode !== "subscription" || !batchId) return;
  await settleBankBatch(
    admin,
    batchId,
    outcome === "completed" ? { kind: "applied", via: "checkout", ref: session.id } : { kind: "banked" },
  );
}

export type ApplyBankResult =
  | { ok: true; days: number; holdEndsAt: string | null; note: string }
  | { ok: false; error: string; code?: "nothing_banked" | "no_live_plan" | "refused" };

/**
 * The user's own click: every banked day added to their LIVE plan's time
 * (free period or paid time) through the free-days mechanism — a hold
 * only, never a perks overlay (the days must end in a charge: owner
 * 2026-11-06). With no live plan the caller sends them to a checkout.
 */
export async function applyBankToPlan(
  admin: AdminClient,
  input: { userId: string; tier: PaidTier },
  deps: { stripe?: Stripe; now?: Date } = {},
): Promise<ApplyBankResult> {
  const now = deps.now ?? new Date();
  const reserved = await reserveBank(admin, input.userId, now);
  if (!reserved.ok) return { ok: false, error: reserved.error };
  if (reserved.days < 1) return { ok: false, error: "You have no banked days to apply.", code: "nothing_banked" };
  const days = Math.min(reserved.days, MAX_BANK_DAYS_APPLIED);
  const granted = await grantFreeDays(
    admin,
    {
      userId: input.userId,
      tier: input.tier,
      units: null,
      days,
      grantsCredits: false,
      holdOnly: true,
      source: "day_bank",
      grantedBy: null,
      note: null,
      reference: `day-bank:${reserved.batchId}`,
    },
    { now, ...(deps.stripe ? { stripe: deps.stripe } : {}) },
  );
  if (!granted.ok) {
    await settleBankBatch(admin, reserved.batchId, { kind: "banked" }, now);
    const noPlan = /no live plan|needs a live plan|start a plan/i.test(granted.error);
    return { ok: false, error: granted.error, code: noPlan ? "no_live_plan" : "refused" };
  }
  await settleBankBatch(admin, reserved.batchId, { kind: "applied", via: "plan_hold", ref: granted.grantId }, now);
  return { ok: true, days, holdEndsAt: granted.holdEndsAt, note: granted.note };
}
