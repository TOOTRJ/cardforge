import { describe, expect, it } from "vitest";
import {
  FREE_DAYS_UNIT_SECONDS,
  MAX_FREE_DAY_UNITS,
  activeOverlayOf,
  freeDaysNote,
  planFreeDays,
  planRevoke,
  revokeNote,
  type FreeDaysPlan,
} from "@/lib/billing/free-days";
import { MAX_TRIAL_SECONDS, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";

// ---------------------------------------------------------------------------
// Free 30 days (owner 2026-11-05) — the pure decision, one scenario per
// rule. The owner's example: Pro started Nov 5 (paid through Dec 5); free
// 30 days given Nov 10 → ADDED to the paid time: the next charge lands
// Jan 4 (Dec 5 + 30 d), exact to the second.
// ---------------------------------------------------------------------------

const DAY = 86_400;
const NOW = new Date("2026-11-10T15:14:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const DEC_5 = Math.floor(Date.parse("2026-12-05T09:00:00Z") / 1000);
const JAN_4 = DEC_5 + 30 * DAY;
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const name = (t: "plus" | "pro") => (t === "plus" ? "Plus" : "Pro");

const free = { subscription_status: null, subscription_tier: "free", comp_tier: null, comp_expires_at: null };
const activeSub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  items: { data: [{ current_period_end: DEC_5 }] },
  metadata: {},
  ...over,
});

function applied(plan: FreeDaysPlan): Exclude<FreeDaysPlan, { kind: "refused" }> {
  if (plan.kind === "refused") throw new Error(plan.error);
  return plan;
}

