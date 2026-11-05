# Stripe, plans, comps and referrals — audit and plan (2026-11-05)

Read-only audit of everything money-related on `main` (b639b57d) plus the
three benched PRs (#726 comps-as-coupon, #689/#691 referrals), with desk
research on Stripe best practice and trial conversion. Nothing was changed
or run against Stripe/Supabase; every finding names its file and line.
Four independent reviewers wrote the detailed sections; the owner-facing
todo list is in the chat message that accompanied this file.

## 0. What is in place today (and solid)

- Hosted Checkout + Customer Portal + webhooks, the recommended shape.
- Webhook: raw body `constructEvent`, API version pinned `2026-05-27.dahlia`
  (stripe-node ^22.2), `stripe_events` claim table with 10-minute stale
  takeover, claim deleted + 500 on throw (Stripe retries), unknown events
  acked 200.
- Sync re-reads Stripe's current state; `deleted` is terminal; "free" is
  written only when the given subscription ended and nothing else is live;
  an unmapped price never demotes; `stripe_customer_id` written by the
  service role only and verified.
- Pack grants keyed by session across `completed`/`async_payment_succeeded`.
- Trial/credit maths (25 trial credits, top-up on first payment, upgrade
  top-ups against the month's total) are idempotent and tested (282 `it()`s
  in `tests/unit/billing`).
- Every paid gate goes through `getEntitlements()` server-side; comp expiry
  honoured in `card_capacity_for` (0104), `owner_export_stamp` (0074),
  `viewer_is_pro` (0151); billing columns pinned by `protect_billing_columns`.
- Secrets `server-only`; every server action checks the user; return URLs
  from env; cron guard constant-time, fail-closed; account deletion cancels
  subscriptions first.
- Sandbox state (read 2026-11-05, the Stripe connector is sandbox-only now):
  one webhook endpoint (dev alias, 9 events), one default portal
  configuration (switch on, `continue_trial`, `schedule_at_period_end`
  conditions, pause OFF, no terms/privacy URLs), coupons `TRIAL_WINBACK_20`,
  `SUBSCRIBER_PACKS_20` and the three `pipglyph_comp_100off_*` from #726's
  test-clock runs; seven active prices with lookup keys.

## 1. Core code findings on `main`

### P1-1 — a user can mint the 20 % win-back coupon from their own notification row
`lib/stripe/actions.ts:155-167` (`hasRecentLapsedTrial`) asks only for a
`notifications` row of `type = 'trial_lapsed'` owned by the caller in the
last 30 days. `0097_explicit_api_grants.sql:98-100` grants `authenticated`
table-wide UPDATE on `notifications`; `0032:33-36`'s UPDATE policy is
column-blind; no trigger pins `type`/`payload`/`created_at`. Any signed-in
user can `PATCH` one of their own rows to `type: trial_lapsed` and buy at
20 % off (on an annual plan: 20 % of the whole year — see P3). The same hole
lets a user forge `payload.trialEnd` and suppress their trial reminder.
Fix: a `protect_notification_columns` trigger (or `grant update (read_at)`
only) and verify `payload.subscriptionId` against the caller's customer.

### P1-2 — a transient Stripe list failure sells a second subscription
`subscription-sync.ts:137-153` returns `null` on any list error;
`findLiveSubscription` / `findDelinquentSubscription` then return `null`;
`actions.ts:360-374` falls through to a fresh `checkout.sessions.create`
(and `isTrialEligible` also fails → no trial → charged at once). An active
Pro subscriber clicking "Switch to Plus" during a Stripe 5xx is charged $6
for a second subscription beside the $15 one. Fix: distinguish "list
unreadable" from "no subscription" and refuse with "Try again".

### P1-3 — `past_due` strips perks and credits on the first failed charge
`entitlements.ts:69,117-118` keeps perks for `active`/`trialing` only;
`credit-refill.ts:105-106` owes credits to `active` only;
`webhook-handlers.ts:874-910` writes `past_due` the moment
`invoice.payment_failed` lands (the fallback at `:904-908` by customer id
without reading the invoice's subscription). A soft decline that Smart
Retries recovers two days later still costs the customer two days as Free
with no notification. Fix: a grace window (perks while `past_due` and
`period_end + N days > now`, or until `unpaid`), a `payment_failed`
notification + email linking the portal's card-update flow.

### P2-1 — calendar-month credit keying: two allotments for one payment; annual relies on the cron alone
`plans.ts:314-323` keys refills on the UTC month; `credit-refill.ts:186-226`
grants the full allotment whenever the month has no base row; the cron runs
daily. Subscribe Pro on Jan 31 → 100 (created) + 100 (Feb 1 cron) for one
invoice, never clawed back. Inverse: an annual subscriber gets no monthly
Stripe event, so a cron outage spanning a month loses it (no backfill).
Fix: key monthly plans on the Stripe billing period (`invoice.period_start`),
keep the calendar key for annual, add a backfill of missed periods.

### P2-2 — no refund / dispute handling
`webhook-handlers.ts:797-915` ignores `charge.refunded`,
`charge.dispute.created/closed`, `radar.early_fraud_warning.created`. A
charged-back pack keeps its credits; revenue rows never say "refunded"; no
admin is told. Fix: subscribe (live + sandbox), claw back unspent pack
credits (`refund:pack:<session>`), mark the revenue row, admin alert;
Dashboard "cancel subscription on dispute" setting.

### P2-3 — comp on an annual plan credits money the customer may never use
`comp-stripe-apply.ts:89-90,163-168` → `balance-credit.ts:88-97`: a
one-month comp on a $60 annual plan posts −$5 consumed only at the next
annual renewal; a customer who cancels first gets nothing. Say so in the
admin toast or offer a credit grant instead.

### P2-4 — comp's Stripe write is best-effort after the profile write, no retry
`lib/admin/user-actions.ts:217-239`: comp row committed, then
`applyCompToSubscription`; a Stripe timeout returns `failed` but the user's
`comp_plan` notification still goes out and nothing retries — the held trial
converts and charges inside the "free" month. Fix: a pending flag swept by
the comp-ending cron; withhold the user notification until Stripe landed.

### P2-5 / P2-6 / P2-7 — races
- Two admins saving different comp end dates at once both read `net = 0`
  and both credit (`comp-stripe-apply.ts:169-183`). Serialize per user.
- `grant_credits` (`0027:169-187`) is exists→update→insert; a cron+webhook
  race ends in a 23505 that fails the caller (webhook 500, cron pages
  admins) though no double grant lands. Use `insert … on conflict do
  nothing returning id` first.
- `ensureStripeCustomer` (`actions.ts:123-142`) can create two customers
  for one user under concurrent checkouts. `update … where
  stripe_customer_id is null` and re-read.

### P3
- No `idempotencyKey` on `checkout.sessions.create`; no
  `consent_collection` / `custom_text` trial-terms line at Checkout.
- Win-back coupon `duration: once` on an ANNUAL plan is 20 % off the whole
  year while the copy says "first month" (`webhook-handlers.ts:385-388`
  prints "for the first year"); and re-claimable (cancel + resubscribe
  within 30 days, no "used" marker).
- "One trial per account" is per auth user / Stripe customer: delete the
  account, re-sign up with the same email + card → a new trial, 25 + 5
  credits. Card-required mitigates; nothing enforces per card or per email.
- USD assumed throughout (`config.ts:124-140`, `lib/format/money.ts`,
  hard-coded `$` in two notification strings).
- `subscriptions.list` `limit: 20`; `stripe_events` never pruned;
  `authenticated` holds INSERT/TRUNCATE on `notifications` (RLS blocks).
- A Dashboard `pause_collection` keeps `status: active` → perks continue.
- `docs/BILLING.md` stale: §2 omits `pack_mini`; line 47 "six events" vs
  nine; §4 still shows the no-card `if_required` Checkout parameters; §5's
  Smart-Retries line contradicts P1-3; §7 "refunds are not logged" should
  add that credits survive a refund.

### Money paths with no unit test
Checkout when the list fails (P1-2); `ensureStripeCustomer` concurrency;
`payment_failed` fallback when the retrieve throws; `incomplete` /
`unpaid` / `incomplete_expired` end-to-end; the annual cron-only refill
across a missed month; `netCreditPosted` pagination; forged-notification
eligibility (P1-1).

## 2. PR #726 — monthly comps as a 100 %-off repeating coupon (BL1)

Verdict: **merge with changes.** The coupon is the right primitive for a
monthly comp (invoice says "complimentary", $0, clean removal, no
claw-back, no status change); three prior independent checks and eight
sandbox test-clock scenarios back the money paths; one `TODO.md` conflict
with main. 1,889 product lines added.

- **P1** — the portal fails CLOSED on `STRIPE_PORTAL_CONFIG_NO_PLAN_SWITCH`
  (`lib/stripe/portal.ts:50-62`): unset in any one of Production / Preview /
  Development = every comped subscriber there loses "Manage plan" for the
  comp's length; a transient read failure refuses the portal home for
  everyone. The PR already creates the coupon from code
  (`comp-stripe-apply.ts:334-366`); create the no-switch portal
  configuration the same way (clone the default's business profile and
  return URL, `subscription_update.enabled: false`, found by metadata,
  memoised) and drop the env var and the fail-closed matrix. The two other
  owner steps (Stripe's no-code portal link and email portal links OFF)
  stay, or flip the DEFAULT to no-switch and pass a switch-enabled
  configuration on the app's confirm sessions.
- **P2** — the 15-day round-up (`comp-coupon.ts:76,252-256`) frees an
  invoice AFTER the comp ends (the "tail") and is the root of the tail
  lock, the cleared-tail rule, the union rule and the 45-day storefront
  window. Alternative the owner was not offered: N = the plan's renewals
  that fall INSIDE the comp window (`renewalsIn`, already in the branch).
  No invoice outside the comp is ever free; the special cases collapse.
- **P2** — re-referencing another discount by id
  (`comp-stripe-apply.ts:227-229,243,269`) is proven only against the fake:
  Checkout allows promotion codes on every non-win-back subscription. Add a
  ninth sandbox scenario (promo-code discount, comp, revoke).
- **P3** — `invoice.paid` on a $0 coupon renewal writes a `billing_payments`
  row the Revenue panel labels "no charge" with nothing saying "comp";
  `createPortalSessionAction` now reads Stripe on EVERY portal open with no
  bound (the storefront read is bounded at 3 s); the three PR-body P3s
  (annual 5xx toast wording, two different comps racing a resume, legacy
  `""` metadata) stand.
- Design table (coupon vs balance credit vs `pause_collection` vs
  `trial_end` vs $0 price vs schedule phase) is in the reviewer's report;
  conclusion: keep the coupon, keep the lock, create the configuration from
  code, decide the N rule.
- Not covered: a real second discount; `invoice.paid` on the $0 invoice;
  the resume/dunning re-apply through a delivered event; the portal flows
  end to end. The sandbox script is safe (accepts `sk_test_`/`rk_test_`
  only, strips every other secret before loading app code, scrubs output,
  deletes its clocks).

## 3. PRs #689 / #691 — referral program

Verdict: **finish with changes**, not as designed; do not restart (~3,700
reviewed lines and a sandbox proof would be discarded for ~4 h saved).

- **P1 — referral squatting through an unconfirmed account.**
  `recordReferralSignup` writes the `referrals` row and the email
  fingerprint at signup, before confirmation (`lib/referrals/server.ts:
  116-129`). GoTrue returns the SAME user id for an existing unconfirmed
  email, so an attacker who signs a target's address up through their own
  link and never confirms owns the first claim (`exists`, 23505, `:123`);
  the target later confirms, saves a card, and rewards the attacker. The
  ghost's fingerprint also makes a genuine later referral of that inbox
  `email_reused`. Fix: write nothing (no row, no fingerprint) until
  `email_confirmed_at`; record the referral at onboarding (first
  authenticated step), or keep the code as an overwritable claim.
- **P2 — the referee side is uncapped**: `claim_referral_reward` caps the
  referrer only (`0164:472-480`); a capped row still pays the friend 30
  credits (`server.ts:290-305,347`). N confirmable inboxes = N × 30 credits.
  Cap friend-months per referrer, or no credits once capped; a week-sized
  reward with ~7 credits shrinks this anyway.
- **P2 — a referee on a card-backed trial** gets a balance credit instead
  of the Plus period (`reward.ts:42-60` treats `trialing` as live); if the
  trial lapses the credit sits unused. Referee should get the overlay
  unless `active`.
- **P2 — overlay wasted under a running paid plan** when
  `subscription_ends_at` is NULL (pre-0135) or Stripe is unconfigured
  (`0164:555-569`, `server.ts:409`).
- **P2 — credits granted at claim, not when the period starts**
  (`0164:574-578`): two friends → 60 days and 60 credits at once.
- **P2 — merge mechanics**: conflicts in `app/(auth)/actions.ts`,
  `lib/analytics/attribution.ts` and its test (~30 min); migration 0164 is
  taken, main's tail is 0172 (0170 was never used) → `0173_referrals.sql`;
  the `notifications_type_check` list must become main's 0172 list plus the
  two referral kinds (`deck_cloned`, `challenge_winner` are missing);
  `types/supabase.ts` to be re-checked against 0165–0172.
- **P2 — a lost `after()` strands a row** (`lib/cards/actions.ts:710-721`);
  the drafted `referrals_to_qualify` is the right fix.
- **P3** — the friend can read the referrer's reward kind (RLS + column
  grant, `0164:170-181`); Stripe idempotency keys expire after 24 h (the
  drafted admin Retry would double-credit without the metadata lookup);
  `referral_email_in_use` scans `auth.users` unindexed; the HMAC key has
  no rotation story; without the key every signup logs an error.
- Checked OK: `security definer set search_path = public`, no dynamic SQL,
  revoke-first grants, `ref` sanitised `^[a-f0-9]{8}$`, cron guard, balance
  credit reuses main's helper, overlay only adds, refill never reads it.
- "Month → week" change list: `REFERRAL_MONTH_DAYS` (`rules.ts:17`),
  `p_credits: MONTHLY_CREDITS.plus` (`server.ts:423`), the referrer
  `oneMonthCents` (`server.ts:442`, `reward.ts:73`), ledger reason + label,
  ~15 copy sites across `describe.ts`, the dashboard page, the link box,
  the billing page, `summary.ts`, the admin panel, docs. ~2–3 h plus tests.
  A week's price credit for a paying referrer is $1.38 on Plus — not worth
  a balance transaction; the referrer's side needs an owner decision.
- Over-built for a one-person team (droppable): Stripe card-fingerprint
  matching, disposable-domain list, the 7-day backoff ladder + admin Retry,
  owner decision B (referrer fingerprints). Attribution: sessionStorage
  dies with the tab; a 7-day localStorage window or a first-party cookie
  set by `/?ref=` measurably improves attribution.
- Effort to finish both with the changes: ~14–20 h including a full CI run
  and preview QA.

## 4. Research summary (sources in the reviewer's report; dates 2024–2026)

- Trials: card-required converts 25–60 % trial→paid vs 4–15 % no-card, at
  roughly a third to half the signups; visitor→paid is close to a wash in
  B2B data (ChartMogul/Growth Unhinged 2026; First Page Sage). Consumer
  (RevenueCat, 17k apps, 2026): 5–9-day trials convert as well as 10–16 on
  monthly plans (45.9 % vs 46.6 %); annual plans need longer (33 % → 43 %).
  Verdict: keep the 7-day card-required trial as the paid-intent door; it
  also unlocks Stripe's compliance automation and Radar trial-abuse
  control. The cheapest experiment with the best evidence for a freemium
  product is a reverse trial (new verified accounts get Plus free for 7
  days app-side, then drop to Free), measured as visitor→paid at 30 days.
- Card-network compliance: Stripe sends the trial-ending email 7 days
  before (at once for a 7-day trial) when the Dashboard setting is on;
  `consent_collection[terms_of_service]=required` + `custom_text` at
  Checkout for the "after 7 days you'll be charged $6/month until you
  cancel" line; the `* TRIAL OVER` descriptor is automatic.
- Portal: cancellation reasons ON (write `cancellation_details` to the
  profile), retention coupon available; pause needs flexible billing mode
  and is once per 12 months.
- Flexible billing mode (default from API 2025-09-30.clover; the app pins
  2026-05-27.dahlia and never sets `billing_mode`): `current_period_end`
  lives on items, portal cancels with `cancel_at` (already handled), and
  **updating `trial_end` resets the billing anchor** — relevant to #688's
  trial hold; the sandbox run's invoice dates were correct, keep an eye on
  it.
- Events worth adding: `charge.refunded`, `charge.dispute.created/closed`,
  `radar.early_fraud_warning.created`, `invoice.payment_action_required`,
  `invoice.upcoming` (annual-renewal heads-up), `customer.subscription.
  pending_update_applied/expired`, `payment_method.*`.
- Referrals: double-sided is the norm; reward the referrer on the friend's
  first PAID invoice with a hold against refunds is the fraud-proof shape;
  for the friend a customer-restricted promotion code or an app overlay;
  60-day first-party cookie is the industry default (Rewardful).
- Comps: a 100 % coupon (indefinite) or `pause_collection` (short grace);
  never a $0 price. Turn on "subtract recurring discounts from MRR".
- Pricing page: monthly default at this size ("annual default: +27 % annual
  mix, −6 % total" — vendor data), "2 months free" label, "$0 today · $6/mo
  from <date> · cancel anytime" under the trial button, Link + wallets +
  Adaptive Pricing on, no third-party trust seals.
- Dunning: Smart Retries default 8 retries / 2 weeks; Stripe claims 55 %
  recovery, B2C observers 25–35 %.
