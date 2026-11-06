# The reverse trial — what it is, what it would look like, what it would cost

Stripe audit 2026-11-05, research item 5 (owner: "YES — explain what it does
and looks like when starting it"). Nothing here is built; this is the
explanation the owner asked for before any build.

## What a reverse trial is

Today a visitor who signs up lands on **Free** (5 credits once, watermarked
downloads, the 50-card cap) and sees Plus / Pro only as a pricing page and a
7-day **card-required** trial. A reverse trial turns that around for NEW
accounts: every verified sign-up starts on **Plus for 7 days, no card asked**,
then drops to Free on day 8 unless they subscribe. The card-required trial
stays exactly as it is for anyone who later clicks "Try Pro free" — the
reverse trial is app-side (a `plan_grants` row, migration 0176, the same
mechanism as a comp or a referral reward), never a Stripe subscription.

Why it is the cheapest experiment with the best evidence for a freemium
product (the research summary in the audit report): no-card trials convert
poorly to paid (4–15 %) but reach 2–3× the signups; card-required trials
convert well (25–60 %) from far fewer people; a reverse trial gets the wide
funnel AND keeps the paid-intent door — the visitor meets the paid features
before being asked for a card. Measured as **visitor → paid at 30 days**, it
is the number that moves or doesn't.

## What it would look like

- **Sign-up → onboarding**: "Your first 7 days are on Plus" — one line on
  the welcome screen and the welcome email, the plan badge reads "Plus ·
  free 7 days", the billing page shows the end with its time (the free-days
  copy, `<LocalDate format="stampYear">`), the credit meter shows Plus's 30
  (the grant's own allotment).
- **Day 5 and day 7**: the existing `comp_ending` notification + email
  ("Your free days end on …") — already built for comps (0161), reworded for
  a reverse trial; the day-7 one carries the "Keep Plus" button → the normal
  Checkout (card required, the 7-day Stripe trial still offered if the
  account has never subscribed — or not: see the decision below).
- **Day 8**: Free. Cards over the Free cap stay saved and private-editable
  as today's capacity rule works; clean downloads stop; the dashboard says
  "Your Plus days ended — keep Plus for $6 a month".
- **Admin**: `/admin/users` shows the grant like any comp (source
  `reverse_trial`); the Funnel panel gains "Reverse trial → paid at 30 d".

## What it would take (a draft PR, no migration if `plan_grants.source`
gains one value by CHECK — one small migration otherwise)

1. `grantFreeDays` call at onboarding completion (the step with a confirmed
   email — the referral row's place, `lib/onboarding/actions.ts`), units =
   7 days, tier Plus, source `reverse_trial`, reference `reverse-trial:<user>`
   (unique: once per account, ever). The unit is 30 days today
   (`FREE_DAYS_UNIT_SECONDS`); a 7-day grant needs a `seconds` override or a
   second constant — a decision in the PR.
2. The experiment switch in `site_settings` (like `referrals`): `enabled`,
   `days`, and a `cohort` percentage (50 % of new accounts, by a hash of the
   user id) so the control group exists — without it the number can't be read.
3. Copy: onboarding line, welcome email line, badge, billing page, the two
   reminders, the day-8 notice; "free days", never "free month".
4. Funnel: a `reverse_trial_started` row at the grant; the panel's rate is
   `subscription_started` within 30 days of signup, cohort vs control.
5. Fraud: the per-email fingerprint from referrals (`referral_email_fingerprints`)
   would be reused so a deleted-and-recreated account doesn't get 7 more
   days; disposable domains refused as the referral rules do.

## The decisions the owner would make at build time

- **Does the Stripe 7-day card trial still follow the reverse trial?** Two
  free weeks in a row (7 app-side, 7 Stripe-side) is generous; most products
  that run a reverse trial drop the card trial for that cohort. Recommendation:
  keep the card trial for the control group, drop it for the reverse-trial
  cohort (the Checkout already knows the profile).
- **Plus or Pro for the 7 days?** Plus (the step most Free users would buy;
  Pro's deck AI is paused anyway, D6).
- **Credits during the 7 days**: Plus's 30, once (the grant's own
  allotment), or nothing extra beyond the 5 signup credits. Recommendation:
  the 30 — the point is to meet the paid product.
- **How long the experiment runs**: until 200 accounts per arm or 60 days,
  whichever first; then read visitor → paid at 30 days for both arms.

Cost: about a day of build + the independent check; no Stripe change; no
money moves (a reverse trial is an overlay, the same code path as a comp).