describe("the owner's example — a live, renewing plan: the days are ADDED to the paid time", () => {
  const profile = { ...free, subscription_status: "active", subscription_tier: "pro" };

  it("Pro paid through Dec 5, 30 free days on Nov 10 → trial_end Dec 5 + 30 d = Jan 4, exact to the second", () => {
    const plan = planFreeDays({ profile, sub: activeSub(), subscribedTier: "pro", tier: "pro", units: 1, now: NOW });
    expect(plan).toEqual({
      kind: "hold",
      tier: "pro",
      startsAt: DEC_5,
      endsAt: JAN_4,
      subscriptionId: "sub_1",
      trialEnd: JAN_4,
      beforeComp: String(DEC_5),
      overlay: { comp_tier: "pro", comp_expires_at: iso(JAN_4) },
      was: "active",
    });
    expect(JAN_4 - DEC_5).toBe(30 * FREE_DAYS_UNIT_SECONDS / 30);
    expect(iso(JAN_4)).toBe("2027-01-04T09:00:00.000Z");
    expect(freeDaysNote(applied(plan), name)).toBe(
      "Their Stripe plan's next charge moves from Dec 5, 2026, 9:00 AM UTC to Jan 4, 2027, 9:00 AM UTC — the free days are added to the time they paid for.",
    );
  });

  it("two units add 60 days; a second grant stacks on the moved end (the metadata keeps the FIRST pre-hold end)", () => {
    const two = applied(planFreeDays({ profile, sub: activeSub(), subscribedTier: "pro", tier: "pro", units: 2, now: NOW }));
    expect(two.kind === "hold" && two.trialEnd).toBe(DEC_5 + 60 * DAY);
    // After the first hold Stripe reads trialing to Jan 4, metadata = Dec 5.
    const held = activeSub({ status: "trialing", trial_end: JAN_4, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } });
    const again = applied(
      planFreeDays({ profile: { ...profile, comp_tier: "pro", comp_expires_at: iso(JAN_4) }, sub: held, subscribedTier: "pro", tier: "pro", units: 1, now: NOW }),
    );
    expect(again).toMatchObject({ kind: "hold", startsAt: JAN_4, trialEnd: JAN_4 + 30 * DAY, beforeComp: String(DEC_5), was: "trialing" });
  });

  it("a card-backed 7-day trial: the trial end moves by the days; the pre-hold end is its own", () => {
    const trialEnd = nowSec + 5 * DAY;
    const sub = activeSub({ status: "trialing", trial_end: trialEnd });
    const plan = applied(planFreeDays({ profile: { ...profile, subscription_status: "trialing" }, sub, subscribedTier: "pro", tier: "pro", units: 1, now: NOW }));
    expect(plan).toMatchObject({ kind: "hold", startsAt: trialEnd, trialEnd: trialEnd + 30 * DAY, beforeComp: String(trialEnd), was: "trialing" });
    expect(freeDaysNote(plan, name)).toMatch(/^Their Stripe trial now ends on .* instead of .*; the first charge lands then\.$/);
  });

  it("an ANNUAL plan: the renewal moves by the days all the same (one primitive)", () => {
    const yearEnd = nowSec + 200 * DAY;
    const plan = applied(planFreeDays({ profile, sub: activeSub({ items: { data: [{ current_period_end: yearEnd }] } }), subscribedTier: "pro", tier: "pro", units: 1, now: NOW }));
    expect(plan).toMatchObject({ kind: "hold", trialEnd: yearEnd + 30 * DAY });
  });

  it("a HIGHER tier on a Plus plan: the hold moves the charge, and the overlay carries Pro's perks until it", () => {
    const plan = applied(planFreeDays({ profile: { ...profile, subscription_tier: "plus" }, sub: activeSub(), subscribedTier: "plus", tier: "pro", units: 1, now: NOW }));
    expect(plan).toMatchObject({ kind: "hold", overlay: { comp_tier: "pro", comp_expires_at: iso(JAN_4) } });
  });

  it("a grant BELOW the plan paid for (Plus days for a Pro payer): recorded, changes nothing", () => {
    const plan = planFreeDays({ profile, sub: activeSub(), subscribedTier: "pro", tier: "plus", units: 1, now: NOW });
    expect(plan).toEqual({ kind: "below_plan", tier: "plus", subscribedTier: "pro" });
    expect(freeDaysNote(applied(plan), name)).toBe("Plus is below the Pro they pay for: recorded, but it changes nothing and grants no credits.");
  });

  it("the tier paid for is Stripe's answer first, the profile's copy second, else refused", () => {
    expect(planFreeDays({ profile: { ...profile, subscription_tier: "plus" }, sub: activeSub(), subscribedTier: "pro", tier: "plus", units: 1, now: NOW }).kind).toBe("below_plan");
    expect(planFreeDays({ profile: { ...profile, subscription_tier: "plus" }, sub: activeSub(), subscribedTier: null, tier: "plus", units: 1, now: NOW }).kind).toBe("hold");
    expect(planFreeDays({ profile: { ...profile, subscription_tier: "free" }, sub: activeSub(), subscribedTier: null, tier: "plus", units: 1, now: NOW })).toMatchObject({
      kind: "refused",
      error: expect.stringMatching(/which plan/),
    });
  });

  it("past Stripe's 730-day trial limit: refused, nothing moves", () => {
    const far = activeSub({ status: "trialing", trial_end: nowSec + MAX_TRIAL_SECONDS - 10 * DAY });
    expect(planFreeDays({ profile, sub: far, subscribedTier: "pro", tier: "pro", units: 1, now: NOW })).toMatchObject({
      kind: "refused",
      error: expect.stringMatching(/730 days/),
    });
  });

  it("a plan managed by a schedule (a pending downgrade): refused with the way out", () => {
    expect(planFreeDays({ profile, sub: activeSub({ schedule: "sub_sched_1" }), subscribedTier: "pro", tier: "pro", units: 1, now: NOW })).toMatchObject({
      kind: "refused",
      error: expect.stringMatching(/scheduled change/),
    });
  });

  it("a period end in the past (a renewal in flight) or missing: refused", () => {
    expect(planFreeDays({ profile, sub: activeSub({ items: { data: [{ current_period_end: nowSec - 60 }] } }), subscribedTier: "pro", tier: "pro", units: 1, now: NOW })).toMatchObject({ kind: "refused", error: expect.stringMatching(/renewing right now/) });
    expect(planFreeDays({ profile, sub: activeSub({ items: { data: [] } }), subscribedTier: "pro", tier: "pro", units: 1, now: NOW })).toMatchObject({ kind: "refused", error: expect.stringMatching(/no period end/) });
  });
});

