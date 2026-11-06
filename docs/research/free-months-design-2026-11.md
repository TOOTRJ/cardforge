# Free 30 days: one mechanism for comps and referral rewards (design, 2026-11-05, revised after the owner's answers)

Owner decisions this answers (2026-11-05): comps are given in whole months
only; a comp "should work the same as the free month for referrals"; look
for shared code or a better way; an admin switch turns the referral reward
on or off; the reward kind must be easy to change later (a month today,
credits or something else tomorrow); users see their referral stats.

## 1. What exists today (three mechanisms for one idea)

| Piece | Where | How it gives "free time" |
|---|---|---|
| Admin comp | `profiles.comp_tier` + `comp_expires_at` (a date, or none) | A perks overlay; the refill cron grants the tier's credits every calendar month the comp is live. #688 (merged) also touches Stripe: a card-backed trial's end is moved to the comp's end; an active plan gets a pro-rated balance credit; a cancelled plan is left alone. #726 (draft) swaps the balance credit for a 100 %-off coupon on monthly plans with a 15-day round-up, a plan-switch lock and a scheduled-downgrade release. |
| Referral: the friend | #689 (draft): `profiles.referral_plus_until` (a second overlay, kept apart so a comp edit can't wipe it) + ONE 30-credit grant at the start | A 30-day Plus overlay that starts after whatever runs longest. |
| Referral: a paying referrer | #689: a customer-balance credit of one month of their own price | Stripe spends it on the next invoice; on an annual plan a twelfth. |

Three overlays, two credit rules (calendar-month for comps, once-at-start for
referrals), three Stripe shapes (hold / credit / coupon), day-level maths in
two places (the 15-day round-up, `periodCreditCents`).

## 2. The proposal: a "free month" is one thing

**Vocabulary.** A *free month* = one whole month of a paid tier (Plus or Pro)
with that tier's normal monthly AI credits — nothing more (owner 2026-11-05).
Comps and referral rewards both hand out N free months. Day-level comps,
pro-rated credits and the 15-day rule go away.

**One grant function.** `grantFreeMonths({ userId, tier, months, source })`
— `source` is `comp` (an admin, with a note), `referral_friend`,
`referral_referrer`, and later `promo`. Every caller goes through it; it
decides, from the user's live subscription, which of FOUR shapes the months
take, and records the grant in one table, `plan_grants` (user, tier, months,
source, who/what granted it, when, how it was applied, status). The admin
comp action, the referral reward and any future promotion are callers, not
mechanisms.

**The four shapes** (decided once, in `lib/billing/free-months.ts`):

