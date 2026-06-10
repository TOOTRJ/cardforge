# Billing & Subscriptions — Setup & Operations

Premium subscriptions + AI credits for Spellwright, built on **Stripe hosted
Checkout + Customer Portal + a thin webhook → Supabase + app-managed credits**.

> **IP posture (important):** the paid value is *our technology* — AI generation
> credits, watermark-free hi-res exports, the AI set generator, original premium
> finishes. The MTG-style card maker (every frame, every card type) stays free,
> and no WotC trade dress is ever paywalled. Keep this in all store/marketing
> copy. Get an IP attorney to review before a public launch.

## Model at a glance

| Tier | Price | AI credits/mo | Watermark | Export | Capacity | Extras |
|------|-------|---------------|-----------|--------|----------|--------|
| Free | $0 | 5 (signup grant) | yes | PNG, capped 750px | 50 | — |
| Plus | $9/mo | 30 | removed | + clean HD PNG, single PDF | 500 | premium finishes |
| Pro | $19/mo | 75 | removed | + 3×3 sheets, whole-set export | unlimited | AI set generator |

- **Credits** meter AI generation (1 credit = 1 card/art generation; the AI set
  generator costs 1/card). Cheap text-assistant actions stay on the windowed
  rate limit (free). Plan credit amounts: `lib/billing/plans.ts` → `MONTHLY_CREDITS`.
- **Credit packs** (one-time, never expire): 30/$8 and 100/$24 — `CREDIT_PACKS`.
- **Unit economics:** amounts are sized against a measured **~$0.11 per generation**
  so even a max-usage subscriber stays under ~40% AI COGS of net revenue (after
  Stripe fees). Re-tune `MONTHLY_CREDITS` / `CREDIT_PACKS` / prices in
  `lib/billing/plans.ts` if your provider cost changes.

## 1. Apply the database migration

`supabase/migrations/0027_billing_subscriptions.sql` adds the billing columns on
`profiles`, the `credit_ledger` + `stripe_events` tables, and the
`consume_credits` / `grant_credits` / `credit_ledger_daily` RPCs.

```bash
supabase db push          # or apply via the Supabase MCP / dashboard
```

> **Heads-up (verified on a real branch):** the CardForge project has **no
> tracked migration history** (its schema was applied out-of-band), so a plain
> `supabase db push` may try to replay 0001–0027 and choke on a non-idempotent
> earlier migration. Safest path: apply **just 0027** via the Supabase SQL editor
> / MCP `apply_migration` (its SQL is idempotent and was validated end-to-end on a
> branch), or `supabase migration repair --status applied <0001..0026>` first so
> only 0027 pushes. 0027 itself applies cleanly either way.

Then regenerate types (the repo's `types/supabase.ts` was hand-extended to match;
regenerate to stay authoritative):

```bash
supabase gen types typescript --linked > types/supabase.ts
```

Run the security advisor afterward and confirm the SECURITY DEFINER functions
don't trip the "mutable search_path" lint (they pin `search_path = public`).

## 2. Stripe Dashboard

1. **Products & Prices** — for each paid tier (Plus, Pro) create a **monthly**
   AND an **annual** recurring price (annual = 2 months free, i.e. monthly × 10),
   plus two one-time products for the credit packs (Small, Large). Copy every
   Price ID (`price_…`).
2. **Customer Portal** — enable it at Settings → Billing → Customer Portal
   (lets users change plan, update card, cancel, view invoices for free).
3. **Webhook endpoint** — add `https://YOUR_DOMAIN/api/stripe/webhook` and
   subscribe to: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Keep the endpoint's **API version** aligned with the
   SDK (`2026-05-27.dahlia`). Copy the signing secret (`whsec_…`).
   (Credit refills are cron-driven, not webhook-driven — see §6.)
4. Use a **restricted** secret key in production.

## 3. Environment variables

Add to `.env.local` (and Vercel project env). See `.env.example`.

```
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
stripe trigger customer.subscription.updated
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
```

Verify: a test profile's `subscription_tier`/`status`/`current_period_end`
update; `invoice.paid` grants monthly credits; running a trigger twice is a
no-op (deduped via `stripe_events` + `credit_ledger.stripe_event_id`).

## 5. Where things live

- Entitlements (server source of truth): `lib/billing/entitlements.ts`
  (`getEntitlements`, `requireTier`). Reads the cached profile; never trust the client.
- Plan catalog (client-safe): `lib/billing/plans.ts`.
- Stripe: `lib/stripe/{client,config,actions,webhook-handlers}.ts`,
  route `app/api/stripe/webhook/route.ts`, admin client `lib/supabase/admin.ts`.
- Credits: `lib/ai/rate-limit.ts` (`consumeAiCredits`, `spendCredits`), consumed in
  `app/api/ai/random-card` and `app/api/ai/generate-deck`.
- Watermark/hi-res gating: `lib/render/card-image.tsx` + the `app/api/cards/[id]/{png,pdf,og}` routes.
- Premium frame/finish + capacity gates: `lib/cards/actions.ts` + `types/card.ts`.
- Selling UI: `app/(marketing)/pricing/page.tsx`, `components/billing/*`,
  settings billing panel, header/user-menu CTAs, upgrade modal (`UpgradeModalProvider`).

## 6. Credit refills (cron)

Monthly credit allotments are granted by a **daily cron** (`vercel.json` →
`/api/cron/refill-credits`), not by `invoice.paid` — so **monthly and annual
plans behave identically**. Grants are idempotent per user per calendar month
(`refill:{user}:{YYYY-MM}` stored in `credit_ledger.idempotency_key`), so daily
runs are self-healing and never double-grant. New subscribers also get their
first month immediately on `customer.subscription.created`/`.updated` (same key →
no double-grant).

- Set **`CRON_SECRET`** in Vercel — it's sent as `Authorization: Bearer …`; the
  route rejects anything else.
- Runs daily (`0 6 * * *`); only the first successful run each month grants.
  Trigger manually:
  `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/refill-credits`

## 7. Known follow-ups

- **Concurrency test for `consume_credits`** needs a live/branch Supabase DB
  (RPC + row lock); run it against a Supabase branch in CI.
- Optional `scripts/reconcile-subscriptions.mjs` to re-sync tiers from Stripe if a
  webhook is ever missed.
- Subscription credits currently **accumulate** (roll over) on refill. For strict
  no-rollover, track subscription vs purchased credits as two buckets.
