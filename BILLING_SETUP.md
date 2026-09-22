# Billing & Subscriptions — Setup & Operations

Premium subscriptions + AI credits for PipGlyph, built on **Stripe hosted
Checkout + Customer Portal + a thin webhook → Supabase + app-managed credits**.

> **IP posture (important):** the paid value is *our technology* — AI generation
> credits, watermark-free hi-res exports, whole-deck/set printing, saved-card
> capacity. The MTG-style card maker (every frame, every card type, every
> finish) stays free, and no WotC trade dress is ever paywalled. Keep this in all store/marketing
> copy. Get an IP attorney to review before a public launch.

## Model at a glance

| Tier | Price | AI credits/mo | Watermark | Export | Capacity |
|------|-------|---------------|-----------|--------|----------|
| Free | $0 | 5 (monthly, like the paid tiers; the signup default covers the first month) | yes | low-res PNG only, capped 750px | 50 |
| Plus | $6/mo · $60/yr | 30 | removed | + clean HD PNG, single PDF | 500 |
| Pro | $15/mo · $150/yr | 100 | removed | + 3×3 sheets, whole-deck/set export + ZIP | unlimited |

- Prices and perks are defined ONCE in `lib/billing/plans.ts` (`PLANS`,
  `MONTHLY_CREDITS`, `CREDIT_PACKS`) and enforced in
  `lib/billing/entitlements.ts`. This table is a summary — the code wins.
- **Every AI tool is open to every tier; credits are the limiter** (owner
  decision, 2026-07-28). Premium finishes are free too. The ONLY tier-gated
  AI features are the deck-aware ones — "design a card for this deck" and
  deck-themed ideas — which need Pro (owner decision, 2026-09-15).
- **First subscription ever → 7-day free trial, no card required**
  (`TRIAL_DAYS`); a trial with no payment method cancels itself at day 7.
  A trial gets exactly ONE credit grant (at creation) — no refills until it
  converts to paid.
- **Credits** meter AI generation (1 credit = 1 card/art generation; deck
  generation costs 1/card). Cheap text-assistant actions stay on the
  windowed rate limit (free).
- **Credit packs** (one-time, never expire): 30/$8 and 100/$24 — `CREDIT_PACKS`.
- **Unit economics:** amounts are sized against a measured **~$0.11 per generation**
  so even a max-usage subscriber stays under ~40% AI COGS of net revenue (after
  Stripe fees). Re-tune `MONTHLY_CREDITS` / `CREDIT_PACKS` / prices in
  `lib/billing/plans.ts` if your provider cost changes.

## 1. Database

The billing schema lives in `supabase/migrations/`: `0027_billing_subscriptions.sql`
(profiles billing columns, `credit_ledger`, `stripe_events`, the
`consume_credits` / `grant_credits` / `credit_ledger_daily` RPCs),
`0028`/`0052`/`0060` (the `protect_billing_columns` trigger that pins every
billing column to the service role — user-client writes are silently
reverted), `0060` (admin comp tier / card-cap override), `0068` (per-attempt
spend refs for reconciliation).

Migrations ship through PRs and apply automatically (Supabase branching —
see `docs/ENVIRONMENTS.md` and `CLAUDE.md`). Never apply them by hand to
production. `types/supabase.ts` is hand-extended after each billing
migration. If you regenerate it with `supabase gen types typescript --linked`,
re-apply the hand-written aliases at the top of the file first (several
modules import them) — a blind overwrite breaks the typecheck.

## 2. Stripe Dashboard

1. **Products & Prices** — for each paid tier (Plus, Pro) create a **monthly**
   AND an **annual** recurring price (annual = 2 months free, i.e. monthly × 10),
   plus two one-time products for the credit packs (Small, Large). Copy every
   Price ID (`price_…`).
2. **Customer Portal** — enable it at Settings → Billing → Customer Portal
   (lets users change plan, update card, cancel, view invoices for free).
