# AI credits: from monthly refills to one-time grants (owner decision 2026-11-06)

Status: PROPOSAL for the owner's answers — nothing built yet. The audit of
how credits work today is section 1; the proposed design is section 2; the
questions that need the owner's answers are section 3; the copy sweep is
section 4; the draft update post is section 5.

## 0. The owner's intent (verbatim, 2026-11-06)

> Remove the recurring month credits for plus and pro plans. The free plan
> gets 5 on sign up, the plus plan gets 60 after the first payment, and the
> pro plan gets 120 after the first payment. For users that sign up for the
> free trial or apply banked days there is a one time additional 10 credits
> added to their account. These are one time credits not reoccurring
> credits. All credits users already have due to pro or plus plans should
> stay on the users account. The change would only apply to plans moving
> forward. Update everywhere on the site that references AI credits. Prepare
> an update post.

## 1. How credits work today (the audit, condensed)

Constants (`lib/billing/plans.ts`): `SIGNUP_CREDITS` 5 (the `profiles.credits`
default, written by a trigger as the `signup_grant` ledger row),
`MONTHLY_CREDITS` {free 0, plus 30, pro 100}, `TRIAL_CREDITS` 25, packs
10/$4 · 30/$8 · 100/$24 with the 20 % subscriber coupon.

