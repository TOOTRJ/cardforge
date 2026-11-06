# Billing (Stripe)

How PipGlyph charges money, how to test it without touching production, and
how the integration compares with the standard Stripe SaaS pattern.

## 1. The shape

| Piece | Where | Notes |
|---|---|---|
| Plan catalog (copy, prices, credits, caps) | `lib/billing/plans.ts` | Client-safe. Stripe price ids are NOT here. |
| Stripe prices | **lookup keys** on the catalog (`plus_monthly`, `plus_annual`, `pro_monthly`, `pro_annual`, `pack_mini`, `pack_small`, `pack_large`; coupon `SUBSCRIBER_PACKS_20` for subscriber pack pricing) — `lib/stripe/prices.ts` resolves them at checkout; the `STRIPE_PRICE_*` env vars are an optional fallback | Since 2026-09-22 (PR #360): a stale env id had every live credit-pack checkout failing with `resource_missing` for weeks. `lib/stripe/config.ts` still maps a price back to a tier (env id → metadata → lookup key → product → amount) for the webhook. |
| Storefront | `/pricing` (static, anonymous) + `/pricing-member` (dynamic, signed-in; `proxy.ts` rewrite) | Buttons come from `pricingCtaFor()` fed by a `BillingViewer` (`lib/billing/viewer.ts`). Paid accounts are redirected to the billing page. |
| Billing page | `/dashboard/billing` | Plan, renewal/trial/cancel dates, plan changes (the same grid), credits + packs, card on file + invoices (`lib/billing/subscription-details.ts`), portal shortcuts. What the plan card says about the plan's future is ONE decision, `planStatusOf()` (`lib/billing/plan-status.ts`), drawn by `components/billing/plan-status.tsx` — see "A cancelled subscription" below. |
| Checkout / portal | `lib/stripe/actions.ts` (server actions) | Before anything is sold the customer's subscription list is read ONCE (`findCheckoutSubscriptions`); if Stripe can't answer, the checkout is REFUSED ("Couldn't check your plan with Stripe. Try again in a moment.") — never a second subscription on a guess (audit 2026-11-05). New subscription → Stripe Checkout (7-day trial for first-timers, **card required** since 2026-09-24, 25 trial credits, the full allotment on first payment; a lapsed trial gets 20% off its first month for 30 days). Live subscription: an **upgrade** goes through the Customer Portal **confirm-update** flow (in-place price switch, prorated, charged now); a **downgrade** (Pro → Plus, or annual → monthly) is **scheduled for the end of the paid period** with a subscription schedule (§6). Broken payment → portal. Packs → Checkout in `payment` mode. |
| Webhook | `app/api/stripe/webhook/route.ts` → `lib/stripe/webhook-handlers.ts` → `lib/stripe/subscription-sync.ts` (+ `lib/stripe/charge-events.ts`) | Events: `checkout.session.{completed,async_payment_succeeded,expired}`, `customer.subscription.{created,updated,deleted,trial_will_end}`, `invoice.{paid,payment_failed}`, and since 0174 `charge.refunded`, `charge.dispute.{created,closed}`, `radar.early_fraud_warning.created`. Idempotent (`stripe_events` claim table, migration 0099). Every endpoint (live + sandbox) must subscribe to all **thirteen**. |
| Revenue log | `billing_payments` (migration 0110) ← `invoice.paid`; `billing_pack_payments` (migration 0138) ← a paid pack `checkout.session.*`; admin Revenue panel on `/admin/users` (`lib/admin/revenue-queries.ts`) | One row per paid invoice and one per paid pack session; admins read, the webhook writes. |
| Entitlements | `lib/billing/entitlements.ts` | The ONE server-side truth: subscription active/trialing + admin comp → effective tier → perks. Never trust a client tier. |
| Credits | `lib/billing/credit-refill.ts` (monthly refill, cron + webhook), `lib/billing/credit-reconcile.ts` (refund orphaned spends), `settle_spend` (0106) | Refill is idempotent per user per month; upgrades top up the difference against everything the month already granted. Since 0175 the cron knows the plan's interval (`profiles.billing_interval`, written by the sync): a MONTHLY plan's base allotment is the paying invoice's — the cron, AND any non-paying webhook sync (a cancel click, a resume, a portal change: `grantCreditsForSync`'s `paid`), grant it only as a backstop (the newest base grant older than 35 days — a missed webhook — and then under the MISSED month's key), so a plan paid on the 31st never gets a second allotment from the cron on the 1st or from a click on the 2nd; a row synced before 0175 keeps the old rule until its next event, and a cron outage spanning two whole months loses an annual plan the earlier one (accepted); an ANNUAL plan is the cron's every calendar month, the previous month backfilled when the plan already ran then. `grant_credits` takes the user's row lock before its idempotency check (a webhook + cron race used to 23505 and page the admins). Checkout links a freshly minted Stripe customer only where none is linked (`… where stripe_customer_id is null`) and otherwise uses the one another request linked first. |

Environment matrix (Vercel):

| Var | Production | Preview | Local (`.env.local`) |
|---|---|---|---|
| `NEXT_PUBLIC_BILLING_ENABLED` | `true` | `true` (set 2026-09-22 — before that previews 404'd `/pricing`) | as needed |
| `STRIPE_SECRET_KEY` | live `sk_live_…` | **sandbox** `sk_test_…` | sandbox key, or unset (billing UI works, every checkout answers "Billing isn't available") |
| `STRIPE_WEBHOOK_SECRET` | live endpoint | sandbox endpoint for the `dev` branch alias (below) | Stripe CLI `stripe listen` secret |
| `STRIPE_PRICE_*` (6) | optional (the catalog's lookup keys are authoritative) | optional | optional |

## 2. Sandbox (test mode) setup — created 2026-09-22

The sandbox mirrors the live catalog (same names, lookup keys and `tier` /
`pack` metadata, so checkout resolves the right price by lookup key and
`tierForPrice()` maps it back the same way). The ids below are for reference
only — nothing needs them configured:

| Key | Sandbox price id |
|---|---|
| `STRIPE_PRICE_PLUS_MONTHLY` | `price_1UIfqmQFLEpCg9s2J9lAa8m5` |
| `STRIPE_PRICE_PLUS_ANNUAL` | `price_1UIfqoQFLEpCg9s2Mdfkrplw` |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_1UIfqqQFLEpCg9s2uei4gLcS` |
| `STRIPE_PRICE_PRO_ANNUAL` | `price_1UIfqsQFLEpCg9s2GV5FMI1y` |
| `STRIPE_PRICE_PACK_SMALL` | `price_1UIfquQFLEpCg9s2rxx8DiRf` |
| `STRIPE_PRICE_PACK_LARGE` | `price_1UIfqwQFLEpCg9s2DHwy42kY` |
| `STRIPE_PRICE_PACK_MINI` | `price_1UJKTAQFLEpCg9s24jZ8YiXl` (added 2026-09-24, §8) |

Sandbox webhook endpoint `we_1UIfs5QFLEpCg9s2TgN3OiCm` → the `dev` branch
alias (`https://cardforge-git-dev-orderoftheredjester.vercel.app/api/stripe/webhook`,
API version `2026-05-27.dahlia`, the same thirteen events as production). Its
signing secret is what Preview's `STRIPE_WEBHOOK_SECRET` holds. Preview
deployments sit behind Vercel Deployment Protection, which answers 401 to
anything without a Vercel session — including Stripe. The endpoint URL
therefore carries `?x-vercel-protection-bypass=<secret>` (Vercel → Settings →
Deployment Protection → Protection Bypass for Automation); rotate both
together.

Limits to know: only the `dev`-alias deployment receives sandbox webhooks. On
any other preview a checkout still completes on Stripe, but the profile is
synced only when you press **Resync from Stripe** on the user in
`/admin/users` (it reads the customer's subscriptions straight from Stripe —
the same code the webhook runs). Test cards: `4242 4242 4242 4242` (any
future date, any CVC); `4000 0000 0000 0341` attaches but fails the first
charge (past-due path).

### Setting Preview up (owner, once)

1. Stripe Dashboard → toggle **Test mode** (or open the sandbox) → Developers
   → API keys → copy the **Secret key** (`sk_test_…`).
2. Vercel → Project → Settings → Environment Variables:
   - `STRIPE_SECRET_KEY`: add a new entry scoped to **Preview** only, value `sk_test_…`.
   - `STRIPE_WEBHOOK_SECRET`: Preview only, the sandbox endpoint's signing secret (Dashboard → Developers → Webhooks → the `cardforge-git-dev…` endpoint → Reveal).
   - `NEXT_PUBLIC_BILLING_ENABLED`: Preview only, `true`.
   - No price ids needed: checkout resolves them from the sandbox catalog by lookup key. (The six `STRIPE_PRICE_*` vars can stay as they are or be deleted.)
3. Redeploy any open preview (Deployments → ⋯ → Redeploy) — env changes apply at build time.
4. Check: on the preview, `/pricing` renders; as `dev_free` a checkout button opens Stripe's **test** checkout (orange "TEST MODE" banner); pay with `4242…`; on the `dev` alias the webhook lands and `/dashboard/billing` shows the plan; on other previews, resync from `/admin/users`.

## 3. Testing locally

- Unit (`npm run test:unit`): the Stripe SDK is mocked at the module boundary; the money paths are covered in `tests/unit/billing/*` and `tests/unit/api/stripe-webhook-route.test.ts`. Fixtures in `tests/unit/billing/subscription-details.test.ts` are real sandbox object shapes.
- Full flow on your machine: put the sandbox `sk_test_…` and the six sandbox price ids in `.env.local` (never live keys), run `stripe listen --forward-to localhost:3000/api/stripe/webhook`, copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`, `npm run dev`, sign in as `dev_free@dev.pipglyph.test`, buy with `4242…`. `stripe trigger customer.subscription.deleted` etc. replays canned events.
- Time travel: Stripe **test clocks** (Dashboard → Customers → Test clocks, or the API) age a subscription through trial end, renewal and cancellation in seconds.

## 4. What the sandbox verified on 2026-09-22

Run through the Stripe API against the sandbox (no app in the loop), i.e. the
Stripe-side assumptions the code relies on. **Historical:** the trial has
required a card since 2026-09-24 (§9) — Checkout no longer sends
`payment_method_collection: if_required`; the no-card lines below describe
the parameters of the day.

- The exact `checkout.sessions.create` parameters the app sends for a
  first-time subscription (7-day trial, `payment_method_collection:
  if_required`, `trial_settings.end_behavior.missing_payment_method: cancel`)
  and for a credit pack (`payment` mode with the server-set metadata) are
  accepted and produce open, hosted sessions — the "top up doesn't work"
  report is not a Stripe rejection.
- A no-card trial subscription is created `trialing` with `trial_end` 7 days
  out and `missing_payment_method: cancel`.
- A paid Plus subscription (test card) invoices and settles $6 immediately.
- See the "Lifecycle" addendum at the end for the proration / cancellation /
  clock-advance results.

## 5. How this compares with the standard Stripe SaaS pattern

Stripe's own recommendation for a SaaS app is: hosted **Checkout** for the
first purchase, the **Customer Portal** for everything after (plan changes,
card, invoices, cancel), **webhooks** as the source of truth for access, and
an in-app billing page that shows state and links into the portal. PipGlyph
does all of that, plus a few things most apps skip:

- Plan switches go through the portal's **confirm-update** flow with the
  price pre-selected, so the user sees the proration before confirming and
  the subscription keeps its id (no double billing); a mid-trial switch
  carries the trial over.
- The webhook never trusts a single event: every subscription event re-reads
  the customer's subscription list and writes the primary one (`subscription-sync.ts`),
  so out-of-order deliveries can't demote a paying customer.
- Webhook idempotency is a claim table with stale-claim takeover, and every
  credit grant carries an idempotency key.

Gaps against the standard, in priority order:

1. ~~**`customer.subscription.trial_will_end`** is not subscribed.~~ **Done 2026-09-22** (§6); the live endpoint has subscribed to it since 2026-09-23.
2. ~~**`invoice.paid`** is not handled.~~ **Done 2026-09-23** (§7): revenue log + resync + "Payment received" notification.
3. ~~**`checkout.session.expired`** recovery.~~ **Done 2026-09-23** (§7): one reminder per user per 30 days, in-app + email.
4. ~~**Scheduled downgrades**~~ **Done 2026-09-22** (§6), in the app rather than the portal: the portal's `schedule_at_period_end` only schedules between prices of the SAME product, so Pro → Plus (two products) could never use it.
5. ~~**Smart Retries / dunning emails**~~ The app side is done (the dunning grace + the payment-failed notice, below): confirm Smart Retries are on in Dashboard → Settings → Billing → Subscriptions and emails; Stripe's own failed-payment email can stay OFF (the app sends one) or on (two emails).
6. **Stripe Tax** is off (`automatic_tax` false). Fine while volume is tiny; revisit before EU/UK volume.
7. **Test coverage for the hosted pieces**: nothing automated completes a real checkout. The Preview setup above plus a monthly manual run (or a Playwright job with the Stripe test card on the `dev` alias) closes that.

## 6. Trial reminder + scheduled downgrades (2026-09-22)

**Trial reminder.** Stripe fires `customer.subscription.trial_will_end`
three days before a trial ends (at once for a shorter trial).
`handleTrialWillEnd` (`lib/stripe/webhook-handlers.ts`) turns it into ONE
`trial_ending` notification (migration 0109 adds the kind; bell, toast and
`/notifications` copy in `lib/notifications/describe.ts`) and ONE "account"
email (`trialEndingEmail` in `lib/email/messages.ts`) per subscription:

- the payload records whether a payment method is on file, checked the way
  Stripe checks it at conversion — the subscription's
  `default_payment_method`/`default_source` OR the customer's
  `invoice_settings.default_payment_method`/`default_source` — so the copy
  is honest: "your card is charged on {date}" vs "add a card or it simply
  ends";
- once per subscription: the handler skips when a `trial_ending` row for
  that `subscriptionId` exists (a redelivered event, or a second event after
  a trial extension) and the email carries `idempotencyKey`
  `trial-ending:<sub>` at the provider;
- the notification insert is the durable part — a failure throws so Stripe
  retries; the email is best effort on top; a subscription that is no
  longer `trialing` is ignored.

Card-network rules require a reminder before a trial converts to a charge;
this is it. The event must be subscribed on EVERY endpoint (sandbox and
live: both done).

**Scheduled downgrades.** `createCheckoutSessionAction` classifies a plan
switch on an ACTIVE subscription with `isPlanDowngrade()` (`lib/billing/plan-change.ts`) — a lower tier, or
the same tier from annual to monthly:

| Switch | What happens | Money |
|---|---|---|
| Upgrade (Plus → Pro, monthly → annual) | Portal confirm-update flow, as before; any pending downgrade is released first (the portal refuses to update a subscription a schedule manages) | Prorated difference charged now |
| Downgrade (Pro → Plus, annual → monthly) | `scheduleDowngrade`: `subscriptionSchedules.create({ from_subscription })`, then `update` with the current phase kept exactly as it is (same price, same end date) and ONE phase on the new price (`duration` = one interval, `proration_behavior: none`), `end_behavior: release` — the subscription carries on renewing on the new price. A pending change is replaced, never stacked; a plan set to end — by `cancel_at_period_end` or by the portal's `cancel_at` date — is un-cancelled first through `clearCancellation` (the click asked for "Plus after this period", not "nothing after this period"); if the schedule then fails, the answer says so in words ("Your plan was resumed and now renews as usual, but the switch … couldn't be scheduled") — the plan is left RENEWING on its current price, never silently. Lands on `/dashboard/billing?billing=scheduled`. | Nothing now; the new price bills from the next period |
| "Keep {Plan}" | `cancelScheduledPlanChangeAction` releases the schedule (`?billing=kept`) | — |

The billing page reads the schedule back with
`expand: ["schedule.phases.items.price"]` (`pendingChange` in
`lib/billing/subscription-details.ts`: the first phase after the current
one → tier, price, start date), shows "Changes to Plus ($6 / month) on
{date}" with the Keep button, and hides "Cancel plan" while a change is
pending (cancelling a scheduled subscription through the portal is not
supported — keep the plan first, then cancel). The phase change itself
arrives as an ordinary `customer.subscription.updated` (new price on the
same subscription), which the sync layer already handles; the month's
credit top-up logic never grants for a downgrade.

Sandbox config that backs this: the webhook endpoint
`we_1UIfs5QFLEpCg9s2TgN3OiCm` subscribes to `trial_will_end`; portal
configuration `bpc_1UIhLYQFLEpCg9s2lOOGehBA` has
`schedule_at_period_end` for same-product decreases (harmless, and it makes
the portal agree with the app when a customer changes plan there). Live: the
endpoint `we_1TrupnQFLEpCg9s2bSILz13V` got `trial_will_end` on 2026-09-23
and the live portal `bpc_1TruxhQFLEpCg9s22wWCrEgw` got the same
`schedule_at_period_end` conditions plus a `/dashboard/billing` default
return URL on 2026-09-24 (both owner-authorized). Note for any later portal
edit: Stripe requires resending `features.subscription_update.products`
(the two products with their four prices) on every `subscription_update`
change.

## 7. Revenue log, payment notifications, checkout recovery (2026-09-23)

**`invoice.paid`** (`handleInvoicePaid`) — Stripe's canonical "money
arrived" signal — does three things:

1. **Revenue row.** `billing_payments` (migration 0110): one row per invoice
   (upsert by invoice id, so retries are harmless) with the user, amount,
   `billing_reason` (`subscription_create` / `subscription_cycle` /
   `subscription_update` / `manual`), tier + interval, the billed period,
   `paid_at`, invoice number and hosted URL. The admin **Revenue** panel on
   `/admin/users` shows last-30-days and all-time totals plus the newest
   payments; it reads this table and `billing_pack_payments` (below), never
   Stripe. Seeds give `dev_pro` three renewals and `dev_artist` a $0 trial
   start so branches show rows.

   **Credit packs (2026-10-16, migration 0138).** A pack is a one-time
   Checkout session with NO invoice, so `invoice.paid` never sees it and
   the panel used to leave every pack sale out. `handleCheckoutPaid` — the
   handler that grants the pack's credits, on `checkout.session.completed`
   when it arrives paid or on `async_payment_succeeded` — now also writes
   ONE `billing_pack_payments` row per session (keyed by the session id,
   like the `pack:<session>` grant; Stripe's `amount_total` / `currency`,
   after any subscriber coupon; `paid_at` = the paying event's time),
   `on conflict do nothing`: a repeated delivery, or both events in any
   order, leave the first paid write. An unpaid `completed` writes nothing;
   a write error throws (Stripe retries; the grant is deduped). No backfill:
   the ledger's pack grants carry credits, not the amount paid, and the
   funnel's `pack_purchased` rows lost their `sessionId` (66 characters,
   past the 48-character prop limit), so neither ties an amount to a sale.
   The panel counts ledger pack grants with no row and says how many
   earlier sales it can't price. Seeds give two packs.

   **What the panel counts.** Only money taken: a $0 invoice is listed —
   "Trial start" for a plan's first ($0 `subscription_create`, the
   card-required trial), else "no charge" — and is in no total or count.
   Totals are kept per currency (never added across currencies), before
   Stripe fees; a refund marks its row (0174, §"Refunds, disputes and fraud
   warnings") and is shown beside the gross total, never subtracted. Each log is read up to
   5,000 rows; when one reaches it, "All time" says it covers the newest
   rows only.
2. **Resync.** The subscription the invoice bills is re-read and run through
   `syncSubscriptionForUser` + the idempotent credit grant — a recovered
   past-due plan or a converted trial is current the moment it's paid, even
   if the matching `subscription.updated` is late. A Stripe read failure
   skips this and still writes the row.
3. **One "Payment received" notification** when money was actually taken
   (`amount_paid > 0` — a $0 trial invoice or a 100 %-off coupon says
   nothing), once per invoice (guarded on `payload.invoiceId`). Copy in
   `describe.ts`: renewals read "Your Pro plan renewed — $15 charged; your
   monthly AI credits are refilled", first payments and plan changes say
   thanks. No email from the app: Stripe's own receipt covers the inbox —
   **owner step: Dashboard → Settings → Business → Emails → "Successful
   payments" on** (not readable through the API).

**`checkout.session.expired`** (`handleCheckoutExpired`) — Stripe expires an
unfinished Checkout page 24 h after it opened, so the event IS the
"a day later" nudge. One `checkout_reminder` notification + one "account"
email (`checkoutReminderEmail`), and only while it still matters:

- subscription sessions are dropped when the user has a live plan by now;
  pack sessions when a `pack:` grant landed after the session opened;
- at most one reminder per user per 30 days, whatever they abandoned;
- the copy offers the trial only while the profile has never synced a
  subscription ("your 7-day free trial is still waiting; nothing is charged until it ends"),
  otherwise "pick up where you left off"; packs count the credits and price;
- the session's `metadata` (`purchase_kind`, `tier`, `period`, or
  `pack_credits`) says what was being bought — the session object carries no
  line items — so `createCheckoutSessionAction` stamps it on every session.

Both handlers: the notification insert is the durable part (a failure throws
so Stripe retries); the email is best effort with a provider idempotency key
(`checkout-reminder:<session>`). Both events are subscribed on both
endpoints (sandbox and live `we_1TrupnQFLEpCg9s2bSILz13V`, 2026-09-23 — the
live endpoint carried all nine events then; thirteen since 2026-11-05). Sandbox proof 2026-09-23: an
expired dev_new session produced exactly one `checkout_reminder` (three later
expiries produced none — the 30-day guard); a dev_pro Pro subscription
produced the revenue row, the resync, one `payment_received` and exactly one
refill ledger row across `subscription.created` + `invoice.paid`.

**Failed subscription grants are loud (2026-10-18, migration 0140).** The
daily refill cron logs every failed grant with its user id and error, answers
**500** when any grant or a profiles page read failed (Vercel's cron log shows
the run as failed; Vercel never retries a cron, and a rerun grants nothing
twice — every grant is keyed), and sends every admin ONE `credit_refill_failed`
notification per UTC run day while failures persist. `invoice.paid` logs a
failed grant at error level and alerts every admin once per invoice; it still
answers 200 (the grant's retries are the subscription events and the cron, as
before). Copy: `lib/notifications/describe.ts`; dedupe: 0140's unique index on
(`payload->>'dedupeKey'`, recipient), `lib/billing/credit-alerts.ts`. Nothing
about how or when credits are granted changed. A real gap is remedied with an
admin grant on `/admin/users` naming the month.

## 8. Free credits once, packs where the need is felt (2026-09-24)

Owner decisions of 2026-09-24 (audit §6 recommendations 1 and 2):

- **Free does not refill.** A new account gets `SIGNUP_CREDITS` (5, the
  `profiles.credits` default from migration 0027) once; `MONTHLY_CREDITS.free`
  is 0 and `refillTierFor` answers null for plain free accounts, so the daily
  sweep and the webhook grant nothing to them (an unexpired admin comp on a
  free account is still owed its tier). Banked credits are never clawed
  back. Every surface that said "5 a month" now says "5 to start" — pricing
  page + metadata, the signed-in twin, billing page, dashboard credits card,
  settings usage panel, homepage, AI-generator landing, About, three FAQ
  answers, two guides, the upgrade modal, the checkout-reminder email.
- **Three packs**, impulse → value: 10 for $4 (`pack_mini`, added 2026-09-24
  on live `prod_VJyONxKM5CyH6t` / sandbox `prod_VJyNWwB8DcNxrT`), 30 for $8,
  100 for $24. The out-of-credits modal lists them (free users: plans first,
  then packs; subscribers: packs first).
- **Subscriber pack price, 20% off.** Coupon `SUBSCRIBER_PACKS_20` (same id
  on live and sandbox, `percent_off 20`, forever, restricted to the three pack
  products). `createCheckoutSessionAction` applies it when the buyer's live
  subscription is `active` — not a no-card trial, not a comp or admin — and
  falls back to full price (logged) if the coupon is ever missing. The
  client only displays the discounted number; the webhook grants by
  `pack_credits`, so the discount changes nothing but the price.

## 9. Card-required trial, trial credits, win-back (2026-09-24)

Owner decisions of 2026-09-24 (audit §6 recommendation 3, all three parts):

- **Card required for the trial.** Checkout uses Stripe's default payment
  collection (the `if_required` option is gone); the card is charged when the
  7-day trial ends unless the user cancels, and `missing_payment_method:
  cancel` stays as the safety net. Legacy no-card trials keep their own terms
  (there were none live on 2026-09-24). Every "no card required" promise is
  gone from the pricing page, its metadata, the billing page, the upgrade
  modal, the checkout-reminder email and its notification copy. A
  card-backed trial that switches plans now goes through the portal's
  confirm-update flow (`trial_update_behavior: continue_trial` on both
  portal configurations), like an active plan; only a legacy no-card trial
  still takes the supersede-checkout path.
- **Trial credits: 25, not the full allotment.** `grantCreditsForSync` grants
  `TRIAL_CREDITS` (reason `trial_grant`) under the month's BASE refill key
  when a trial is created and nothing more until it pays; the first payment's
  grant tops the month up to the plan's allotment (same month: 25 + 75 for
  Pro; a later month: the full 100 fresh). Copy on the pricing page, the
  billing page and the modal says so.
- **Win-back.** `customer.subscription.deleted` for a subscription whose
  `ended_at` is at/before its `trial_end` (`isUnconvertedTrial`) and whose
  customer has no other live plan → ONE `trial_lapsed` notification
  (migration 0111; payload carries the offer's `expiresAt`) + ONE
  `trialWinbackEmail`. Coupon `TRIAL_WINBACK_20` (same id on live and sandbox,
  `percent_off 20`, `duration once`, restricted to the Plus/Pro products) is
  applied by `createCheckoutSessionAction` when a `trial_lapsed` notification
  exists within `TRIAL_WINBACK_WINDOW_DAYS` (30) AND the subscription it names
  belongs to the buyer's own Stripe customer (re-read from Stripe; a failed
  read sells at full price). A user can change nothing but `read_at` on a
  notification (migration 0173: a column grant, audit 2026-11-05 — before it
  a table-wide UPDATE let a user rewrite one of their own rows into a dated
  `trial_lapsed` row and buy at the discount) — server-side, never a code
  (Stripe won't combine `discounts` with `allow_promotion_codes`, so the
  promo-code box is off for that session); a missing coupon logs and sells
  at full price.

### Trial conversion follow-ups (2026-11-06, audit BA6)

- **The trial terms on Checkout** (`trialTermsLine`, `custom_text.submit`):
  every session that starts a free period — the 7-day trial, a comp hold, a
  carried trial — says under its button how LONG it lasts ("Your free trial
  lasts 7 days and ends on the date in the order summary"), what is charged
  from then ("Plus is $6 a month, charged to this card until you cancel")
  and that cancelling before then on the billing page charges nothing. The
  length, never a date of ours: Checkout's order summary prints the first
  charge's date in the buyer's time zone, and a UTC date beside it read as
  the next day on an evening checkout. The card networks' required notice;
  Stripe's own trial-ending email (an owner Dashboard setting) is the other
  half.
- **One trial per EMAIL** (`isTrialEligible`): besides the customer's own
  history, every Stripe customer under the account's email is asked (a
  deleted account's customer is never deleted and keeps its history), so
  delete-and-re-sign-up no longer mints a second trial. A "+tag" variant is
  a different address to Stripe; the required card is the other guard.
- **The win-back coupon is MONTHLY only and single-use**: `duration: once`
  on an annual price took 20 % off the whole year while the offer said
  "first month" — the checkout action applies it to monthly plans only and
  the email prices the monthly plan; and the checkout that pays with it
  stamps the `trial_lapsed` row `redeemedAt` (`markWinbackRedeemed`, on
  `checkout.session.completed`), which `hasRecentLapsedTrial` reads as spent.
- **A win-back for cancelled payers** (owner 2026-11-05): a plan that ended
  and left no other live plan gets the same ONE offer — notification
  `trial_lapsed` with `reason: "cancelled"` ("Your Plus plan ended — come
  back by … for 20 % off your first month back") and the reworded email.
  ONE win-back per ACCOUNT, ever (a `trial_lapsed` row for the user, any
  subscription, any time, means no second offer): a payer cancelling every
  month cannot buy every month at a discount. NOT every ending earns it
  (`winbackForCancelledPayer`): a plan Stripe ended over a dispute or
  exhausted payment retries (`cancellation_details.reason`), one the app
  ended for an account deletion (`cancellation_details.comment` =
  `pipglyph:account_deleted`, `lib/stripe/cancel-comment.ts` — and a late
  event for a deleted account's FK refusal is swallowed, never thrown back
  to Stripe), or one that never paid (cancelled inside a comp hold's free
  time: the comp overlay runs on). The per-email trial check narrows
  Stripe's search to the EXACT address: `customers.search`'s "exact" match
  on a string field is a word match (`email:"joe@mail.com"` also returns
  `a.joe@mail.com`), so only a customer whose own email equals the
  account's, lowercased, counts.

### Owner Dashboard checklist (2026-11-06, audit BA6 — nothing the API can read or set)

The app's side of trial compliance and dunning is built; three settings live
only in the Stripe Dashboard and are yours to confirm. None of them changes
money by itself.

1. **Trial reminder email — ON.** Dashboard → Settings → Billing →
   [Subscriptions and emails](https://dashboard.stripe.com/settings/billing/automatic)
   → "Manage free trial messaging" → **Send a reminder email 7 days before a
   free trial ends** (link to a Stripe-hosted page). Stripe sends it 7 days
   before the trial ends — for our 7-day trial, as soon as it starts — with
   the cancellation link the card networks ask for. The app ALSO sends its
   own `trial_ending` email on `trial_will_end` (3 days before), so a
   trialist gets two reminders (day 0 from Stripe, day 4 from us); the
   networks' rule is satisfied by Stripe's. Not sent in the sandbox.
   Verify: start a live trial with a test card of your own → the Stripe
   reminder arrives within minutes; the app's arrives on day 4.
2. **Smart Retries — ON, 8 tries in 2 weeks (Stripe's recommended
   default), and after the last retry "mark the subscription as unpaid".**
   Dashboard → [Revenue recovery → Retries](https://dashboard.stripe.com/revenue_recovery/retries)
   for the policy; Settings → Billing → Subscriptions and emails → "Manage
   failed payments for subscriptions" for what happens after. The app's
   14-day dunning grace (0174) is sized to that window and reads `unpaid`
   as "retries exhausted"; "cancel the subscription" would also work (the
   webhook's win-back skips a `payment_failed` ending, #763) but loses the
   customer's plan record. Stripe's own "Send emails when card payments
   fail" can stay off (the app sends one) or on (two emails).
3. **Portal cancellation reasons — already ON** (verified through the API
   2026-11-06: the live portal configuration `bpc_1TruxhQFLEpCg9s22wWCrEgw`
   asks the customer why, with all seven of Stripe's options). The answer
   lands on the `subscription_cancelled` funnel row (`cancelReason` /
   `cancelFeedback`) and, since the audit's nice-to-haves PR, on the admin
   Funnel panel as "Cancellations by reason · 30d". Nothing to do.

Two audit notes that turned out to need no change: **`pause_collection`**
(a Dashboard "Pause payment collection") keeps the subscription `active`
and the customer's perks on purpose — Stripe documents it as "offer your
services for free for a while"; the app's reading of `active` is right.
**Idempotency on `checkout.sessions.create`**: stripe-node retries a failed
network call up to twice by default (`maxNetworkRetries` 2) under an
idempotency key it generates itself, so a retried create never makes two
sessions; a key of ours would add nothing.

## 10. Funnel instrumentation (2026-09-24)

First-party, no vendor dependency, no cookie (owner decision 2026-09-24):

- **`funnel_events`** (migration 0112): one row per step, `event` (validated
  in `lib/analytics/funnel-events.ts` — adding a step is a code change), an
  allow-listed scalar `props` object, `user_id` when signed in (anonymous
  rows carry nothing), `source` server/client. Admins read it through
  `admin_funnel_counts(p_since)`; the webhook and checkout action write it
  through the service role; `/api/cron/prune-funnel-events` drops rows older
  than 180 days weekly.
- **Server steps** (exact, unblockable): `checkout_started` in
  `createCheckoutSessionAction` (its row id is stamped into the session
  metadata as `funnel_id` so completed/expired rows tie back to the click),
  `checkout_completed` / `checkout_expired` / `pack_purchased` /
  `payment_received` / `payment_failed` in the webhook, and from
  `customer.subscription.*`: `trial_started` or `subscription_started` on
  created, `trial_converted` (previous status trialing → active) and
  `subscription_changed` (price changed, from/to tier) on updated,
  `trial_lapsed` or `subscription_cancelled` (with Stripe's
  `cancellation_details` reason + feedback) on deleted.
- **Client steps** (`lib/analytics/funnel-client.ts` → POST `/api/events`,
  same-site only, 2 KB cap, allow-listed names, always 204; mirrored to
  Vercel Analytics `track()` and GA4 when mounted): `pricing_view` (once per
  grid mount, `surface` pricing/billing), `cta_click` (every CheckoutButton
  and the signup links, with `surface` pricing/billing/modal and what was
  clicked), `upgrade_modal_open` (with the gate `reason` — the best signal of
  which perk sells). Ad blockers drop some client rows; the panel pairs
  client-with-client and server-with-server steps so the ratios stay honest.
- **Admin Funnel panel** (`/admin/users`, `lib/admin/funnel-queries.ts`):
  last 7 and 30 days, counts with distinct users, chained rates for
  Storefront (views → clicks → checkouts → completed), Trials (started →
  converted) and Out of credits (modal opens → packs), plus Money and Leaks
  as counts. At this volume the counts matter more than the rates; trial
  conversion should be read only on trials that have ended.

### Activation, attribution, trial engagement, bots (2026-09-24, migration 0113)

- **Activation** (`recordActivity`): `card_saved` (createCardAction),
  `ai_generation` (the AI jobs POST, per kind) and `download` (PNG/PDF
  routes, signed-in viewers only) each also write a once-per-user
  `first_*` milestone. Milestones and `signup` rows are exempt from the
  180-day prune. The panel's Activation section chains signup → first save
  → first generation → first download.
- **Signup attribution**: `AttributionCapture` (root layout) stores the
  landing referrer host + `utm_source/medium/campaign` in per-tab
  `sessionStorage` (first touch, no cookie); `AttributionFields` posts them
  as hidden inputs; `signupAction` sanitizes them and records a `signup`
  event — for REAL new users only (an already-registered address returns an
  obfuscated user with no identities and records nothing). The panel groups
  30-day signups by `utm_source`, else referrer host, else "direct".
- **Trial engagement**: `admin_trial_engagement()` (0113) lists trials
  started in the window with outcome (converted / lapsed / ongoing), distinct
  active days and saves / generations / downloads inside the 7-day window.
- **Bots**: `/api/events` drops requests whose User-Agent `isbot` recognises,
  matching Vercel Analytics' policy.
- **Screen widths** (TODO WD9, no migration): `ScreenWidthBeacon` (root
  layout) posts ONE `screen_width` event per tab session (a `sessionStorage`
  flag) carrying the `window.innerWidth` bucket alone
  (`lib/analytics/screen-width.ts`: `<640` … `2560+`, stored as safe keys) —
  first-party only (`postFunnelEvent`, never GA4 / Vercel Analytics), never
  under `navigator.webdriver`, a prerendered page only once shown.
  `/api/events` records it ANONYMOUS even for a signed-in visitor (the
  session is never read; props = the bucket, nothing else). The panel's
  "Screen widths (last 30 days)" table reads one exact head count per bucket.

## A failed renewal: the dunning grace and the payment-failed notice (2026-11-05, migration 0174)

A renewal that fails flips the subscription to `past_due` at once, and Stripe's
Smart Retries then try the card again for up to two weeks. Until this the app
read `past_due` as "no perks": a soft decline the retry recovered two days
later still cost the customer two days as Free (watermarked downloads, the
50-card cap) with nobody told (audit 2026-11-05, P1-3).

- **The grace.** `profiles.payment_failed_at` = when the sync first saw the
  payment broken (`past_due` / `unpaid`), kept through every later event of
  the same failure (Stripe retries the SAME invoice), cleared when it pays
  or ends. A `past_due` subscription keeps its paid perks for
  `DUNNING_GRACE_DAYS` (14) from that moment — ONE rule in two forms,
  `lib/billing/dunning.ts` and `public.subscription_perks_on()` (read by
  `card_capacity_for`, `owner_export_stamp`, `viewer_is_pro`), held
  together by `tests/unit/billing/dunning.test.ts`. `unpaid` (retries
  exhausted) and `incomplete` get no grace. No credits are granted during
  it: the month's allotment lands with the invoice that finally pays. A TRIAL
  whose first charge declines gets no grace (it never paid): the stamp stays
  null for that dunning run and the perks end with the trial.
- **The notice.** `invoice.payment_failed` → after the sync, ONE
  `payment_failed` notification + ONE "account" email (`paymentFailedEmail`)
  per INVOICE (unique on `payload.invoiceId`: the retries dedupe), only when
  the synced subscription is the user's live plan and now broken (a
  secondary's failure beside a live Pro plan says nothing), naming the
  amount, Stripe's next retry date, the grace's end and the billing page.
- **What the user sees.** `/dashboard/billing`: "We'll retry your card
  automatically; your Plus perks stay on until <date> — update your card
  before then" (the plan card is still Plus; `Entitlements.dunningGraceUntil`
  → `planStatusOf` `graceUntil`); past the grace, the old "paid perks are
  paused" line. The storefront and the upgrade modal offer the portal
  ("Update payment to continue") on every delinquent status, paid or not.
  The account menu's "Pro · payment due" is unchanged.
- **A database that hasn't run 0174** reads no grace (fails toward free);
  the sync writes without the column until it lands (the 0135 pattern).

## Refunds, disputes and fraud warnings (2026-11-05, migration 0174)

Money going back now reaches the app (`lib/stripe/charge-events.ts`):

| Event | Sale matched by the charge's payment intent (`billing_payments.payment_intent_id` — written from `invoice.payments` since 0174 — or `billing_pack_payments.payment_intent_id`) | Admins |
|---|---|---|
| `charge.refunded` | `refunded_cents` / `refunded_at` on the row; a PACK's credits follow the money: `reconcile_pack_withdrawal(session, withdrawn)` takes back the refunded share of the pack's credits, never below a zero balance (`clawed_credits` = what was really taken; ledger `pack_refund` / `pack_refund_reversed`, keyed `refund:pack:<session>:<reconcile_seq>` — a per-row counter bumped inside the lock) — a retried event with the same state posts nothing (it reconciles to a target) | one `billing_alert` per (charge, amount) |
| `charge.dispute.created` | `dispute_id` / `dispute_status` / `disputed_cents` / `disputed_at` (the dispute is re-read from Stripe — never the event's snapshot — and a row in a final status never goes back to an open one); a pack's credits are taken back while the dispute is open or lost (needs_response / under_review / lost) | one per (dispute, status): "Respond in Stripe" |
| `charge.dispute.closed` | the status; won → the credits come back (`pack_refund_reversed`) | one per (dispute, status) |
| `radar.early_fraud_warning.created` | nothing moves | one per warning: "expect a dispute; consider a refund now" |

A charge that matches no sale (older rows have no payment intent; something
paid outside the app) still alerts, as "unmatched". The claw-back reconciles
to a TARGET: when the balance could not cover it (the credits were spent)
the shortfall stays owed and any later event for the session takes it from
credits earned since. Access on a SUBSCRIPTION
is never changed here: turn on Dashboard → Settings → Billing →
Subscriptions → "cancel the subscription on a dispute" (owner step) if you
want that. The Revenue panel labels refunded / disputed rows and shows the
refunded total beside the gross totals (never subtracted); `disputed` counts
sales under dispute or lost.

**Owner steps (live; the sandbox endpoint was updated from this PR):**
subscribe the four events on the live endpoint
`we_1TrupnQFLEpCg9s2bSILz13V` (Workbench → Event destinations → the
endpoint → Update → add `charge.refunded`, `charge.dispute.created`,
`charge.dispute.closed`, `radar.early_fraud_warning.created`); confirm
Smart Retries are on. Every endpoint now needs all **thirteen** events.

## A cancelled subscription (2026-10-07)

A customer who cancels keeps the plan until the date it ends; until then the
subscription is still `active` (or `trialing`). Stripe says "it will not
renew" in three ways, and `subscriptionEndsAt()`
(`lib/billing/subscription-ending.ts`) is the ONE reader of all of them:

| Stripe says | Ends on |
|---|---|
| `cancel_at_period_end: true` | the period end (the trial end while `trialing`) |
| `cancel_at: <timestamp>` — what the Customer Portal and newer API versions write; `cancel_at_period_end` can stay `false` | that date |
| a subscription schedule with `end_behavior: "cancel"` | the schedule's last phase end |

Why the portal writes the date: every subscription this app creates is in
Stripe's **flexible billing mode** (the default for Checkout-created
subscriptions since API `2025-09-30.clover`; the client pins
`2026-05-27.dahlia` and never sets `billing_mode`), and in that mode a
Customer Portal cancellation sets `cancel_at_period_end: false` and
`cancel_at` = the period end
([Stripe: compare billing modes, "Cancellations in the Customer Portal"](https://docs.stripe.com/billing/subscriptions/billing-mode/compare)).
A `classic` subscription gets both the flag and the date.

Until 2026-10-07 only the boolean was read, and the trial copy was decided
before the cancellation was looked at: a subscriber who had cancelled in the
portal was told "Renews on …", and a cancelled trial "then $6 on the card
below".

- **Billing page**: the live Stripe read (`SubscriptionSummary.endsAt`) decides,
  so it is right on the next page load whatever the profile row says; the
  profile's flag + `current_period_end` are the fallback when Stripe is
  unreachable. Order (`planStatusOf`): delinquent → cancelled trial
  (`trial_ending`: ends, no charge) → cancelled plan (`ending`: the date, the
  perks kept until then) → running trial → scheduled downgrade
  (`pending_change`, NOT a cancellation) → renews. A plan that is ending shows
  the badge "Ending" / "Trial ending", **Resume {Plan}** (in-app since the
  follow-up below) and no "Cancel plan".
- **Honest edges** (`planStatusOf`): an end date PAST the next renewal (a
  custom date set in the Dashboard, a schedule that ends in a cancellation
  after another phase) is `ending` with `billedBeforeAt` — "still billed as
  usual, next on …", never "nothing more is charged"; a subscription Stripe
  reports as `canceled` while the profile still says live (a missed
  `customer.subscription.deleted`) is `stale` — "Stripe reports that this
  subscription has ended", badge "Ended", no Cancel / Resume — never "Renews".
- **Changing plan while ending**: see "Follow-up" below (a downgrade resumes
  the plan first, by flag or by date; an upgrade goes to the portal's
  confirm page, which renews it).
- **Trial reminder**: `trial_will_end` for a trial already set to end at or
  before its trial end sends nothing (the old "your card is charged then"
  was false for it).
- **Profile row**: `profiles.cancel_at_period_end` is written by the sync as
  `endsByPeriodEnd()` — true when the subscription stops at or before the
  stored period end, however Stripe expresses it (a `cancel_at` in a LATER
  period still renews first, so the flag stays false and the billing page
  shows the exact date). The exact date is stored beside it since 0135
  (below).
- **Existing rows**: a subscription cancelled before this shipped keeps a
  stale `false` flag until its next `customer.subscription.*` event or an
  admin **Resync from Stripe** (`/admin/users` → the user). The billing page
  does not depend on it.

### Follow-up (2026-10-07): the dashboard says so, Resume in one click, the admin sees it

**One reader for every page without a Stripe call** — `planEndingOf()`
(`lib/billing/plan-ending.ts`) turns the profile row into
`{ kind: "plan" | "trial", endsAt, billedBeforeAt, canceledAt }` or null, and
`planEndingSentence()` is the copy ("Your Pro plan was cancelled and ends on
October 23, 2026. You keep Pro until then." / "You cancelled your Plus free
trial. It ends on … and you won't be charged." / "… set to end on …. It is
still billed as usual until then — next on …"). It reads two columns the sync
writes (**migration 0135**): `profiles.subscription_ends_at` (the exact date
the live subscription stops — `subscriptionEndsAt()`, with a schedule that
ends in a cancellation looked up by id) and `subscription_canceled_at`
(Stripe's `canceled_at`), both null for a plan that renews. Both are private
billing columns: pinned by `protect_billing_columns`, returned by
`get_my_billing()` and `admin_list_users()`, never in the public column
grant. A row synced before 0135 falls back to `cancel_at_period_end` + the
period end; the sync itself survives a database that hasn't run 0135 yet
(it retries without the two columns and logs).

| Surface | What it says for a cancelled, still-active plan |
|---|---|
| Dashboard (`components/dashboard/plan-ending-notice.tsx`) | a notice: the sentence, "Afterwards you're on the free plan…", **Resume {Plan}**, Billing. The credits / saved-cards badges read "Pro plan · ends Oct 23, 2026". |
| Settings (`BillingPanel`) | badge "Ending" / "Trial ending", the same sentence, **Resume {Plan}** (in-app), "Billing portal". |
| Avatar menu | "Billing · Pro ends Oct 23, 2026" (`HeaderUser.subscriptionEndsAt` from `/api/me`). |
| Upgrade modal | the plan's row: "Your current plan — cancelled, ends …" + **Resume {Plan}**. |
| Plan grid (`pricingCtaFor` → `{ kind: "resume" }`) | the plan's own card: "Your current plan · ends …" + **Resume {Plan}**; the Free card: **Resume {Plan}** (it showed no button); the other paid card still switches. |
| `/admin/users` | list + detail badge "cancelled, ends Oct 23, 2026" (`… (billed first)` for a later date, "trial cancelled, …"); detail rows Cancellation / Plan ends / Cancelled on / Billed again before it ends (`lib/admin/user-cancellation.ts`); segment filter "Cancelled, still active" (`flag=ending`). Before this the page showed a cancellation only once the plan had ENDED (status `canceled`) — a pending one was a "Cancels at period end: yes/no" row in the detail and nothing in the list (the RPC returned neither the flag nor a date). |

**Resume in the app** — `ResumePlanButton` (`components/billing/resume-plan-button.tsx`)
opens a confirm step that states what happens, read from Stripe by
`getResumePreviewAction()` ("Your Pro plan will renew on October 23, 2026 at
$15 / month. Nothing is charged today."; a trial: "…free trial will carry on
until …; then Pro starts at …"), then calls `resumeSubscriptionAction()`:
the profile's OWN subscription (id from the profile, customer checked), the
un-cancel, a resync of the profile through the one sync, a
`subscription_resumed` funnel row (props tier / interval / trial /
subscriptionId / surface), `?billing=resumed`. On any failure the result
carries `fallback: "portal"` and the button opens the Customer Portal (its
own "Renew plan"). No notification is sent.

The un-cancel (`clearCancellation` in `lib/stripe/actions.ts`), as the
sandbox answered on 2026-10-07 (flexible billing mode, the connector's API
`2026-09-30.preview`; the app pins `2026-05-27.dahlia`):

| Subscription | Call | Result |
|---|---|---|
| portal-cancelled: `cancel_at` = `items.data[0].current_period_end`, `cancel_at_period_end: false`, `canceled_at` set | `POST /v1/subscriptions/{id}` `cancel_at=""` | `cancel_at: null`, `canceled_at: null`, `cancellation_details.reason: null` |
| same | `cancel_at_period_end=false` | also clears it (a `cancel_at` equal to the period end) |
| `cancel_at` in a later period | `cancel_at=""` | cleared |
| any | `cancel_at=""` **and** `cancel_at_period_end=false` | **400** "Received both cancel_at_period_end and cancel_at parameters. Please pass in only one." |

So: the flag (when true) is cleared first with `cancel_at_period_end: false`,
then a date that is still there with `cancel_at: ""` — one parameter per
call. A schedule whose `end_behavior` is "cancel" is switched to "release"
(NOT sandbox-verified: the connector has no schedule writes; the app never
creates such a schedule).

**Changing plan while ending** — a **downgrade** runs `clearCancellation`
first (after releasing any schedule) and only then builds the schedule, on
what is by then an ordinary renewing subscription; if Stripe leaves the plan
set to end, nothing is scheduled and the action says to resume first. An
**upgrade** goes to the portal's `subscription_update_confirm` page as
before: on an ending plan that page reads "Your subscription is currently
scheduled to cancel on …. By confirming, your updated subscription will be
renewed with the following details." (read in the sandbox; not confirmed —
that would charge the test card) — so the customer who backs out keeps the
cancellation, and the one who confirms is renewed with Stripe saying so.

**Admin Resync** (`adminResyncSubscriptionAction`) also reads the
subscription the profile points at (with its schedule) and syncs from it
when the customer's subscription list comes back empty or fails — it used to
write nothing and still toast "Synced: no live subscription in Stripe". The
toast now names a pending cancellation ("Synced: pro · active · cancelled,
ends Nov 8, 2026").

**Funnel** — `subscription_cancelled` is still written when the subscription
ENDS (the `deleted` event), so a subscriber who has cancelled but is active
counts as a subscriber until then, and one who resumes never counts as a
cancellation; `subscription_resumed` counts the resumes. Revenue reads only
`billing_payments` (paid invoices) and `billing_pack_payments` (paid packs,
§7) and is unaffected.

### Follow-up 2 (2026-10-07): a late event cannot store a state the plan has left

**The race.** Cancel in the Customer Portal, then Resume in the app seconds
later. Stripe generates two `customer.subscription.updated` events — the
cancellation's (snapshot: `cancel_at` set) and the resume's (snapshot:
`cancel_at: null`). Delivered in the other order, or with the first one
retried later, the profile ended up "ending" while Stripe renewed the plan:

1. portal cancel → Stripe: ending
2. app Resume → Stripe: renews; the action resyncs the profile → renews
3. the resume's event arrives → renews
4. the cancellation's event arrives late → the sync merged the EVENT's
   snapshot over the subscription it had just listed → profile: ending, until
   the next event (for a monthly plan: the renewal)

The dashboard notice, Settings, the avatar menu and `/admin/users` read the
profile, so all four said "ends on …"; the billing page reads Stripe live
and disagreed with them. The same merge had a worse form: an old `updated`
event delivered after `customer.subscription.deleted` wrote a live plan back
onto the profile, and a dead subscription sends no further event to fix it.

Why the snapshot was merged at all (commit 19a03d41, the 2026-09-14
tier-demotion fix): "so a just-deleted subscription can't read as live" —
right for `deleted`, wrong for every other event.

**The rule** (`syncSubscriptionForUser`, `lib/stripe/subscription-sync.ts`).
Stripe's guidance is not to depend on delivery order and to fetch the
object: "Stripe doesn't guarantee the delivery of events in the order that
they're generated … Make sure that your event destination isn't dependent on
receiving events in a specific order … You can also use the API to retrieve
any missing objects" ([docs.stripe.com/webhooks#event-ordering](https://docs.stripe.com/webhooks#event-ordering)).
So an event only names the subscription:

| What is given | What is written |
|---|---|
| `eventSub` (a webhook snapshot) | the subscription **read again by id** (`subscriptions.retrieve`), in parallel with the customer's list; the read wins over the list's row for it (the guard against a list that lags), the list's row wins over the snapshot, and the snapshot is used only when neither read has it (Stripe unreachable; a just-created subscription neither read knows yet) |
| `eventSub` + `eventDeleted` (`customer.subscription.deleted`) | ended, even if a read still shows it live — deletion is terminal, an ended subscription never comes back |
| a read that says `canceled`, no `deleted` event (an old event after the deletion) | ended too — but only when the list was readable, so it is known that nothing else is live |
| `currentSub` (the caller's own fresh object: `invoice.paid`'s retrieve, the Resume action's update response, the admin Resync's retrieve with its schedule) | taken as it is, not read again |

No event id / timestamp bookkeeping: Stripe says not to order by `created`
(one-second resolution), and with the state always re-read a duplicate or
late delivery is simply another sync of the present.

**The 2026-09 protections are untouched**: the primary is still picked from
the whole list (live, highest tier, newest) so a secondary subscription's
event cannot demote; an unmapped price on a live subscription still keeps
the tier; an empty or failed list still writes nothing when no subscription
was given, and with one given the subscription itself (read by id, else the
snapshot) is synced — never "free" from a transient empty read. "Free" is
written in exactly two cases: the subscription given has ended (above) and
nothing else is live.

**When the list cannot be read** (a transient Stripe error; the read by id
may still work) the subscription given is synced on its own, as before —
with one exception added in review: if it is NOT live and the profile sits
on a DIFFERENT subscription whose stored status is live, nothing is written.
That is an event for a secondary subscription (the superseded no-card
trial's `deleted`, a late event for a plan that ended long ago), and without
the list nothing says the other one stopped — writing it was the 2026-09
demotion again, until the paid plan's next event. The stored subscription's
own `deleted` event clears the id, so the guard cannot keep a lapsed plan
paid.

Every way the sync writes tier `free` or clears `stripe_subscription_id`:

| Path | Fires when | Why a live payer is safe |
|---|---|---|
| `deleted` event, list readable | the list (with the ended subscription merged in) holds nothing `active` / `trialing` | any live subscription is picked as primary first |
| a read of `canceled`, no `deleted` event, list readable | same | same |
| `deleted` event (or the admin Resync of a subscription read as `canceled`), list unreadable | the profile does not sit on another live subscription | the guard above |
| anything else | never: a non-live status keeps the tier and the id (the status gates perks), an unmapped live price keeps the tier, no subscription given writes nothing | — |

What the handler still takes from the event itself: the funnel rows
(`trial_converted`, `subscription_changed`, `subscription_cancelled` — they
record what that event said, with its `previous_attributes`), and the
creation flag for the one trial grant, which keys on the SYNCED state
(a late `created` event for a trial that has converted grants the month's
allotment, idempotently, not a second trial tranche).

### Follow-up 2 (2026-10-07): billing dates in the viewer's time zone

Every billing date was formatted in UTC, so a subscriber west of Greenwich
whose period ends in the early UTC hours was shown the NEXT calendar day: a
plan ending `2026-11-08T02:31:04Z` read "November 8" in the app and
"November 7" in Stripe's portal (which prints the browser's day) for anyone
in the Americas.

`<LocalDate iso>` (`components/ui/local-date.tsx`, a client component) is
now how a subscriber-facing billing date is printed: the server — and the
first client render, which must match it — prints the UTC date inside
`<time dateTime=…>`; once hydrated the same shape is printed in the
browser's zone (`useSyncExternalStore`, so no hydration mismatch;
`suppressHydrationWarning` on the element as a belt). The format options are
`DATE_FORMATS` in `lib/format/dates.ts` — the one source — so only the day
can change, never the form. A sentence with dates in it is kept as parts
(`DateText`: `planEndingText`, `planEndingShortText`, `planBadgeText`,
`resumeConfirmText`) and printed by `<LocalDateText>`; the same parts make
the UTC string (`planEndingSentence`, `resumeConfirmCopy`, …) for a reader
with no browser. `useLocalDateText` is the string form for a label that
cannot hold elements (the account menu row).

| Surface | Dates |
|---|---|
| Billing page (`PlanStatusLine`) | plan ends on · renews on · still billed next on · trial ends on · scheduled change on · comp "until" |
| Billing page, invoices | each invoice's date |
| Resume confirm (`ResumePlanButton`) | "will renew on …" / "trial will carry on until …" |
| Dashboard notice + the credits / saved-cards badges | the sentence; "Pro plan · ends …" |
| Settings (`BillingPanel`) | the cancelled-plan sentence; "Renews on" / "trial ends on" (the page passes a `<LocalDate>`; it was a server-formatted string) |
| Plan grid (`PlanCard`) | "Your current plan · ends …" |
| Upgrade modal | "Your current plan — cancelled, ends …" |
| Account menu | "Billing · Pro ends …" |
| Usage page (`/dashboard/usage`) | when each generation / ledger row happened (`format="stamp"`: "Nov 7, 6:31 PM") |

`tests/unit/billing/billing-dates-local.test.ts` holds that list: each file
prints through the component and formats no date on the spot — a new
surface with a billing date is added there.

**Admin pages stay UTC and say so** (an admin reads about a user in another
zone): `formatUtcDate` / `formatUtcDateTime` — the directory badge
("cancelled, ends Oct 23, 2026 UTC"), the detail rows (Plan ends, Cancelled
on, Billed again before it ends, Period ends, Comp until), the Resync toast,
the Revenue panel's payment dates and the Funnel panel's trial start dates.
"Period ends" and "Comp until" were printed with a bare `toLocaleString()` —
the server's zone, unsaid.

**Server-built strings cannot know the viewer's zone** and stay UTC:

| String | Zone | Can it contradict the page? |
|---|---|---|
| Trial-ending email (`trialEndingEmail`) | UTC date in the subject / heading; the sentence that states the charge now adds the time and the zone: "ends on **November 8, 2026** (2:31 AM UTC)" | It could: the email is the reminder before a charge, and "November 8" was the day AFTER the one the billing page shows in the Americas. With the time and "UTC" beside it, it no longer reads as the reader's own day. |
| Win-back email (`trialWinbackEmail`: "subscribe before …") | UTC, now explicit (it was the server's zone) | By a few hours at the very end of a 30-day window; left as it is. |
| Notifications (`lib/notifications/describe.ts`: `trial_ending` "ends on …", `comp_plan` "until …", `trial_lapsed` "by …") | `formatShortDate`: the zone of whoever runs it — the viewer's in the bell and the toast (client-rendered, so they AGREE with the page), the server's (UTC) in the server render of `/notifications` and in the weekly digest email | The `/notifications` server render can show the UTC day for a moment before hydration; not changed here (it is every notification date, not a billing surface) — see the PR's open questions. |
| Toasts (`?billing=…` return toasts, the Resume / downgrade results) | none of them carries a date | — |
| Admin Resync toast | UTC, labelled | — |

## Addendum — sandbox lifecycle run (2026-09-22, test clock `clock_1UIftGQFLEpCg9s2uoFgd7kf`)

Two clock-bound sandbox customers, driven through the Stripe API:

| Step | Result |
|---|---|
| No-card customer → Plus monthly with a 7-day trial and `missing_payment_method: cancel` | `trialing`, `trial_end` = +7 days, no invoice, a pending SetupIntent (what the portal uses if they add a card). |
| Card customer (`pm_card_visa`) → Plus monthly | `active`; invoice `…-0001` for $6 paid on creation. |
| Upgrade Plus → Pro, `proration_behavior: always_invoice` (what the portal's confirm-update flow does) | Same subscription id, now Pro; invoice `…-0002`: −$6 unused Plus + $15 Pro = **$9 charged immediately**; period end unchanged. |
| Downgrade Pro → Plus, same proration | Invoice `…-0003` totals **−$9**; nothing charged, the $9 lands on the customer balance (−900) and offsets the next renewal. Status stays `active`, period end unchanged. |
| Cancel at period end | `cancel_at_period_end: true`, `cancel_at` = period end, status still `active` (perks continue). |

Not run: advancing the clock past the trial end (should cancel the no-card
trial) and past the period end (should delete the canceled subscription) —
the Stripe MCP in this session exposes test-clock *creation* but not
*advance*. Dashboard → Customers → Test clocks → "pipglyph lifecycle
2026-09-22" → Advance time does it in one click; expect
`customer.subscription.deleted` for both, which the webhook maps to tier
free / status canceled.

What this confirms about the app: the webhook's `subscription.updated`
handling sees the new price on the same subscription (upgrade and downgrade),
`cancel_at_period_end` flows through to the billing page's "ends on" copy
(a `cancel_at`-only cancellation did not until 2026-10-07 — see "A cancelled
subscription"),
and a Plus → Pro switch is a $9 prorated charge — the copy on the billing
page says exactly that.

## The days bank — the free period (owner 2026-11-06, migration 0179)

A free trial is no longer a thing of its own. **Every new account gets 7
SIGNUP days in a bank** (`day_bank_entries`, `lib/billing/day-bank.ts`); the
referral program banks more (the ladder, docs below once PR 2 lands). The
bank is TIER-LESS: banked days are days of whatever plan the user checks
out on or already has.

- **The first checkout applies the whole bank** as the free period before
  the first charge — card required (Checkout collects it), Stripe
  `trial_period_days` = the days (whole days from the moment the checkout
  completes — never a `trial_end` instant a slow checkout eats into),
  `missing_payment_method: cancel`; the plan bills by itself when the days
  end. `createCheckoutSessionAction` → `prepareCheckoutBank`: the signup
  entry is made (or REVOKED) under the rule the trial had — never
  subscribed on this account, no Stripe history under the email
  (`isTrialEligible`, now TRI-STATE: a Stripe read that fails answers
  "unknown" and the checkout REFUSES with "Couldn't check your free days…"
  — never a verdict, since a revoked signup entry is for good) — then every
  banked day is RESERVED under a batch (`bank_batch` in the session
  metadata; the session id is stamped on the batch's rows once Stripe made
  it, `stampBankBatchSession`). An account that trialled before and EARNED
  days checks them out as a free period all the same. A comp that already
  holds the first charge PAST the bank's end leaves the days banked
  (`skipIfEndsBefore`: the user applies them on top later); one that ends
  inside the bank holds nothing (the bank is the free period). A single
  banked day checks out (`MIN_BANK_DAYS_AT_CHECKOUT` = 1: `trial_period_days`
  has no 48 h floor). Before reserving, `reclaimOpenCheckouts` expires every
  OPEN Checkout session the user backed out of and returns its days (an
  abandoned session held them up to 24 h and the next click sold without
  the free period). `checkout.session.completed` spends the batch
  (`applied`, via `checkout`; it also takes rows the sweep put back to
  `banked` with their batch kept — Stripe retries an event for days),
  `checkout.session.expired` returns it; a session that could not be
  created returns it at once; a reservation nothing settled is released
  after 25 h (`releaseStaleReservations`: the daily refill cron, and the
  hourly referral sweep once PR 2 lands).
- **Days earned later wait in the bank** and the user applies them by hand
  (the billing page's "Apply N banked days", `applyBankedDaysAction` →
  `applyBankToPlan`): on a LIVE plan — a free period or paid time — the days
  are added to its time through the free-days mechanism as a HOLD only
  (`holdOnly`: never a perks overlay, the days must end in a charge; a
  cancelled or past-due plan is refused with the reason), a `plan_grants`
  row of source `day_bank` with an exact `days` and `grants_credits` false.
  With no live plan the page sends them to /pricing: the checkout applies
  the bank.
- **No credits** come with banked days (the ladder's credits are their own);
  the trial tranche (`TRIAL_CREDITS`, 25) is granted ONCE per account, on the
  first free period only (`grantTrialCreditsForPeriod` reads the ledger for
  an earlier `trial_grant`).
- **Existing users**: no backfill. The signup days are decided at the first
  checkout by the rule above; a running trial continues untouched; an
  account past its trial banks nothing and earns through referrals.
- The win-back offer and the "trial ended" notice keep working on whatever
  free period ends unconverted.

## Free 30 days — comps on one mechanism (owner 2026-11-05, migration 0176)

A comp is **N units of exactly 30 days** (30 × 86 400 s, exact to the second)
of a paid tier with that tier's normal monthly AI credits and nothing else —
the same mechanism the referral reward (PR F) uses. It replaces the dated
overlay the admin typed by hand, #688's balance credit and #726's coupon:
**no money moves for free days, ever.** Design and the owner's answers:
`docs/research/free-months-design-2026-11.md` §6.

- **The row**: `plan_grants` (user, tier, units — NULL = no end —, source
  `comp` / `referral_friend` / `referral_referrer` / `promo`, who granted it
  and a note, `applied_as`, `starts_at` / `ends_at`, `credits_from`, status
  `pending` → `applied` | `failed` | `revoked`). Service role only; a user
  reads their own rows' public columns (never the note or the granter).
- **The decision** (`lib/billing/free-days.ts` `planFreeDays`, pure; read
  from the profile and Stripe's CURRENT subscription) and **the writer**
  (`lib/billing/free-days-apply.ts` `grantFreeDays`: the row first, then
  Stripe under the idempotency key `plan-grant:<id>`, then the overlay, then
  `applied`, then the FIRST credit allotment at once — `grantCreditsForGrant`,
  so a referral's free days never read "Plus plan · Remaining 4" until the
  06:00 UTC cron (owner, production 2026-11-06); a refused first allotment
  is a warning the cron catches up; a Stripe failure leaves a `failed` row
  and nothing else):

| The user has | N × 30 days become | Credits |
|---|---|---|
| a live, RENEWING plan or trial, the tier at or above the one paid for (`subscription_hold`) | **added to the time paid for**: `trial_end` = the current period's end (a trial: its own end) + N × 30 d, `proration_behavior: none` — the documented way to push the next charge out (a trial on the existing subscription; `billing_cycle_anchor` cannot take a date). Monthly: the billing day moves; annual: the renewal moves; a trial runs longer. The subscription reads `trialing` until then; Stripe issues a $0 invoice the moment the trial is added (the cycle resets to it — no money, `billing_reason` `subscription_update`, listed as "Trial start" in the admin Revenue panel); the next invoice is the plan's own price on the new date. The end it had before ANY hold stays in metadata `pipglyph_trial_end_before_comp`. The overlay (`comp_tier` / `comp_expires_at`) is written to the SAME instant (the billing page, the reworded trial reminder and the comp-ending reminders read it). | one allotment per 30 days of the grant, at the start of each (`grant:<id>:<k>`, reason `plan_grant`); the subscribers' sweep still grants the PAID time before the hold starts (an annual plan held 200 days before its renewal keeps its monthly allotments — `refillTierFor` `heldBeforeStart`) |
| no live plan: free, lapsed, a cancelled plan still running (the days start when it ends), one past due (dunning keeps its own dates) (`overlay`) | the overlay alone, from the later of now and its current end; the overlay carries ONE tier — the higher of what it holds and what is granted — for the whole stretch | the same per-30-days allotments |
| a grant BELOW the tier paid for (`below_plan`) | recorded, nothing changes | none |
| `units` NULL — **staff only**: an account with NO Stripe subscription | the overlay with no expiry | every 30 days, open-ended |

- **Credits** (`lib/billing/free-days-credits.ts`, run by the daily refill
  cron after the subscribers' sweep): a 30-day grant starting Nov 20 is 30
  credits once — never a second on Dec 1 (the retired rule, "an unexpired
  comp is owed its tier every calendar month", banked both). A comp
  converted by 0176 counts from the first of the month after the
  conversion. `grant_credits` dedupes on the key.
- **A held PAYING plan is never a trial** (the independent check, 2026-11-05):
  the hold writes `pipglyph_hold_from` = `active` | `trialing` on the
  subscription (`held_from` on the row). For `active`: the time until the
  hold's `starts_at` is PAID time — the subscribers' sweep keeps its monthly
  allotments (applied or revoked hold), a declined renewal after the days
  gets the dunning grace (never "a trial that declined"), no `trial_lapsed`
  / win-back on a cancel, no `trial_converted` funnel row, the pack
  discount stays, and `trial_will_end` with no comp holding the trial any
  more (revoked: the trial is back on the paid period's end, which simply
  renews) sends nothing — the billing page then says "Renews on …". A hold
  on a TRIAL adds no paid time (`trialing`). The hold sets
  `missing_payment_method: cancel`, as Checkout's trial does.
- **An overlay grant on an ACTIVE plan** (a comp 0176 converted on a
  payer, a past-due plan that recovers) adds only the DIFFERENCE between
  the tiers' credits (`overlayAllotmentOver`: Pro days on a Plus plan = 70;
  the plan's or a lower tier = 0) — the overlay's old "higher of the two"
  rule, never a second allotment.
- **One grant in flight per user** (0176's partial unique index on pending
  rows): two admins granting at once would both add the days to the same
  period end; the second insert is refused ("try again"); a pending row
  older than 10 minutes (a crash) is marked failed first. A plan under a
  subscription SCHEDULE (a pending downgrade) is refused with the way out
  (release it on the billing page); Stripe would refuse the update anyway.
- **Plan changes and cancels during free days** (the owner's question,
  2026-11-05). No plan + an overlay: buying the overlay's tier or a lower
  one is not charged before the days end (`compHoldsCheckoutUntil`); a
  HIGHER tier is bought now (the days below it are swallowed — perks are
  the higher of the two, the grant's extra credits are 0, no reminder);
  there is nothing to cancel — the days run out and the 7-day / 1-day
  reminders say so. A held PAYING plan: cancel → the plan ends when the
  free days end, nothing charged, every perk kept until then (no lapsed
  trial, no win-back); DOWNGRADE → scheduled for the free days' end
  (`scheduleDowngrade` on the trialing subscription — the portal would have
  applied it at once and taken paid-for perks away); UPGRADE → the portal's
  confirm (`continue_trial`): the higher tier from now, its first charge
  when the free days end — the remaining paid time and the days are
  upgraded for nothing (accepted: bounded, and the user is upgrading).
- **Revoke** (`adminRevokeFreeDaysAction` → `revokeFreeDays`, the NEWEST
  applied grant only; `planRevoke`): the overlay shrinks by the grant's days
  (cleared when no other live grant remains — or when that end is now or
  earlier), and a Stripe trial held at the overlay's end moves back the same
  way, never before the end it had before any hold; "now" when that has
  passed (the charge it would have made; the user's notice says only that
  the access ended). Idempotency key `plan-grant-revoke:<id>`.
- **Precision and copy**: the end is exact to the second; the billing page
  prints it with its time in the viewer's zone (`<LocalDate format="stampYear">`:
  "Your plan is paid through …. Your free days run from then until …, then
  Plus continues at $6 / month on the card below"), the admin's toast and
  list in UTC, labelled. Every surface says "free 30 days" / "free days" —
  never "a free month". The user's `comp_plan` notification names the days
  and their end, and on a hold the moved charge ("added to the time you've
  paid for: your next charge moves to …").
- **Admin UI** (`/admin/users` → a user → "Free days (comp)"): plan, length
  (30 … 360 days in 30-day units, or "No end (staff)" when there is no live
  plan), a note; the list of grants (newest first, what each did, by whom)
  with Revoke on the newest applied one.
- **Checkout while comped** is unchanged: a user with a running overlay who
  subscribes is not charged before it ends (`compHoldsCheckoutUntil`:
  `trial_end` at the overlay's end, metadata = the 7-day trial's end or the
  checkout itself); revoking the grant behind it puts the trial back
  (`planRevoke` reads the metadata). A cancel during free days is not a
  lapsed trial (`isUnconvertedTrial`), and Checkout never applies the
  win-back coupon to a hold.
- **Sandbox proof**: `npm run stripe:sandbox-free-days-check` (test clocks:
  the owner's example, a held trial, an annual hold, a revoke); the run is
  recorded in the addendum at the end of this file.

### "Your complimentary plan ends soon" (owner 2026-11-02)

Every comp is told before it ends: a `comp_ending` notification (migration
0161 adds the kind) AND an "account" email (`compEndingEmail`, the one
shell, gated by `email_preferences` like the trial reminder), **7 days and
1 day** before `comp_expires_at`. A daily cron, `/api/cron/comp-ending`
(`vercel.json`, 14:30 UTC, `cronRouteGuard`; `lib/billing/comp-ending-run.ts`,
rules in `lib/billing/comp-ending.ts`) reads the profiles whose LIVE comp
ends in the next 7 days: window `7d` = ends in (now + 1 d, now + 7 d], `1d` =
ends in (now, now + 1 d]. Expired, cleared and undated comps — and admins —
are never told, and nothing runs while billing is off (`isBillingEnabled()`:
"choose a plan" and the prices would be false). A run with any failed
profile answers 500 (as `refill-credits` does), so it shows as failed.

- **Exactly once per comp per window:** the notification's
  `payload.dedupeKey` = `comp_ending:<comp end epoch>:<window>`, held by a
  unique partial index (0161) with the recipient. The insert is the dedupe:
  a 23505 means "already told" and no email follows. The comp's END is in
  the key, so a re-dated comp is told afresh. The email's idempotency key is
  `comp-ending:<user>:<dedupeKey>`.
- **What it says** — read from Stripe's CURRENT subscription (re-read, card
  expanded; never a snapshot), one copy per kind:
  - `free` (no live plan, or a cancelled one ending with the comp): "Your
    complimentary Plus ends on <date>. After that you'll be on Free" + what
    they keep + "Keep Plus" → `/dashboard/billing` (its plan grid);
  - `held_trial` (the comp holds a trial, `isCompHeldTrial`): "Your card
    ending ••<last4> will be charged <price> then" + how to cancel before —
    or, with no payment method (`subscriptionHasPaymentMethod`), that the
    plan simply ends and nothing is charged;
  - `paying` (a plan the days could not be added to — past due, a hold that
    failed — or a trial that runs on past the comp): "your next invoice, on
    <date>, is charged as usual (<price>)" — a date only when the next
    charge falls AFTER the comp's end; otherwise "invoices after <comp end>
    are charged as usual";
  - `plan_ending` (a cancelled plan that runs past the comp): it ends on its
    own date, nothing more is charged.
  The payload names BOTH plans: `tier` (the comp's — what ends) and
  `subscribedTier` (the live subscription's — what is charged after). When
  a payer was comped a HIGHER tier (a Plus plan or trial comped Pro) every
  copy says "you go back to Plus (<Plus's price>)", never that the plan
  "stays as it is"; the reworded trial reminder carries `compTier` and names
  the same two plans. A comp below the plan paid for is not told (its end
  changes nothing). A
  payer whose subscription can't be read is skipped that day (the next run
  retries inside the window).
- **One email per moment — the TRIAL REMINDER speaks for a comp-held
  trial.** Stripe's `trial_will_end` (3 days before) reaches the same user
  at almost the same moment as the 1-day comp reminder. So: when the live
  subscription carries `pipglyph_trial_end_before_comp` and its trial end is
  the comp's end (± 60 s), the `trial_ending` notification (`compHold: true`)
  and email say it is the END OF THE COMPLIMENTARY PERIOD and that the card
  is charged <price> on <date> — never "your trial" — and the 1-day
  `comp_ending` SKIPS that user, but ONLY when such a reminder really went
  out: a `trial_ending` row for that subscription with `compHold` and a
  `trialEnd` equal to the comp's end. A comp re-dated to end within a day
  may get no `trial_will_end` from Stripe at all, and then the 1-day
  `comp_ending` is sent. Its 7-day reminder is always sent. Any other
  trial's reminder is unchanged.
- The weekly activity digest lists `comp_ending` rows (price and card's
  last four included) to the same user only, as it already does for
  `trial_ending`.

### The balance credit on an active plan — RETIRED (2026-11-05)

#688 credited a paying user's comp period to the Stripe customer balance;
0176 replaced it with the hold above (no money moves). A credit posted
before that date stays on the customer's balance and Stripe takes it off
the next invoice as it always did; nothing claws it back.

Proof: `tests/unit/billing/free-days.test.ts` (one scenario per rule — the
owner's example first), `free-days-apply.test.ts`, `free-days-credits.test.ts`,
`stripe-actions.test.ts` (Checkout while comped), `webhook-handlers.test.ts`
(the reworded reminder), `tests/unit/db/plan-grants-migration.test.ts`.


## Addendum — sandbox test-clock run, free 30 days (2026-11-05, `npm run stripe:sandbox-free-days-check`)

The four scenarios, through the SAME writer the admin's action calls
(`grantFreeDays` / `revokeFreeDays`), each on its own test clock (deleted
after). Prices are the sandbox catalog's. Read: the hold adds the days to the
time paid for, nothing is charged on the old day, the full price lands on
the moved date, a revoke puts the original day back; Stripe issues a $0
invoice the moment a trial is added to a running subscription (the cycle
resets to it — no money, the admin Revenue panel lists it as "Trial start").

```
sandbox catalog: pro_monthly $15.00, plus_monthly $6.00, plus_annual $60.00

1. Monthly Pro paid on day 0; 30 free days on day 5 → charged on day 60, not day 30
  ✓ active, period ends 2026-12-06T00:19:06.000Z
  ⏩ clock → 2026-11-11T00:19:06.000Z (day 5)
  ✓ grantFreeDays: Their Stripe plan's next charge moves from Dec 6, 2026, 12:19 AM UTC to Jan 5, 2027, 12:19 AM UTC — the free days are added to the time they paid for.
  ✓ Stripe: trialing until 2027-01-05T00:19:06.000Z = period end + 30 d
  ✓ metadata keeps the pre-hold end
  ✓ overlay written to the same instant
  ✓ grant row applied as subscription_hold
  ✓ one $0 invoice for the hold itself, still one paid ($15.00, $0.00)
  ⏩ clock → 2026-12-07T00:19:06.000Z (day 31: the old billing day has passed)
  ✓ still ONE paid invoice ($15.00, $0.00) — nothing charged on the old day
  ⏩ clock → 2027-01-05T02:19:06.000Z (day 60 + 2 h: the free days are over)
  ✓ second paid invoice: $15.00 paid on 2027-01-05T00:19:06.000Z
  ✓ charged at the moved date (period end + 30 d)
  ✓ then monthly from there: next period end 2027-02-05T00:19:06.000Z

2. A 7-day card-backed trial; 30 free days on day 2 → charged on day 37
  ⏩ clock → 2026-11-08T00:19:31.000Z (day 2)
  ✓ grantFreeDays: Their Stripe trial now ends on Dec 13, 2026, 12:19 AM UTC instead of Nov 13, 2026, 12:19 AM UTC; the first charge lands then.
  ✓ trial now ends 2026-12-13T00:19:31.000Z = its own end + 30 d
  ⏩ clock → 2026-11-14T00:19:31.000Z (day 8: the old trial end has passed)
  ✓ no charge on the old trial end (2 $0 invoice(s))
  ⏩ clock → 2026-12-13T02:19:31.000Z (day 37 + 2 h)
  ✓ first charge $6.00 on 2026-12-13T00:19:31.000Z

3. An annual Plus plan; 30 free days → the renewal moves by 30 days (asserted on the subscription)
  ✓ grantFreeDays: Their Stripe plan's next charge moves from Nov 6, 2027, 12:19 AM UTC to Dec 6, 2027, 12:19 AM UTC — the free days are added to the time they paid for.
  ✓ renewal moved to 2027-12-06T00:19:52.000Z = year end + 30 d
  ✓ nothing charged or credited ($0.00, $60.00; the $0 one is the hold's own)
  ✓ a second grant would stack on the moved end

4. Scenario 1 revoked on day 10 → charged on day 30 after all
  ⏩ clock → 2026-11-11T00:19:58.000Z (day 5)
  ✓ grantFreeDays: Their Stripe plan's next charge moves from Dec 6, 2026, 12:19 AM UTC to Jan 5, 2027, 12:19 AM UTC — the free days are added to the time they paid for.
  ⏩ clock → 2026-11-16T00:19:58.000Z (day 10)
  ✓ revokeFreeDays: Their complimentary access is cleared. Their Stripe trial is moved back to Dec 6, 2026, 12:19 AM UTC.
  ✓ trial back on 2026-12-06T00:19:58.000Z, metadata cleared
  ✓ overlay cleared, row revoked
  ⏩ clock → 2026-12-06T02:19:58.000Z (day 30 + 2 h)
  ✓ charged $15.00 on the original day

All free-days scenarios passed.
```
Proof: `tests/unit/billing/plans-comps-audit.test.ts` (one scenario per
question), `comp-stripe-apply.test.ts`, `stripe-actions.test.ts` (Checkout
while comped), `webhook-handlers.test.ts` (the second reminder). Not
sandbox-verified (no Stripe key in the session that built it): updating
`trial_end` on a card-backed trialing subscription with
`proration_behavior: none` — run it once on a test clock.

## Referrals (2026-10-30, reworked 2026-11-02 and 2026-11-06; migration `0177_referrals.sql`)

Research and the numbers behind each rule: `docs/research/conversion-2026-10.md`
§3 and §8. Code: `lib/referrals/` (rules, settings, fraud, reward, server).
Owner decisions of 2026-11-02 and 2026-11-05 are marked **(owner)**. Since
2026-11-06 the reward is the FREE-DAYS mechanism comps use (the section
"Free 30 days" above) — "free 30 days", never "a free month" **(owner)** —
and what each side gets is a SETTING an admin changes without a deploy.

**The settings** (`site_settings` key `referrals`, `lib/referrals/settings.ts`;
0177 seeds the defaults; the form sits in the admin Referrals panel on
`/admin/users`, saved whole through `adminSaveReferralSettingsAction` with a
confirm step): `enabled` (OFF = a PAUSE: the page says so and hides the
link, a signup through a link records nothing, a friend's first card is
left WAITING — rewarded once the program is on again, expired after the
30-day confirm window like any waiting row; rewards already given stay), `friend` and `referrer` reward specs — `free_days`
(a tier — `own` = the referrer's own paid tier while their plan is live,
Plus otherwise **(owner)** — and 30-day units), `credits` (an amount), or
`none` — and the caps: `perMonth` (3) and `lifetime` (12) referrer rewards,
and `friendsPerMonth` (5) friends a referrer can bring a reward to in a
UTC month, past which the FRIEND gets nothing either (`capped_friends`: N
confirmable inboxes mint nothing — the independent check's P2; a
referrer-only block such as `same_domain` goes through the claim too, so
those friends count). A cap of 0 pauses that side. The
settings are read at grant time; `parseReferralSettings` fills defaults for
anything missing, so a hand-edited row never breaks the program.

**The code and the link.** Every user has ONE code (`referral_codes`), minted
the FIRST time it is asked for — `my_referral_code()` (security definer, the
caller's own session) returns the stored code or inserts 8 lowercase hex
characters cut from `gen_random_uuid()` (retried on the unique index). In the
app that first ask is opening `/dashboard/referrals` (#691), which shows the
link `<site>/?ref=<code>` with a Copy button. Nothing mints a code at signup.
The code rides the existing first-touch attribution — `AttributionCapture`
(sessionStorage, no cookie; a `ref` the tab doesn't hold yet is added to the
first touch, the FIRST code wins) → `AttributionFields` (hidden `attr_ref`) →
`signupAction`, which puts the code on the account's `app_metadata`
(`referral_code` — the server's; never `user_metadata`, which GoTrue merges
for an existing unconfirmed address and the user can edit) for a REAL new
user only, beside the `signup` event (whose props say only
`referred: true`, never the code) and writes NO row: the `referrals` row is
written at ONBOARDING — the first step an account takes with a CONFIRMED
email (`completeOnboardingAction`, first finish only; the metadata's code,
else the tab's for a Google sign-up, which posts no signup form). Never at
signup: GoTrue hands an existing unconfirmed address the same user id, so a
row written then let anyone claim a referral on an inbox they don't own
(the independent check's P1). Either way the account must be NEW — under
`REFERRAL_CLAIM_WINDOW_DAYS` (7) old, never subscribed, no saved card — and
the first claim wins (`referee_id` is unique). Nobody is notified at signup:
nothing is earned yet.

**Activation = the first saved card, with confirmed emails.**
`createCardAction` → `recordActivity` answers true when it wrote
`first_card_saved`, and then (in `after()`, never holding up or failing the
save) `qualifyReferral`: signed_up → first_card in ONE conditional update (a
second save or a retry finds nothing), the window (first card within
`REFERRAL_ACTIVATION_WINDOW_DAYS`, 30, of the signup — else `expired`), and
the reward step AT ONCE (`rewardReferral`; **(owner)** no hold — a 72-hour
hold was specified and then dropped before it shipped; nothing of it is in
the code):

1. **(owner)** both accounts' emails CONFIRMED (`auth.users.email_confirmed_at`)
   before either side is rewarded. Unconfirmed → the row waits in
   `first_card` and the sweep looks again; still unconfirmed
   `REFERRAL_CONFIRM_WINDOW_DAYS` (30) after the first card → `expired`.
   With confirmations OFF (the local stack's `enable_confirmations = false`)
   GoTrue confirms every address at signup, so the rule holds and passes —
   nothing is special-cased;
2. a friend whose account was DELETED → `blocked` (`account_deleted`);
3. fraud (`lib/referrals/fraud.ts`) — **nobody rewarded**: the same inbox
   (case, `+tag`, Gmail dots), a card fingerprint on both Stripe customers,
   a throwaway domain (`DISPOSABLE_EMAIL_DOMAINS`); **the friend only**: the
   same CUSTOM domain (free mail — gmail, outlook, … — and reserved TLDs like
   `.test` never match). Self-referral by id is a table CHECK;
3a. **(owner)** one email, one referral reward — ever (below): the friend's
   normalized email matching ANY OTHER live account (the referrer's
   included), or a fingerprint an EARLIER referral signup left → `blocked`
   (`email_reused`), **nobody rewarded**, the friend never told why;
4. caps — `claim_referral_reward()` (service role, a per-referrer advisory
   lock in the NAMED namespace `hashtext('pipglyph.referrals')`):
   `REFERRAL_MONTHLY_CAP` (3 a UTC month) and `REFERRAL_LIFETIME_CAP` (12)
   rewarded referrals; past either the row is `capped` and the FRIEND still
   gets their reward. The count reads every rewarded row of the referrer —
   `referee_id` is `ON DELETE SET NULL`, so deleting a rewarded friend
   never frees a slot;
5. each side's reward (`grantOwedSides`) and its `referral_reward`
   notification (0164's unique index: once per referral and side). When the
   friend qualified but the REFERRER earns nothing (a cap, not eligible), the
   referrer gets ONE `referral_signup` notification that says so — never a
   fraud reason, and never a promise.

Nothing runs while billing is off (`NEXT_PUBLIC_BILLING_ENABLED`): the
rows wait in `first_card` (the dashboard page is a 404 then).

**One email, one referral reward (owner 2026-11-02).** Deleting an account
and signing up again with the same inbox must not earn a second reward.

- ONE normalization, `normalizeReferralEmail` (`lib/referrals/fraud.ts`):
  trim, lowercase, everything from the first `+` to the `@` dropped (every
  domain), and on gmail.com / googlemail.com the dots dropped and
  googlemail.com read as gmail.com. Its SQL twin is
  `normalize_referral_email()` (0164, service role only); ONE case table,
  `tests/unit/referrals/email-normalization-cases.json`, holds both (the unit
  test and `tests/e2e/referral-email-normalization.spec.ts`).
- What is KEPT is a keyed hash, never the address: HMAC-SHA256 of the
  normalized email under the server-only secret `REFERRAL_EMAIL_HASH_KEY`
  (`lib/referrals/email-fingerprint.ts`), in `referral_email_fingerprints`
  (fingerprint + the FIRST referral that saw it; no user id; `ON DELETE SET
  NULL` from that referral, so no account deletion removes it; RLS with no
  policy, revoke-first, the service role only). Written when a referral
  signup is recorded and again at the reward step if the email changed.
- The check, before any reward: (a) `referral_email_in_use(user, normalized)`
  — ANY OTHER live account (`auth.users`, not deleted) with the same
  normalized address, the referrer's included; (b) the fingerprint already
  kept by an EARLIER referral. Either → `blocked` / `email_reused`, both sides
  `none`; the account itself is created and works normally, and the friend
  is never told why (anti-enumeration — the referrer reads "not eligible").
- **No key → fail closed:** no reward is granted, the row waits in
  `first_card` and an error is logged; the hourly sweep grants once the key
  is set. Never an unkeyed hash. A key shorter than 32 characters counts as
  missing.

**Owner step:** set `REFERRAL_EMAIL_HASH_KEY` (a long random string, e.g.
`openssl rand -hex 32`) in Vercel **Production** and **Preview /
Development**, and in `.env.local`. Never rotate it casually — fingerprints
kept under the old key stop matching, so an inbox could earn a month again.

**What a side gets** (`referralRewardFor`, `lib/referrals/reward.ts`: the
settings' spec made concrete; `grantSide` in `lib/referrals/server.ts`
writes it):

| The setting says | What happens |
|---|---|
| `free_days` (the default: 30 days of Plus for the friend, 30 days of their own tier for the referrer) | `grantFreeDays` (`lib/billing/free-days-apply.ts`, source `referral_friend` / `referral_referrer`, reference `referral:<id>:<side>`): on a live, renewing plan or trial the days are ADDED to the paid time (Stripe `trial_end` moved, nothing charged); otherwise the perks overlay from the later of now and its end; a grant below the plan paid for is recorded and changes nothing. The grant's own credits — one allotment per 30 days (`lib/billing/free-days-credits.ts`), never a calendar month's |
| `credits` | ONE `grant_credits` call, reason `referral_credits`, key `referral:<id>:<side>` |
| `none` | the side records `none` (`settings`) |
| the user is an admin | `none` (`admin`) |

No money moves, ever: the balance credit the first design posted on a
paying referrer is gone. The reference is UNIQUE on `plan_grants` (0177):
a reward retried after a lost record write finds its grant
(`duplicate_reference`) and records it instead of adding the days twice.
A refusal the writer makes for good (an admin) is recorded as `none`; one
that can clear ("try again", a renewal in flight) is left owed for the
sweep. The referral never touches `comp_tier` / `comp_expires_at` itself —
the writer owns the overlay (the old separate `referral_plus_until` column
and its readers are gone).

**Retries.** A grant that fails leaves the side NULL and counts an attempt
(`grant_attempts`); a free-days grant refused for a plan under a SCHEDULED
change (a pending downgrade) is DEFERRED — owed, no attempt counted — until
the change lands. A free-days row that failed before anything was granted
frees its `reference`, so the retry can grant under the same key (a stale
pending row keeps it: Stripe may have been written — an admin's to look at
after the attempts run out). `/api/cron/referral-rewards` (hourly,
`vercel.json`, `cronRouteGuard`) runs `sweepReferralRewards`: `signed_up`
rows past the 30-day activation window are expired; `signed_up` rows older
than ten minutes whose friend already has a card (a first-card `after()`
the response outran) are qualified; `first_card` rows not claimed yet (an
email confirmed since, the program on again) and claimed rows with a side
still NULL are retried. Every write is once per referral and side, so the sweep
can run any number of times. After `REFERRAL_GRANT_MAX_ATTEMPTS` (5) a side
is recorded as `none` with `grant_failed` for an admin (the admin panel's
`grantsOwed` / reasons).

**Who sees what.** A user reads their own rows as referrer or referee
through a COLUMN grant (status and dates — never `block_reason` or the
reward details): a blocked referral reads "Not eligible". Admins read
everything (RLS `viewer_is_admin()`), and `admin_referral_stats(since)` is
the admin panel's one read. Writes: the service role only.

**Notification kinds.** `referral_signup` and `referral_reward` — 0177's
`notifications_type_check` is 0174's list plus those two (the "REFERRAL
KINDS" block). A migration merged after it that redefines the check takes
the union. Both are notifications only (no email); the weekly digest lists
them like every other kind.

**Where it shows.** `/dashboard/referrals` ("Refer a friend" in the
dashboard rail; a line under the plan card on `/dashboard/billing`): the
link with Copy / the platform's Share sheet / an email draft (naming what
the FRIEND gets, in the settings' words), how it works, the caps, four
numbers (`buildReferralSummary`: joined, first card, rewards earned of the
lifetime cap, this UTC month of the monthly cap) and the friends with their
status (`getMyReferralDashboard`, the viewer's own session and column
grant; the settings ride along). Paused: one sentence, no link. The admin
**Referrals** panel sits under Funnel on `/admin/users` (`getReferralStats`
→ `admin_referral_stats` for 30 days and all time): signups → first card →
rewarded, capped, blocked (by reason), expired, rewards granted on both
sides, the rows waiting and the grants still owed, the top referrers linked
to their admin page — and the settings form.

**Not built (owner decisions, PR body):** a click window longer than the tab
(sessionStorage dies with it — a localStorage entry would be a new storage
decision), IP / velocity review queues, a hold after qualifying (dropped
2026-11-02).
