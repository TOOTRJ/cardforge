import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { grantFreeDays } from "@/lib/billing/free-days-apply";
import type { PaidTier } from "@/lib/billing/plans";
import { MAX_FREE_DAYS_EXACT, MIN_ADMIN_BANK_DAYS } from "@/lib/billing/free-days";

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
/** A checkout applies the bank as `trial_period_days` (whole days from the
 *  moment it completes; Stripe's floor is one day) — a single banked day
 *  checks out. */
export const MIN_BANK_DAYS_AT_CHECKOUT = 1;
/** A reservation older than this with no settlement is released (Checkout
 *  sessions expire after 24 h). */
export const BANK_RESERVATION_MAX_AGE_MS = 25 * 60 * 60 * 1000;
/** Stripe allows at most 730 days of free time ahead. */
export const MAX_BANK_DAYS_APPLIED = MAX_FREE_DAYS_EXACT;

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

export { MIN_ADMIN_BANK_DAYS };

/** The admin's bank entry for a user, keyed by the form's request id (a
 *  double submit finds the entry it made). */
export function adminBankReference(requestId: string): string {
  return `admin:${requestId}`;
}

/** The admin's read of one user's bank — every column (the note, the
 *  reference, how and when an entry was applied or revoked). Service role. */
export type BankEntryDetail = BankEntry & {
  reference: string | null;
  note: string | null;
  appliedVia: "checkout" | "plan_hold" | null;
  appliedRef: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

export async function listBankEntriesForAdmin(
  admin: AdminClient,
  userId: string,
): Promise<{ rows: BankEntryDetail[]; loadError: boolean }> {
  const { data, error } = await admin
    .from("day_bank_entries")
    .select("id, days, source, status, created_at, applied_at, reference, note, applied_via, applied_ref, revoked_at, revoke_reason")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error(`[day-bank] admin read for ${userId} failed:`, error.message);
    return { rows: [], loadError: true };
  }
  type Row = EntryRow & {
    reference: string | null;
    note: string | null;
    applied_via: string | null;
    applied_ref: string | null;
    revoked_at: string | null;
    revoke_reason: string | null;
  };
  return {
    rows: ((data ?? []) as Row[]).map((row) => ({
      ...toEntry(row),
      reference: row.reference,
      note: row.note,
      appliedVia: row.applied_via === "checkout" || row.applied_via === "plan_hold" ? row.applied_via : null,
      appliedRef: row.applied_ref,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
    })),
    loadError: false,
  };
}

/** Take a BANKED entry back (an admin's revoke). An entry already reserved,
 *  applied or revoked is left alone and named. */