3. **Webhook endpoint** — add `https://YOUR_DOMAIN/api/stripe/webhook` and
   subscribe to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` (delayed payment methods —
   without it a bank-debit credit pack is paid for and never delivered),
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Keep the
   endpoint's **API version** aligned with the SDK (`2026-05-27.dahlia`).
   Copy the signing secret (`whsec_…`).
   (Credit refills are cron-driven, not webhook-driven — see §6.)
5. **Price → tier mapping.** The webhook maps a subscription's price to a
   tier in this order: the `STRIPE_PRICE_*` env ids → the price's
   `metadata.tier` (`plus`/`pro`) → its lookup key / nickname → the
   product's `metadata.tier` or name → the recurring amount vs
   `lib/billing/plans.ts`. **Put `tier=plus` / `tier=pro` in each product's
   metadata** so a price recreated in the Dashboard (prices are immutable —
   every amount change is a new price) or picked through the Customer
   Portal still resolves. If nothing matches, an ACTIVE subscription is
   never demoted to free (the previous paid tier, or Plus, is kept and the
   miss is logged) — run the billing health check on `/admin/users` to find
   such rows and fix the mapping.
6. **Customer Portal plan switching.** The portal's product catalog must list
   the same Plus/Pro prices the env vars name. Plan changes from the app go
   through the portal's `subscription_update_confirm` flow for active
   subscriptions (in place, prorated) and a superseding checkout for no-card
   trials (the trial is cancelled once the new plan is paid) — the app never
   creates a second subscription for a customer.
4. Use a **restricted** secret key in production.

## 3. Environment variables

Add to `.env.local` (and Vercel project env). See `.env.example`.

```
NEXT_PUBLIC_BILLING_ENABLED=true                # master switch — off hides the whole paid layer
NEXT_PUBLIC_SITE_URL=https://your-domain        # checkout/portal redirects
STRIPE_SECRET_KEY=sk_or_rk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PLUS_MONTHLY=price_...
STRIPE_PRICE_PLUS_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_PACK_SMALL=price_...
STRIPE_PRICE_PACK_LARGE=price_...
SUPABASE_SECRET_KEY=...                          # used by the webhook + cron
CRON_SECRET=...                                  # protects the refill cron route
```

Without `STRIPE_SECRET_KEY` the billing UI shows "not available" and the rest of
the app works normally.

## 4. Local testing (Stripe CLI)

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints whsec_…
# in another shell:
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger invoice.payment_failed
```

Verify: a test profile's `subscription_tier`/`status`/`current_period_end`
update; `customer.subscription.created` grants the first month's credits
(`refill:{user}:{YYYY-MM}` in `credit_ledger.idempotency_key`); running a
trigger twice is a no-op (event ids are claimed in `stripe_events`, grants
dedupe on the ledger key). `invoice.paid` is not handled — refills are
cron-driven (§6).

## 5. Where things live

- Entitlements (server source of truth): `lib/billing/entitlements.ts`
  (`getEntitlements`, `requireTier`). Reads the cached profile; never trust the client.
- Plan catalog (client-safe): `lib/billing/plans.ts`.
- Stripe: `lib/stripe/{client,config,actions,webhook-handlers}.ts`,
  route `app/api/stripe/webhook/route.ts`, admin client `lib/supabase/admin.ts`.
- Subscription ↔ profile sync: `lib/stripe/subscription-sync.ts` — shared by
  the webhook, the admin "Resync from Stripe" button, and the admin billing
  health check (`lib/admin/user-actions.ts`).
- Credits: `lib/ai/rate-limit.ts` (`spendCredits` → the `consume_credits` RPC;
  `lib/billing/credit-refill.ts` for the monthly grants); every
  AI generation runs as a background job (`lib/ai/generation-jobs.ts`,
  `app/api/ai/jobs/*`) that reserves a credit per step and refunds on
  failure; `lib/billing/credit-reconcile.ts` sweeps orphaned charges daily.