describe("no live plan: the overlay, from the later of now and its current end", () => {
  it("a free account: Plus until now + 30 d, exact", () => {
    const plan = planFreeDays({ profile: free, sub: null, subscribedTier: null, tier: "plus", units: 1, now: NOW });
    expect(plan).toEqual({
      kind: "overlay",
      tier: "plus",
      startsAt: nowSec,
      endsAt: nowSec + 30 * DAY,
      overlay: { comp_tier: "plus", comp_expires_at: iso(nowSec + 30 * DAY) },
      why: "no_plan",
    });
    expect(freeDaysNote(applied(plan), name)).toBe("Plus until Dec 10, 2026, 3:14 PM UTC (no Stripe subscription: a perks overlay).");
  });

  it("stacks on a running overlay (from ITS end), and carries the HIGHER tier for the whole stretch", () => {
    const end = nowSec + 10 * DAY;
    const profile = { ...free, comp_tier: "pro", comp_expires_at: iso(end) };
    expect(planFreeDays({ profile, sub: null, subscribedTier: null, tier: "plus", units: 1, now: NOW })).toMatchObject({
      kind: "overlay",
      startsAt: end,
      endsAt: end + 30 * DAY,
      overlay: { comp_tier: "pro", comp_expires_at: iso(end + 30 * DAY) },
    });
    // An EXPIRED overlay is no overlay: from now, the new tier.
    const expired = { ...free, comp_tier: "pro", comp_expires_at: iso(nowSec - 1) };
    expect(planFreeDays({ profile: expired, sub: null, subscribedTier: null, tier: "plus", units: 1, now: NOW })).toMatchObject({ startsAt: nowSec, overlay: { comp_tier: "plus" } });
  });

  it("a lapsed (canceled) subscription on the profile is no live plan", () => {
    const plan = planFreeDays({ profile: { ...free, subscription_status: "canceled", subscription_tier: "plus" }, sub: activeSub({ status: "canceled" }), subscribedTier: "plus", tier: "plus", units: 1, now: NOW });
    expect(plan).toMatchObject({ kind: "overlay", why: "no_plan", startsAt: nowSec });
  });

  it("a CANCELLED plan still running: the days start when it ends (nothing is charged)", () => {
    const profile = { ...free, subscription_status: "active", subscription_tier: "plus" };
    const plan = applied(planFreeDays({ profile, sub: activeSub({ cancel_at_period_end: true }), subscribedTier: "plus", tier: "plus", units: 1, now: NOW }));
    expect(plan).toMatchObject({ kind: "overlay", why: "plan_ending", planEndsAt: DEC_5, startsAt: DEC_5, endsAt: JAN_4 });
    // The portal's dated cancel: that date.
    const dated = applied(planFreeDays({ profile, sub: activeSub({ cancel_at: DEC_5 - DAY }), subscribedTier: "plus", tier: "plus", units: 1, now: NOW }));
    expect(dated).toMatchObject({ kind: "overlay", planEndsAt: DEC_5 - DAY, startsAt: DEC_5 - DAY });
    expect(freeDaysNote(plan, name)).toMatch(/^Their plan is cancelled and ends on .*; the free days run from .* to .* as a perks overlay \(nothing is charged\)\.$/);
  });

  it("a PAST-DUE plan keeps its own dates: a perks overlay from now", () => {
    const plan = applied(planFreeDays({ profile: { ...free, subscription_status: "past_due", subscription_tier: "plus" }, sub: activeSub({ status: "past_due" }), subscribedTier: "plus", tier: "plus", units: 1, now: NOW }));
    expect(plan).toMatchObject({ kind: "overlay", why: "delinquent", startsAt: nowSec });
    expect(freeDaysNote(plan, name)).toMatch(/past due and keeps its own dates/);
  });
});