| The user has | N free months become | Credits |
|---|---|---|
| No live subscription (free, a lapsed plan, a cancelled plan still running) | The overlay: `profiles.comp_tier` / `comp_expires_at` extended by N months from the later of now, the overlay's current end, and a cancelled plan's end date. (`referral_plus_until` is NOT added: one overlay, and a comp edit can't wipe a referral month because the admin form edits the overlay only through the same grant function, which adds months rather than setting a date.) | One allotment per month of the grant, when that month starts: key `grant:<id>:<k>`, the cron grants `months started − allotments granted` (so a 1-month referral starting Nov 20 is 30 credits once, never a second on Dec 1; a 3-month comp is three, 30 days apart). Replaces "a comp is owed its tier every calendar month". |
| A MONTHLY plan, active and renewing | #726's coupon, in month units: 100 % off, `repeating`, `duration_in_months` = N. The next N invoices are $0 and say "PipGlyph complimentary"; the one after is charged as usual. No round-up, no claw-back, nothing pro-rated. Plan switches are refused while the coupon runs (#726's lock — the owner's 2026-11-02 decision; the lock is simpler with no tail: it ends when the coupon ends). | The $0 invoice's own refill (the plan's allotment lands with each invoice, as a paid one would — PR C's rule). |
| An ANNUAL plan, active and renewing | A balance credit of N/12 of the annual price (#688's maths, only ever whole twelfths), spent at the next annual renewal. A coupon would free the whole year. | The cron's monthly allotment, as today for annual plans. |
| A card-backed TRIAL | The trial's end moves N months (#688's hold, unchanged); the first charge lands then. | One allotment per month, as the overlay. |

A grant BELOW the user's paid tier (a Plus month for a Pro payer) applies as
an overlay only, which changes nothing — the admin's toast says so; a
referral reward for such a user is still recorded (it counts toward caps)
and the friend's side is unaffected.

**Admin UI.** The comp form asks for a tier and a number of months (1–12)
plus a note, and says what will happen before Save ("3 free monthly
invoices — the next charge lands on …" / "Plus until …" / "the trial now
ends on …"). Existing dated comps show as "N months left"; existing
open-ended comps (today: a handful of free accounts) are the one open
question below.

**Referral settings (admin switch + a configurable reward).** One
`site_settings` row, `referrals`:

```
{ enabled: true,
  friend:   { kind: "free_months", tier: "plus", months: 1 },
  referrer: { kind: "free_months", tier: "own", months: 1 },
  caps: { perMonth: 3, lifetime: 12 } }
```

`kind` may later be `"credits"` (`{ kind: "credits", amount: 20 }`) or a
new kind; the reward code reads the setting at grant time and the Refer-a-
friend page and emails read the same row for their copy, so changing the
reward is an admin edit, not a deploy. `enabled: false` hides the page's
link, refuses new rewards, and leaves already-granted months alone. An
admin panel under `/admin/users` (beside the Referrals stats panel #691
built) edits it with a confirm step.

**User stats** stay as #691 built them: `/dashboard/referrals` with the link,
the four numbers, the friends table and the status badges — re-pointed at
`plan_grants` for "what you earned".

## 3. What this removes or avoids

- The 15-day round-up and its tail (the lock that outlives the comp, the
  cleared-tail rule, the union rule, the 45-day storefront window — most of
  #726's special cases).
- `periodCreditCents` for monthly plans (kept for annual, whole twelfths).
- `profiles.referral_plus_until` and the referral-only credit rule.
- The "comp owed every calendar month" credit leak at month boundaries.
- Two admins racing / a Stripe write with no retry (audit P2-4 / P2-5): a
  grant is a ROW first; its Stripe application is a status on the row that a
  sweep retries, and a second grant for the same user adds a row rather than
  re-sizing a coupon under a race.

## 4. Open questions for the owner

1. **Open-ended comps.** Today a free account can be comped "no expiry".
   Month units only means: (a) drop them — convert the existing ones to
   12 months and tell those users, or (b) keep "no end" as an admin-only
   special for staff accounts. Recommendation: (b), kept out of the month
   maths (no credits per month: staff are unlimited anyway).
2. **A paying referrer.** #689 gives a monthly payer a balance credit; this
   design gives the same coupon a comp gives (one free renewal). Same money,
   consistent invoices. OK?
3. **Months vs 30 days.** A "month" here is a calendar month on the overlay
   (Nov 20 → Dec 20) and one invoice cycle on a plan. OK, or exactly 30 days?
4. **Referral reward tier for the referrer:** their own tier (a Pro payer
   gets a free Pro renewal) or always Plus (#689's rule for free users was
   "always Plus")? Recommendation: own tier for a payer, Plus for a free
   account.

## 5. How it ships (after the owner's answers)

1. **PR D — the mechanism:** `plan_grants`, `grantFreeMonths`, the four
   shapes (reusing #688's hold and credit writers and #726's coupon writer
   stripped of the round-up), the grant-anchored credit rule in the refill
   cron, the admin form in months, a migration that converts existing dated
   comps into grants. Sandbox test-clock run for every shape.
2. **PR E — #726 reshaped:** the plan-switch lock and the no-switch portal
   configuration (created by the app, as approved), the comp-ending reminders
   reading the grant.
3. **PR F — referrals on the mechanism:** #689/#691 rebased: the reward is a
   `grantFreeMonths` call, the settings row with the admin switch, the user
   page kept, the review's P1 (record nothing before the email is confirmed)
   and P2s fixed, migration renumbered.


## 6. Revision after the owner's answers (2026-11-05, later)

Answers: open-ended comps stay for STAFF only; a paying referrer gets the
same thing a comp gives; a "month" is **30 days**, counted from the moment
the free days are given, and every surface says "free 30 days", never "free
month"; a payer's referral reward is at their own tier, a free account's is
Plus.

### 6.1 What Stripe allows for "push the next charge out by 30 days"

Read on docs.stripe.com today:

- `billing_cycle_anchor` on an UPDATE accepts only `now` or `unchanged`;
  setting it to a timestamp is a **private preview** (API `2026-09-30.preview`,
  flexible mode, within one interval). Not usable.
- The documented way: **a trial period on the existing subscription** —
  "Trials typically start when you create a subscription, but you can also
  apply them to existing subscriptions, allowing you to credit the customer
  for the days left in the previous cycle that they already paid." Setting
  `trial_end` moves the billing cycle anchor to that date; with
  `proration_behavior: none` nothing is invoiced now. Stripe's own example:
  a subscription billing next on July 23; on July 15 a trial ending August 1
  → nothing billed July 23, a full cycle billed August 1, then the 1st
  monthly. The subscription reads `trialing` until then.
- A 100 %-off coupon (what #726 built) frees the next invoice(s) on their
  EXISTING dates — it cannot move a billing day, so it cannot express "30
  days from the day they received it".

So "free 30 days on a running plan" = `trial_end` = (the current paid period's
end, or the running trial's end) **+ 30 × 86 400 seconds**, `proration_behavior:
none` — the primitive #688 already uses for comp holds on trials, applied to
ACTIVE plans too. On a monthly plan the billing day moves by 30 days; on an
annual plan the renewal moves by 30 days; on a trial the trial end moves.

### 6.2 What this simplifies

- ONE Stripe primitive for every live plan (no coupon, no balance credit, no
  15-day rule, no annual special case): #726's coupon machinery and #688's
  balance credit are retired; #688's trial hold (metadata
  `pipglyph_trial_end_before_comp`, the reworded `trial_will_end` reminder,
  the `isUnconvertedTrial` guard) is reused as is.
- No plan-switch lock: a switch during the hold goes through the portal's
  `continue_trial` (already configured on both portal configurations), keeps
  the end date and charges the new price at the end — nothing is freed
  twice. #726's lock, the no-switch portal configuration and
  `STRIPE_PORTAL_CONFIG_NO_PLAN_SWITCH` are not needed. (The app-created
  configuration you approved is therefore not built either.)
- The overlay (no live plan) is the same 30-day arithmetic: `comp_expires_at`
  = max(now, its current end, a cancelled plan's end) + 30 days × N.
- Credits: one allotment per 30 days of the grant, at the start of each
  (`grant:<id>:<k>`), for the overlay AND for a held plan (a `trialing`
  subscription gets no cron refill today — the grant's own allotments cover
  the held days; the first invoice after the hold refills as a paid month).

What stays visible from Stripe's side during the free days: the subscription
reads `trialing` (the portal says "Trial ends <date>"), Stripe sends its own
trial-ending reminder if that Dashboard email is on, and the app's reminder
says "complimentary period" (never "trial") as #688 made it.

### 6.3 Precision — recommendation

**Exact to the second.** The free days end exactly 30 × 86 400 seconds after
the base instant (Stripe timestamps are seconds; a round-to-midnight rule
would give some users 29.x days and depends on a time zone). Every surface
prints the end as a date AND time in the viewer's zone ("December 10, 2026
at 3:14 PM"), as the billing page already does for renewal dates. The admin
toast prints it in UTC, labelled.

### 6.4 The one question left: where do the 30 days start on a paid plan?

Your example: Pro started Nov 5 (paid through Dec 5); free 30 days given
Nov 10; "billing again on Dec 10". Two readings:

- **(A) From the day it was given:** `trial_end` = Nov 10 + 30 d = **Dec 10**.
  The user is not charged Dec 5 and pays Dec 10. They had already paid for
  Nov 10 – Dec 5, so the gift is really 5 days (Dec 5 – Dec 10): the 25
  remaining paid days are swallowed. Stripe's doc example works this way.
- **(B) Added to what they paid for:** `trial_end` = Dec 5 + 30 d = **Jan 4**.
  Not charged Dec 5; charged Jan 4; then the 4th monthly. The gift is a full
  30 days on top of the paid time.

Recommendation: **(B)**, so a comp or a referral reward never costs the user
paid time; "30 days from the day they received it" then holds exactly for
users with no live plan (the overlay starts now) and for trials (the trial
simply runs 30 days longer).

**Owner's answer (2026-11-05):** (B) — the free 30 days are ADDED to the paid
time: `trial_end` = (current period end, or the running trial's end) + 30 d;
a user with no plan starts the overlay now. Design approved; precision exact
to the second, shown with the time in the viewer's zone.

### 6.5 Shipped (PR D, 2026-11-05)

`plan_grants` (migration 0176), `lib/billing/free-days.ts` (the decision),
`free-days-apply.ts` (the writer and the revoke), `free-days-credits.ts`
(the per-30-days allotments, run by the refill cron), the admin form in
30-day units with "No end (staff)", the copy. One departure from §2/§6:
revoking is supported (the NEWEST applied grant), since the hand-typed comp
could be cleared; and a staff (open-ended) grant still gets the tier's
allotment every 30 days — removing credits from the accounts that have
them today was not asked for. docs/BILLING.md "Free 30 days" is the
reference now.