- Watermark/hi-res gating: `lib/render/card-image.tsx` + the `app/api/cards/[id]/{png,pdf,og}` routes;
  whole-deck export: `app/api/decks/[id]/download` (assembled in the browser by `lib/decks/export-client.ts`).
  **Display is always watermarked; only paid downloads are clean** (owner
  decision 2026-09-15, layout v20). The stored bake, gallery tiles, the OG
  share image and every live preview carry the pipglyph.com mark whatever
  the owner's plan. `downloadBrandMark` (`lib/billing/entitlements.ts`)
  decides a download from the VIEWER's plan only: free-tier viewers always
  get the mark and a 750 px PNG, paid viewers a clean 1500 px PNG / PDF; the
  owner's custom footer text prints on paid downloads only
  (`ownerExportStamp`). Free viewers see the other formats greyed out and
  get no deck export options.
- Deck-aware AI (Pro, owner decision 2026-09-15 — the only tier-gated AI
  features; generation itself stays open to every tier): `deck_id` on the
  `kind: "card"` job (`requireTier("pro")` in `app/api/ai/jobs/route.ts` and
  `createCardGenerationJob`) and on `POST /api/ai/card-ideas` (deck-themed
  ideas). The brief the designer gets is `lib/ai/deck-brief.ts`.
- Card ideas (`/api/ai/card-ideas`, `lib/ai/card-ideas.ts`): 1 credit per
  batch of text-only concepts, open to every tier; only the deck theming is
  Pro.
- Capacity gate: `lib/cards/actions.ts` (`cardCapacity`); admin comp tier /
  card-cap override / credit grants: `/admin/users` (`lib/admin/user-actions.ts`).
- Selling UI: `app/(marketing)/pricing/page.tsx`, `components/billing/*`,
  settings billing panel, header/user-menu CTAs, upgrade modal (`UpgradeModalProvider`).

## 6. Credit refills (cron)

Monthly credit allotments are granted by a **daily cron** (`vercel.json` →
`/api/cron/refill-credits`), not by `invoice.paid` — so **monthly and annual
plans behave identically**, and **Free accounts refill too** (5/mo, owner
decision 2026-09-15; the sweep walks every profile, treats lapsed/canceled
paid subscriptions as Free, skips admins and trials, and skips Free
accounts created in the current month because `profiles.credits` defaults to
the allotment at signup). Grants are idempotent per user per calendar month
(`refill:{user}:{YYYY-MM}` stored in `credit_ledger.idempotency_key`), so daily
runs are self-healing and never double-grant. New subscribers also get their
first month immediately on `customer.subscription.created`/`.updated` (same key →
no double-grant). Two refinements live in `lib/billing/credit-refill.ts`: a
**trial** gets exactly one grant (at creation — no refills until it converts),
and a **mid-month upgrade** tops up the tier difference under
`refill:{user}:{YYYY-MM}:upgrade:{tier}` so Plus → Pro gets its extra credits
immediately.

- Set **`CRON_SECRET`** in Vercel — it's sent as `Authorization: Bearer …`; the
  route rejects anything else.
- Runs daily (`0 6 * * *`); only the first successful run each month grants.
  A second daily cron (`/api/cron/reconcile-credits`, `30 6 * * *`) refunds
  AI credit charges orphaned by platform kills: every `spend:` ledger row
  older than 15 minutes that was never settled (`credit_ledger.settled_at`,
  stamped by `patch_job_step` / `settleSpend()`; migration 0106). Its JSON
  reports `scanned` / `settled` / `refunded` / `failed` — `settled: 0` next
  to many refunds means settlement broke, not that users crashed. Trigger
  manually:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/refill-credits`

## 7. Known follow-ups

- **Concurrency test for `consume_credits`** needs a live/branch Supabase DB
  (RPC + row lock); run it against a Supabase branch in CI.
- Bulk re-sync: the per-user "Resync from Stripe" button and the health check
  on `/admin/users` cover today's scale; a cron/script that resyncs every
  customer would be the next step past ~100 subscribers.
- Subscription credits currently **accumulate** (roll over) on refill. For strict
  no-rollover, track subscription vs purchased credits as two buckets.