describe("staff (no end) and the limits", () => {
  it("no end: an account with NO Stripe subscription only — the overlay with no expiry", () => {
    const plan = planFreeDays({ profile: free, sub: null, subscribedTier: null, tier: "pro", units: null, now: NOW });
    expect(plan).toEqual({ kind: "overlay", tier: "pro", startsAt: nowSec, endsAt: null, overlay: { comp_tier: "pro", comp_expires_at: null }, why: "staff" });
    expect(freeDaysNote(applied(plan), name)).toBe("Pro with no end date (staff). No Stripe subscription is involved.");
    for (const status of ["active", "trialing", "past_due"]) {
      expect(planFreeDays({ profile: { ...free, subscription_status: status, subscription_tier: "plus" }, sub: activeSub({ status }), subscribedTier: "plus", tier: "pro", units: null, now: NOW })).toMatchObject({
        kind: "refused",
        error: expect.stringMatching(/staff/),
      });
    }
  });

  it("dated days on an open-ended account, or no end twice: refused", () => {
    const staff = { ...free, comp_tier: "pro", comp_expires_at: null };
    expect(planFreeDays({ profile: staff, sub: null, subscribedTier: null, tier: "plus", units: 1, now: NOW })).toMatchObject({ kind: "refused", error: expect.stringMatching(/Revoke it first/) });
    expect(planFreeDays({ profile: staff, sub: null, subscribedTier: null, tier: "plus", units: null, now: NOW })).toMatchObject({ kind: "refused", error: expect.stringMatching(/already has open-ended/) });
  });

  it("units are whole, 1 … MAX; an admin account is refused", () => {
    for (const units of [0, 1.5, MAX_FREE_DAY_UNITS + 1]) {
      expect(planFreeDays({ profile: free, sub: null, subscribedTier: null, tier: "plus", units, now: NOW }).kind).toBe("refused");
    }
    expect(planFreeDays({ profile: { ...free, is_admin: true }, sub: null, subscribedTier: null, tier: "plus", units: 1, now: NOW })).toMatchObject({ kind: "refused", error: expect.stringMatching(/admin/) });
  });

  it("activeOverlayOf: a tier with a future end or none; nothing for an expired or unreadable end", () => {
    expect(activeOverlayOf({ comp_tier: "pro", comp_expires_at: null }, nowSec)).toEqual({ tier: "pro", endSec: null });
    expect(activeOverlayOf({ comp_tier: "plus", comp_expires_at: iso(nowSec + 1) }, nowSec)).toEqual({ tier: "plus", endSec: nowSec + 1 });
    expect(activeOverlayOf({ comp_tier: "plus", comp_expires_at: iso(nowSec) }, nowSec)).toBeNull();
    expect(activeOverlayOf({ comp_tier: "plus", comp_expires_at: "nope" }, nowSec)).toBeNull();
    expect(activeOverlayOf({ comp_tier: "gold", comp_expires_at: null }, nowSec)).toBeNull();
  });
});