| Stream | When | Key (unique in `credit_ledger`) | Reason |
|---|---|---|---|
| Signup | profile insert | none (trigger, once) | `signup_grant` |
| Monthly refill | the daily 06:00 UTC cron (`refillActiveSubscribers`) AND the Stripe side (`grantCreditsForSync` on `subscription.created/updated` and `invoice.paid`) — three doors onto ONE per-month key | `refill:<user>:<YYYY-MM>`; a mid-month upgrade or a trial converting tops the month up under `refill:<user>:<YYYY-MM>:upgrade:<tier>` | `subscription_refill` |
| Trial tranche | the trialing subscription's creation, once per account | the month's base key | `trial_grant` |
| Annual plans | the cron grants every calendar month (+ one month of backfill) | per month | `subscription_refill` |
| Free-days / staff allotments | per 30-day unit of a `plan_grants` row with `grants_credits` | `grant:<id>:<k>` | `plan_grant` |
| Packs | `checkout.session.completed`, paid | `pack:<session>` | `pack_purchase` |
| Admin | the form | `admin-grant:<request>` | `admin_grant` |
| Referral ladder (PR #770) | steps 2/4/6/8 | `referral-step:<referrer>:<n>` | `referral_credits` |

Spending is untouched by this change: `consume_credits` (1 per AI action,
2 for a two-faced remix card), the per-step reserve/settle, the 30-minute
reconcile refund, the `art_blocked` refund.

What the change breaks if the numbers are simply edited:

- "First payment" has no single event. The paid signal reaches the ledger
  through three doors that converge on a per-MONTH key; a one-time grant
  needs its own key or two doors grant twice (two different months).
- The trial tranche sits under the month's base key on purpose so a trial
  converting is topped up to the tier's month (25 → 100). With fixed
  one-time amounts that shortfall logic must go.
- Annual plans get twelve allotments today. "Once" means 60 / 120 for a
  year unless the design says otherwise.
- A mid-cycle upgrade is "+70 this month"; once-per-plan needs a rule for
  Plus → Pro, Pro → Plus → Pro, and cancel → resubscribe (the once-per-
  account trial rule already chose "never twice").
- Setting `MONTHLY_CREDITS` to 0 silently zeroes the staff allotments and
  collapses the low-credit warning threshold (`isLowCredits` is 20 % of the
  month).
- Copy promising a refill is on: the plan features, the pricing intro and
  metadata, the upgrade modal (three sentences), the billing page (Stats
  "AI credits a month" / "Monthly refill" and the Upgrade line), the
  dashboard credits card ("x of 30 monthly credits used"), Settings' usage
  and billing panels ("30/mo on Plus"), the credit meter's title ("they
  refill monthly"), the lapsed-plan copy, the trial-ending email ("your
  credits refill every month"), the checkout-reminder and win-back emails
  ("monthly AI credits"), the `payment_received` notification ("your
  monthly AI credits are refilled"), the help centre and the FAQ (four
  answers), two guides, the home page, the AI-generator landing, the About
  page, `docs/BILLING.md` and CLAUDE.md.

## 2. Proposed design

### 2.1 The grants

| Account event | Credits | Once per… | Key |
|---|---|---|---|
| Signup | 5 | account (as today) | the signup trigger |
| A FREE PERIOD starts: the first checkout applies the bank (the subscription is created `trialing`) | +10 | account, ever | `free-period:<user>` |
| Banked days APPLIED to a live plan later ("Apply banked days") | +10 — only if the account never had the free-period bonus | account, ever (the same key) | `free-period:<user>` |
| FIRST PAID invoice on Plus (`invoice.paid`, `amount_paid > 0`, `billing_reason` subscription_create / subscription_cycle / subscription_update) | 60 | account + tier | `plan-once:<user>:plus` |
| FIRST PAID invoice on Pro | 120 | account + tier | `plan-once:<user>:pro` |
| Upgrade Plus → Pro (a paid invoice on Pro after Plus's grant) | 60 more (120 − 60: the Pro key grants the DIFFERENCE over what the account's lower-tier key already granted) | account + tier | `plan-once:<user>:pro` |
| Downgrade Pro → Plus | nothing (the account already holds more than Plus's 60) | — | — |
| Cancel, then resubscribe | nothing (the keys are per account) | — | — |
| Annual plan | the same one-time amount as monthly (open question 3) | account + tier | the same key |
| Packs, admin grants, referral ladder credits | unchanged | — | — |
| Staff "no end" access | nothing automatic (open question 4) | — | — |

Why `invoice.paid` with `amount_paid > 0` and not `subscription.created`:
a trial-start invoice is $0 and a 100 %-coupon invoice is $0 — "after the
first payment" means money moved. The handler already knows "money taken"
(it drives the `payment_received` notification). `subscription.updated`
(trial → active) stays as a belt-and-braces door onto the SAME key: whichever
arrives first grants, the other no-ops, as the pack grant does today.

What stops: the daily refill cron's `refillActiveSubscribers` (removed, with
the backstop / missed-month / annual-backfill logic and `heldBeforeStart`);
the Stripe side's monthly grant; the trial tranche (25) — replaced by the
10; the free-days allotments for `plan_grants` with units (staff access —
question 4). `MONTHLY_CREDITS` is retired; a new `PLAN_CREDITS_ONCE`
{plus 60, pro 120} and `FREE_PERIOD_CREDITS` 10 take its place.

### 2.2 Existing users (the change applies going forward)

- Every balance stays. Nothing is clawed back, nothing is reset.
- Current Plus / Pro subscribers: their refills simply stop. Recommendation
  (question 5): grant them the one-time amount ONCE at rollout
  (`plan-once:<user>:<tier>` from a one-off service-role script), so a
  paying customer is never worse off than a brand-new one on the day the
  rules change. Their next invoice then grants nothing more (the key exists).
- Accounts mid-trial at rollout already hold the 25 trial credits; their
  first payment grants the full 60 / 120 (no top-up arithmetic, no
  deduction of the 25). They do NOT get the 10 (the trial tranche was
  theirs; the `trial_grant` ledger row marks the free-period bonus as had).
- Past trialists who never paid: nothing changes until they pay.

### 2.3 What else moves

- `isLowCredits`: fixed thresholds (≤ 3 on a paid plan, ≤ 1 on free), no
  longer a share of the month.
- The dashboard / settings "Monthly allotment" and "Monthly refill" stats
  become "Plan credits" (the one-time amount, with its date) and go away on
  free; the header chip's "· N used this month" stays (it is usage).
- `payment_received` says "renewed — $X charged." with no credit line after
  the first; the first paid invoice's notification says "…and your N plan
  credits are on your account."
- Ledger labels: `plan_credits_once` → "Plan credits (one-time)",
  `free_period_bonus` → "Free-period credits".
- Admin: the Users page's "Credits spent this month" stays; a per-reason
  grant count joins the Revenue panel ("Plan credits granted · Free-period
  credits · Packs · Referral credits · Admin") so the owner sees the new
  streams.
- Tests: `credit-refill.test.ts`, `subscription-sync.test.ts`,
  `webhook-handlers.test.ts`, `free-days-credits.test.ts`, `plans.test.ts`,
  `upgrade-modal.test.tsx`, `resync-ending.test.ts`, the email and help
  tests — rewritten to the new rules.
- No Stripe change: no coupon, product or price carries AI credits. The
  owner's "report every production Stripe change" rule is not triggered.

### 2.4 Rollout

One PR (no migration is strictly needed: the ledger's unique keys carry
the idempotency; a migration only if the owner wants a `credit_grants_once`
audit table or a CHECK on reasons), stacked after #771 so the trial copy is
already the bank's. Order inside the PR: the grant code and the cron change
first, then the copy sweep, then the one-off script for existing
subscribers (run once, by the owner, logged in `docs/stripe-live-changes.md`
although it touches no Stripe object), then the update post.

## 3. Questions for the owner

1. **Upgrade credits.** Plus → Pro after Plus's 60: grant the DIFFERENCE
   (60 more, total 120) as proposed, or Pro's full 120 (total 180)?
2. **The 10 for banked days.** Once per account EVER (proposed: the first
   free period or the first Apply, whichever comes first), or once per
   application (every "Apply banked days" click adds 10 — farmable through
   referrals, each ladder step's days would mint 10 more)?
3. **Annual plans.** The same one-time 60 / 120 as monthly (proposed), or a
   larger one-time amount for paying a year up front (e.g. 2×)?
4. **Staff "no end" access and the old overlay comps still running.** Today
   they get the tier's credits every 30 days. Proposed: staff gets nothing
   automatic (admins have unlimited credits; a non-admin staff member gets
   an admin grant when needed), and the old overlays keep their remaining
   allotments until they run out. OK?
5. **Existing paying subscribers at rollout.** Grant each the one-time 60 /
   120 once (proposed), or let them keep only what they have?
6. **Accounts mid-trial at rollout** already hold 25 trial credits. First
   payment grants the full 60 / 120 on top (proposed), or 60 / 120 minus 25?
7. **Credit packs.** With no refills, packs become the only recurring way to
   buy credits. Keep 10/$4 · 30/$8 · 100/$24 and the 20 % subscriber
   discount as they are (proposed), or revisit prices now?
8. **The referral ladder's credit steps** (5 / 10 / 20 / 50): unchanged
   (proposed)?
9. **The "first payment" door.** A paid invoice (`amount_paid > 0`) as
   proposed — so a 100 %-off coupon never grants plan credits — or any
   first invoice including $0 ones?
10. **The update post.** Publish on the day the PR ships (proposed), with
    the referral and days-bank changes in the same post, or a post of its
    own?

## 4. The copy sweep (every surface that says "monthly" or "refill")

| Surface | Today | Proposed |
|---|---|---|
| `lib/billing/plans.ts` Free feature | "5 AI credits at sign-up (no monthly refill — packs and plans add more)" | "5 AI credits to start — packs add more, never expire" |
| Plus feature | "30 AI credits every month" | "60 AI credits with your first payment" |
| Pro feature | "100 AI credits every month" | "120 AI credits with your first payment" |
| Pricing intro + metadata | "Plans add monthly credits…" / "Upgrade for monthly credits…" | "Plans come with a one-time stock of AI credits — 60 on Plus, 120 on Pro — plus watermark-free hi-res downloads…"; the free-days line: "…with 10 AI credits to try. Nothing is charged until the days end…" |
| Upgrade modal (free) | "…or a plan refills every month." | "…a plan comes with 60 or 120 credits on its first payment, and packs never expire." |
| Upgrade modal (generic) | "More AI credits every month and clean hi-res exports." | "A stock of AI credits, clean hi-res exports and more room for your cards." |
| Upgrade modal (subscriber) | "Your plan refills every month — top up any time with a pack…" | "Top up any time with a pack, 20 % off for subscribers." |
| Billing page Stats | "AI credits a month 30" / "Monthly refill 30" | "Plan credits 60 · one-time" / "Purchased credits never expire" |
| Billing Upgrade line | "…with 25 AI credits to try…" | "…with 10 AI credits to try…" |
| Dashboard credits card | "x of 30 monthly credits used" / "Monthly allotment" | "x used this month" / "Plan credits: 60, granted <date>" |
| Settings usage / billing panels | "Monthly allotment" / "30/mo on Plus" | "Plan credits" / "60 one-time on Plus" |
| Credit meter title | "AI credits remaining — they refill monthly" | "AI credits remaining" |
| Lapsed / free plan status copy | "…a plan refills every month" | "…a plan brings 60 or 120 credits with its first payment" |
| Trial-ending email | "your credits refill every month" | "your plan credits land with the first payment" |
| Checkout-reminder / win-back emails | "more monthly AI credits" | "60 (or 120) AI credits with your first payment" |
| `payment_received` notification | "…your monthly AI credits are refilled." | first paid invoice: "…and your 60 plan credits are on your account."; later: "renewed — $X charged." |
| Help centre (`lib/content/help.ts`) and FAQ (`lib/content/faq.ts`, 4 answers) | "Plus adds 30 a month and Pro 100" | "Plus comes with 60 AI credits and Pro with 120, once, with the first payment; packs top you up any time and never expire" |
| Guides (`card-conjurer-alternative.mdx`, `how-to-write-mtg-oracle-text.mdx`), home, AI-generator landing, About, `llms.txt` | "add AI credits every month" | "come with a stock of AI credits" |
| Admin hints (resync "grants any monthly credits", staff "refill every 30 days") | | updated to the new rules |
| `docs/BILLING.md`, CLAUDE.md | §8/§9 + the comps table | a "Credits are one-time" section; the old rules struck |

## 5. Draft update post (to publish when the change ships)

**Title:** AI credits are changing — and your balance stays

Here's what's changing with AI credits on PipGlyph, and what isn't.

**Plan credits are now a one-time stock, not a monthly refill.** When you
start a Plus plan, 60 AI credits land on your account with your first
payment; Pro brings 120. They're yours to spend whenever you like — there's
no monthly clock and nothing expires. Plans still bring the rest:
watermark-free hi-res downloads, print-ready PDFs, room for up to 500 cards
on Plus and unlimited on Pro, and Pro's deck tools.

**Free days come with 10 credits to try.** Every new account banks 7 free
days; your first checkout applies them as your plan's free time, and 10 AI
credits come with them. Days you earn later — by referring friends — are
yours to apply whenever you like.

**Nothing you already have changes.** Every credit on your account today
stays there, whatever plan it came from. If you're on Plus or Pro right
now, you'll also receive the new one-time stock once, so you're never worse
off than someone joining today. [keep or drop with question 5]

**Need more?** Credit packs work on every plan — 10, 30 or 100 credits — and
Plus and Pro members pay 20 % less. Purchased credits never expire. Referring
a friend earns free days and, every other step up the ladder, credits too.

Why the change: most of you told us — by how you use it — that you pay for
room to save cards and for clean exports, not for a monthly allowance of
AI. So we've made the plans about those things, and made credits simple:
a stock you own, topped up when you want.

Questions? Reply to this post or write to us from the Feedback page.

— The PipGlyph team
