# Billing (Stripe)

How PipGlyph charges money, how to test it without touching production, and
how the integration compares with the standard Stripe SaaS pattern.

## 1. The shape

| Piece | Where | Notes |
|---|---|---|
| Plan catalog (copy, prices, credits, caps) | `lib/billing/plans.ts` | Client-safe. Stripe price ids are NOT here. |
| Stripe price ids | env `STRIPE_PRICE_{PLUS,PRO}_{MONTHLY,ANNUAL}`, `STRIPE_PRICE_PACK_{SMALL,LARGE}` | `lib/stripe/config.ts` maps key → id and resolves a price back to a tier (env id → metadata → lookup key → product → amount). |
| Storefront | `/pricing` (static, anonymous) + `/pricing-member` (dynamic, signed-in; `proxy.ts` rewrite) | Buttons come from `pricingCtaFor()` fed by a `BillingViewer` (`lib/billing/viewer.ts`). Paid accounts are redirected to the billing page. |
| Billing page | `/dashboard/billing` | Plan, renewal/trial/cancel dates, plan changes (the same grid), credits + packs, card on file + invoices (`lib/billing/subscription-details.ts`), portal shortcuts. |
| Checkout / portal | `lib/stripe/actions.ts` (server actions) | New subscription → Stripe Checkout (7-day no-card trial for first-timers). Live subscription → Customer Portal **confirm-update** flow (in-place price switch, prorated). Broken payment → portal. Packs → Checkout in `payment` mode. |
| Webhook | `app/api/stripe/webhook/route.ts` → `lib/stripe/webhook-handlers.ts` → `lib/stripe/subscription-sync.ts` | Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_failed`. Idempotent (`stripe_events` claim table, migration 0099). |
| Entitlements | `lib/billing/entitlements.ts` | The ONE server-side truth: subscription active/trialing + admin comp → effective tier → perks. Never trust a client tier. |
| Credits | `lib/billing/credit-refill.ts` (monthly refill, cron + webhook), `lib/billing/credit-reconcile.ts` (refund orphaned spends), `settle_spend` (0106) | Refill is idempotent per user per month; upgrades top up the difference against everything the month already granted. |

Environment matrix (Vercel):

| Var | Production | Preview | Local (`.env.local`) |
|---|---|---|---|
| `NEXT_PUBLIC_BILLING_ENABLED` | `true` | `true` (set 2026-09-22 — before that previews 404'd `/pricing`) | as needed |
| `STRIPE_SECRET_KEY` | live `sk_live_…` | **sandbox** `sk_test_…` | sandbox key, or unset (billing UI works, every checkout answers "Billing isn't available") |
| `STRIPE_WEBHOOK_SECRET` | live endpoint | sandbox endpoint for the `dev` branch alias (below) | Stripe CLI `stripe listen` secret |
| `STRIPE_PRICE_*` (6) | live ids | sandbox ids (below) | sandbox ids |

## 2. Sandbox (test mode) setup — created 2026-09-22

The sandbox mirrors the live catalog (same names, lookup keys and `tier` /
`pack` metadata, so `tierForPrice()` resolves them the same way):

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
signing secret is what Preview's `STRIPE_WEBHOOK_SECRET` holds.

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
   - The six `STRIPE_PRICE_*` vars currently span **Preview + Production** with the live ids. For each: edit the existing entry so its environment is **Production only**, then add a second entry scoped to **Preview** with the sandbox id from the table.
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

1. **`customer.subscription.trial_will_end`** (3 days before the trial ends) is not subscribed. Standard practice is an email + in-app nudge; the notification and email infrastructure exists (`lib/email/messages.ts`, `notifications`). Add the event to both endpoints and a handler that writes a notification row and sends the email.
2. **`invoice.paid`** is not handled. Access is granted from `customer.subscription.updated` (status → `active`), which is correct, but `invoice.paid` is the canonical "money arrived" signal and the cheapest place to log revenue / send a receipt-style notification.
3. **`checkout.session.expired`**: today's live data shows eight abandoned checkouts and zero completions. The standard recovery is a "finish signing up" email a day later; Stripe fires this event when a session expires (24 h).
4. **Scheduled downgrades**: the portal is configured to apply price changes immediately with `always_invoice`. Many SaaS apps schedule *downgrades* to the period end so the customer keeps what they paid for; Stripe supports it via `subscription_update.schedule_at_period_end.conditions` (`decreasing_item_amount`). Worth switching on.
5. **Smart Retries / dunning emails**: confirm they are on in Dashboard → Settings → Billing → Subscriptions and emails (free; recovers a share of failed renewals).
6. **Stripe Tax** is off (`automatic_tax` false). Fine while volume is tiny; revisit before EU/UK volume.
7. **Test coverage for the hosted pieces**: nothing automated completes a real checkout. The Preview setup above plus a monthly manual run (or a Playwright job with the Stripe test card on the `dev` alias) closes that.

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