describe("revoking the newest grant", () => {
  const grant = { id: "g1", tier: "plus" as const, units: 1, ends_at: iso(nowSec + 20 * DAY), status: "applied" };

  it("an overlay with the grant's 30 days left and 20 to go: cleared (the days came from it)", () => {
    const profile = { ...free, comp_tier: "plus", comp_expires_at: iso(nowSec + 20 * DAY) };
    const plan = planRevoke({ grant, profile, sub: null, otherGrants: [], now: NOW });
    expect(plan).toEqual({ kind: "revoke", overlay: { comp_tier: null, comp_expires_at: null }, trial: null });
    expect(revokeNote(plan as Extract<typeof plan, { kind: "revoke" }>, name)).toBe("Their complimentary access is cleared.");
  });

  it("stacked grants: the end moves back by this grant's days, the tier falls to the other live grant's", () => {
    const older = { id: "g0", tier: "plus" as const, units: 1, ends_at: iso(nowSec + 20 * DAY), status: "applied" };
    const pro = { ...grant, tier: "pro" as const, ends_at: iso(nowSec + 50 * DAY) };
    const profile = { ...free, comp_tier: "pro", comp_expires_at: iso(nowSec + 50 * DAY) };
    expect(planRevoke({ grant: pro, profile, sub: null, otherGrants: [older], now: NOW })).toEqual({
      kind: "revoke",
      overlay: { comp_tier: "plus", comp_expires_at: iso(nowSec + 20 * DAY) },
      trial: null,
    });
  });

  it("a HOLD: the Stripe trial at the overlay's end moves back the same way — never before its pre-hold end", () => {
    const profile = { ...free, subscription_status: "trialing", subscription_tier: "pro", comp_tier: "pro", comp_expires_at: iso(JAN_4) };
    const sub = activeSub({ status: "trialing", trial_end: JAN_4, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } });
    const g = { ...grant, tier: "pro" as const, ends_at: iso(JAN_4) };
    expect(planRevoke({ grant: g, profile, sub, otherGrants: [], now: NOW })).toEqual({
      kind: "revoke",
      overlay: { comp_tier: null, comp_expires_at: null },
      // Back on Dec 5 — the end it had before any hold; the key is cleared.
      trial: { subscriptionId: "sub_1", trialEnd: DEC_5, beforeComp: "" },
    });
    // Two units held it to Feb 3; revoking ONE leaves Jan 4 and keeps the key.
    const feb3 = JAN_4 + 30 * DAY;
    const twoHeld = activeSub({ status: "trialing", trial_end: feb3, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } });
    expect(planRevoke({ grant: { ...g, ends_at: iso(feb3) }, profile: { ...profile, comp_expires_at: iso(feb3) }, sub: twoHeld, otherGrants: [{ ...g, id: "g0" }], now: NOW })).toMatchObject({
      overlay: { comp_tier: "pro", comp_expires_at: iso(JAN_4) },
      trial: { trialEnd: JAN_4, beforeComp: String(DEC_5) },
    });
  });

  it("a hold whose pre-hold end has PASSED: the trial ends now and is charged (owner answer 3)", () => {
    const later = new Date((DEC_5 + 2 * DAY) * 1000);
    const profile = { ...free, subscription_status: "trialing", subscription_tier: "pro", comp_tier: "pro", comp_expires_at: iso(JAN_4) };
    const sub = activeSub({ status: "trialing", trial_end: JAN_4, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } });
    const plan = planRevoke({ grant: { ...grant, tier: "pro", ends_at: iso(JAN_4) }, profile, sub, otherGrants: [], now: later });
    expect(plan).toMatchObject({ trial: { trialEnd: "now", beforeComp: "" } });
    expect(revokeNote(plan as Extract<typeof plan, { kind: "revoke" }>, name)).toMatch(/ends now and is charged/);
  });

  it("the overlay gone (its write failed) but the trial held at the GRANT's end: the trial still moves back", () => {
    const profile = { ...free, subscription_status: "trialing", subscription_tier: "pro", comp_tier: null, comp_expires_at: null };
    const sub = activeSub({ status: "trialing", trial_end: JAN_4, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } });
    expect(planRevoke({ grant: { ...grant, tier: "pro", ends_at: iso(JAN_4) }, profile, sub, otherGrants: [], now: NOW })).toEqual({
      kind: "revoke",
      overlay: { comp_tier: null, comp_expires_at: null },
      trial: { subscriptionId: "sub_1", trialEnd: DEC_5, beforeComp: "" },
    });
  });

  it("a trial NOT at the overlay's end (the plan's own trial outlasts it) is left alone", () => {
    const profile = { ...free, subscription_status: "trialing", subscription_tier: "plus", comp_tier: "plus", comp_expires_at: iso(nowSec + 20 * DAY) };
    const sub = activeSub({ status: "trialing", trial_end: nowSec + 40 * DAY, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(nowSec + 40 * DAY) } });
    expect(planRevoke({ grant, profile, sub, otherGrants: [], now: NOW })).toMatchObject({ trial: null });
  });

  it("an open-ended (staff) grant: the overlay falls back to the other live grants, else clears", () => {
    const staff = { ...grant, units: null, ends_at: null };
    const profile = { ...free, comp_tier: "pro", comp_expires_at: null };
    expect(planRevoke({ grant: staff, profile, sub: null, otherGrants: [], now: NOW })).toMatchObject({ overlay: { comp_tier: null, comp_expires_at: null } });
    const other = { id: "g0", tier: "plus" as const, units: 1, ends_at: iso(nowSec + 9 * DAY), status: "applied" };
    expect(planRevoke({ grant: staff, profile, sub: null, otherGrants: [other], now: NOW })).toMatchObject({ overlay: { comp_tier: "plus", comp_expires_at: iso(nowSec + 9 * DAY) } });
  });

  it("only an applied grant", () => {
    expect(planRevoke({ grant: { ...grant, status: "revoked" }, profile: free, sub: null, otherGrants: [], now: NOW })).toMatchObject({ kind: "refused" });
  });
});