export async function revokeBankedEntry(
  admin: AdminClient,
  entryId: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ ok: true; days: number; userId: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("day_bank_entries")
    .update({ status: "revoked", revoked_at: now.toISOString(), revoke_reason: reason.slice(0, 200) })
    .eq("id", entryId)
    .eq("status", "banked")
    .select("days, user_id")
    .maybeSingle();
  if (error) return { ok: false, error: `Couldn't revoke the days: ${error.message}` };
  if (!data) return { ok: false, error: "Those days aren't banked any more (applied, being applied, or already revoked)." };
  const row = data as { days: number; user_id: string };
  return { ok: true, days: row.days, userId: row.user_id };
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
): Promise<{ ok: true; entryId: string; created: boolean; days: number } | { ok: false; error: string }> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_BANK_DAYS_APPLIED) {
    return { ok: false, error: `Days must be a whole number from 1 to ${MAX_BANK_DAYS_APPLIED}.` };
  }
  const { data, error } = await admin
    .from("day_bank_entries")
    .insert({ user_id: input.userId, days: input.days, source: input.source, reference: input.reference, note: input.note ?? null })
    .select("id")
    .maybeSingle();
  if (!error && data) return { ok: true, entryId: (data as { id: string }).id, created: true, days: input.days };
  if (error?.code === "23505") {
    const { data: existing } = await admin.from("day_bank_entries").select("id, days").eq("reference", input.reference).maybeSingle();
    if (existing) {
      const row = existing as { id: string; days: number };
      return { ok: true, entryId: row.id, created: false, days: row.days };
    }
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

/** Reserve the banked days under a new batch — oldest entries first, up to
 *  MAX_BANK_DAYS_APPLIED (Stripe's 730-day trial limit); an entry that
 *  would take the batch past it STAYS BANKED for a later application, never
 *  reserved and then applied short (independent check P2). Returns the
 *  batch and the days it holds (0 = nothing banked; nothing reserved then). */
export async function reserveBank(
  admin: AdminClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; batchId: string; days: number } | { ok: false; error: string }> {
  const { data: banked, error: readError } = await admin
    .from("day_bank_entries")
    .select("id, days")
    .eq("user_id", userId)
    .eq("status", "banked")
    .order("created_at", { ascending: true });
  if (readError) return { ok: false, error: readError.message };
  const ids: string[] = [];
  let total = 0;
  for (const row of (banked ?? []) as Array<{ id: string; days: number }>) {
    if (total + row.days > MAX_BANK_DAYS_APPLIED) continue;
    ids.push(row.id);
    total += row.days;
  }
  if (ids.length === 0) return { ok: true, batchId: randomUUID(), days: 0 };
  const batchId = randomUUID();
  const { data, error } = await admin
    .from("day_bank_entries")
    .update({ status: "reserved", batch_id: batchId, reserved_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("status", "banked")
    .in("id", ids)
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
  // "Applied" also takes rows a stale-reservation release put back to
  // `banked` with their batch kept (independent check P3-4): a Checkout
  // completed after the release — Stripe retries an event up to three days
  // — must still spend what it applied, never leave it to be applied twice.
  const { data, error } = await admin
    .from("day_bank_entries")
    .update(patch)
    .eq("batch_id", batchId)
    .in("status", outcome.kind === "applied" ? ["reserved", "banked"] : ["reserved"])
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
  // The batch stays on the row: a late `completed` for its session still
  // finds and spends it (settleBankBatch takes banked rows by batch).
  const { data, error } = await admin
    .from("day_bank_entries")
    .update({ status: "banked", reserved_at: null })
    .eq("status", "reserved")
    .lt("reserved_at", cutoff)
    .select("id");
  if (error) {
    console.error(`[day-bank] stale reservation sweep failed: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

/** The Checkout session a batch waits on, stamped once Stripe made it, so
 *  a later checkout can expire a session the user backed out of (below). */
export async function stampBankBatchSession(admin: AdminClient, batchId: string, sessionId: string): Promise<void> {
  const { error } = await admin
    .from("day_bank_entries")
    .update({ applied_ref: sessionId })
    .eq("batch_id", batchId)
    .eq("status", "reserved");
  if (error) console.warn(`[day-bank] batch ${batchId}: session stamp failed: ${error.message}`);
}

/**
 * A Checkout the user backed out of keeps its session OPEN for 24 h, and
 * the days it reserved with it (independent check P1-2): the next checkout
 * would have sold WITHOUT the free period. Every reserved batch of the user
 * that names a session is expired at Stripe (an already-complete or expired
 * session is left alone — its webhook settles it) and its days go back to
 * the bank before the new checkout reserves afresh. Returns the batches
 * reclaimed.
 */
export async function reclaimOpenCheckouts(admin: AdminClient, stripe: Pick<Stripe, "checkout">, userId: string, now: Date = new Date()): Promise<number> {
  const { data, error } = await admin
    .from("day_bank_entries")
    .select("batch_id, applied_ref")
    .eq("user_id", userId)
    .eq("status", "reserved")
    .not("applied_ref", "is", null);
  if (error || !data) return 0;
  const batches = new Map<string, string>();
  for (const row of data as Array<{ batch_id: string | null; applied_ref: string | null }>) {
    if (row.batch_id && row.applied_ref) batches.set(row.batch_id, row.applied_ref);
  }
  let reclaimed = 0;
  for (const [batchId, sessionId] of batches) {
    let released = true;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
      else if (session.status === "complete") released = false; // its webhook spends the batch
    } catch (error) {
      console.warn(`[day-bank] batch ${batchId}: could not expire ${sessionId}:`, error instanceof Error ? error.message : error);
    }
    if (!released) continue;
    const settled = await settleBankBatch(admin, batchId, { kind: "banked" }, now);
    if (settled.ok) reclaimed += 1;
  }
  return reclaimed;
}

/**
 * What a fresh checkout applies (lib/stripe/actions.ts): the signup entry
 * is made or revoked by the one-free-period rule the caller judged (made
 * when owed, revoked only on an AFFIRMATIVE "already had one" — a check
 * that could not run refuses the checkout instead, never revokes), then
 * every banked day is reserved under a batch — when there are at least
 * MIN_BANK_DAYS_AT_CHECKOUT of them. Null = the checkout starts no free
 * period from the bank: nothing banked, too few days, or a comp already
 * holds the first charge past the bank's end (`skipIfEndsBefore`: the days
 * stay banked and the user applies them on top later — never spent for
 * nothing, independent check P1-3).
 */
export async function prepareCheckoutBank(
  admin: AdminClient,
  userId: string,
  opts: { signupEligible: boolean; now?: Date; skipIfEndsBefore?: number | null },
): Promise<{ batchId: string; days: number } | null> {
  const now = opts.now ?? new Date();
  if (opts.signupEligible) await ensureSignupBankEntry(admin, userId);
  else await revokeSignupBankEntry(admin, userId, "not owed: the account's email already had a free period", now);
  const bank = await readBank(admin, userId);
  if (bank.banked < MIN_BANK_DAYS_AT_CHECKOUT) return null;
  if (opts.skipIfEndsBefore != null && Math.floor(now.getTime() / 1000) + bank.banked * 86_400 <= opts.skipIfEndsBefore) return null;
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
  const days = reserved.days; // ≤ MAX_BANK_DAYS_APPLIED: reserveBank leaves the rest banked
  let granted: Awaited<ReturnType<typeof grantFreeDays>>;
  try {
    granted = await grantFreeDays(
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
  } catch (error) {
    // A thrown client or network error: the days go back, the click fails
    // plainly (never a batch stuck `reserved`).
    await settleBankBatch(admin, reserved.batchId, { kind: "banked" }, now);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't apply the days. Try again.", code: "refused" };
  }
  if (!granted.ok) {
    await settleBankBatch(admin, reserved.batchId, { kind: "banked" }, now);
    const noPlan = /no live plan|needs a live plan|start a plan/i.test(granted.error);
    return { ok: false, error: granted.error, code: noPlan ? "no_live_plan" : "refused" };
  }
  await settleBankBatch(admin, reserved.batchId, { kind: "applied", via: "plan_hold", ref: granted.grantId }, now);
  return { ok: true, days, holdEndsAt: granted.holdEndsAt, note: granted.note };
}
