# Billing (Stripe)

How PipGlyph charges money, how to test it without touching production, and
how the integration compares with the standard Stripe SaaS pattern.

## 1. The shape

| Piece | Where | Notes |
|---|---|---|
| Plan catalog (copy, prices, credits, caps) | `lib/billing/plans.ts` | Client-safe. Stripe price ids are NOT here. |
| Stripe prices | **lookup keys** on the catalog (`plus_monthly`, `plus_annual`, `pro_monthly`, `pro_annual`, `pack_small`, `pack_large`) — `lib/stripe/prices.ts` resolves them at checkout; the `STRIPE_PRICE_*` env vars are an optional fallback | Since 2026-09-22 (PR #360): a stale env id had every live credit-pack checkout failing with `resource_missing` for weeks. `lib/stripe/config.ts` still maps a price back to a tier (env id → metadata → lookup key → product → amount) for the webhook. |
| Storefront | `/pricing` (static, anonymous) + `/pricing-member` (dynamic, signed-in; `proxy.ts` rewrite) | Buttons come from `pricingCtaFor()` fed by a `BillingViewer` (`lib/billing/viewer.ts`). Paid accounts are redirected to the billing page. |
| Billing page | `/dashboard/billing` | Plan, renewal/trial/cancel dates, plan changes (the same grid), credits + packs, card on file + invoices (`lib/billing/subscription-details.ts`), portal shortcuts. |
| Checkout / portal | `lib/stripe/actions.ts` (server actions) | New subscription → Stripe Checkout (7-day no-card trial for first-timers). Live subscription: an **upgrade** goes through the Customer Portal **confirm-update** flow (in-place price switch, prorated, charged now); a **downgrade** (Pro → Plus, or annual → monthly) is **scheduled for the end of the paid period** with a subscription schedule (§6). Broken payment → portal. Packs → Checkout in `payment` mode. |
| Webhook | `app/api/stripe/webhook/route.ts` → `lib/stripe/webhook-handlers.ts` → `lib/stripe/subscription-sync.ts` | Events: `checkout.session.{completed,async_payment_succeeded,expired}`, `customer.subscription.{created,updated,deleted,trial_will_end}`, `invoice.{paid,payment_failed}`. Idempotent (`stripe_events` claim table, migration 0099). Every endpoint (live + sandbox) must subscribe to all nine. |
| Revenue log | `billing_payments` (migration 0110) ← `invoice.paid`; admin Revenue panel on `/admin/users` (`lib/admin/revenue-queries.ts`) | One row per paid invoice; admins read, the webhook writes. |
| Entitlements | `lib/billing/entitlements.ts` | The ONE server-side truth: subscription active/trialing + admin comp → effective tier → perks. Never trust a client tier. |
| Credits | `lib/billing/credit-refill.ts` (monthly refill, cron + webhook), `lib/billing/credit-reconcile.ts` (refund orphaned spends), `settle_spend` (0106) | Refill is idempotent per user per month; upgrades top up the difference against everything the month already granted. |

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

Sandbox webhook endpoint `we_1UIfs5QFLEpCg9s2TgN3OiCm` → the `dev` branch
alias (`https://cardforge-git-dev-orderoftheredjester.vercel.app/api/stripe/webhook`,
API version `2026-05-27.dahlia`, the same six events as production). Its
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
Stripe-side assumptions the code relies on:

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
5. **Smart Retries / dunning emails**: confirm they are on in Dashboard → Settings → Billing → Subscriptions and emails (free; recovers a share of failed renewals).
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
| Downgrade (Pro → Plus, annual → monthly) | `scheduleDowngrade`: `subscriptionSchedules.create({ from_subscription })`, then `update` with the current phase kept exactly as it is (same price, same end date) and ONE phase on the new price (`duration` = one interval, `proration_behavior: none`), `end_behavior: release` — the subscription carries on renewing on the new price. A pending change is replaced, never stacked; a plan set to `cancel_at_period_end` is un-cancelled first (the click asked for "Plus after this period", not "nothing after this period"). Lands on `/dashboard/billing?billing=scheduled`. | Nothing now; the new price bills from the next period |
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
(owner-authorized); the live portal `bpc_1TruxhQFLEpCg9s22wWCrEgw` is
unchanged.

## 7. Revenue log, payment notifications, checkout recovery (2026-09-23)

**`invoice.paid`** (`handleInvoicePaid`) — Stripe's canonical "money
arrived" signal — does three things:

1. **Revenue row.** `billing_payments` (migration 0110): one row per invoice
   (upsert by invoice id, so retries are harmless) with the user, amount,
   `billing_reason` (`subscription_create` / `subscription_cycle` /
   `subscription_update` / `manual`), tier + interval, the billed period,
   `paid_at`, invoice number and hosted URL. The admin **Revenue** panel on
   `/admin/users` shows last-30-days and all-time totals plus the newest
   payments; it reads only this table, never Stripe. Seeds give `dev_pro`
   three renewals so branches show rows.
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
  subscription ("your 7-day free trial is still waiting, no card needed"),
  otherwise "pick up where you left off"; packs count the credits and price;
- the session's `metadata` (`purchase_kind`, `tier`, `period`, or
  `pack_credits`) says what was being bought — the session object carries no
  line items — so `createCheckoutSessionAction` stamps it on every session.

Both handlers: the notification insert is the durable part (a failure throws
so Stripe retries); the email is best effort with a provider idempotency key
(`checkout-reminder:<session>`). Both events must be subscribed on every
endpoint: sandbox done 2026-09-23; live `we_1TrupnQFLEpCg9s2bSILz13V`
needs `invoice.paid` + `checkout.session.expired` added (owner's OK).

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
`cancel_at_period_end` flows through to the billing page's "ends on" copy,
and a Plus → Pro switch is a $9 prorated charge — the copy on the billing
page says exactly that.
