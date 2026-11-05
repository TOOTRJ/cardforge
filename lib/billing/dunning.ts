// ---------------------------------------------------------------------------
// Dunning grace (billing audit 2026-11-05, P1-3; owner 2026-11-05: "go with
// your recommendation for the length").
//
// A renewal that fails flips the subscription to `past_due` at once, and
// Stripe's Smart Retries then try the card again for up to two weeks. Until
// this the app read `past_due` as "no perks": a soft decline the retry
// recovered two days later still cost the customer two days as Free
// (watermarked downloads, the 50-card cap) with nobody told.
//
// The rule: a `past_due` subscription keeps its paid perks for
// DUNNING_GRACE_DAYS from the moment the failure was first seen
// (`profiles.payment_failed_at`, written by the Stripe sync, migration 0174),
// which covers Stripe's retry window. `unpaid` (the retries are exhausted)
// and `incomplete` (never paid) get no grace. Credits are NOT granted during
// the grace: the month's allotment lands with the invoice that finally pays
// (invoice.paid → the idempotent refill), as before.
//
// ONE rule in two forms: this module (the app) and
// public.subscription_perks_on() (0174: card_capacity_for, owner_export_stamp,
// viewer_is_pro). Change both together — tests/unit/billing/dunning.test.ts
// holds the SQL to the constant. Client-safe: no imports.
// ---------------------------------------------------------------------------

export const DUNNING_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DunningProfile = {
  subscription_status: string | null;
  /** When the sync first saw the subscription's payment broken (0174). */
  payment_failed_at?: string | null;
};

/** The instant the grace ends, or null when the profile is not in one
 *  (not past_due, no failure stamp, or the grace has already run out). */
export function dunningGraceUntil(profile: DunningProfile, now: Date = new Date()): string | null {
  if (profile.subscription_status !== "past_due") return null;
  const failedAt = profile.payment_failed_at ? new Date(profile.payment_failed_at) : null;
  if (!failedAt || Number.isNaN(failedAt.getTime())) return null;
  const until = new Date(failedAt.getTime() + DUNNING_GRACE_DAYS * DAY_MS);
  return until > now ? until.toISOString() : null;
}

/** Whether a past_due subscription still carries its paid perks. */
export function inDunningGrace(profile: DunningProfile, now: Date = new Date()): boolean {
  return dunningGraceUntil(profile, now) != null;
}
