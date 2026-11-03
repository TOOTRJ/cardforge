# Free → paid conversion: research notes (2026-10)

Desk research for PipGlyph's monetisation work, written before building the
double-sided referral program. It covers trials, comps, referrals, pricing
pages, paywall timing and win-back. It ends with a ranked list of
recommendations and concrete numbers for the referral design.

**How to read the evidence.** Most "SaaS conversion benchmark" numbers on the
web come from vendors who sell trial, referral or billing tooling. They are
often copied between blogs until nobody can trace the original. Each claim
below is tagged:

- **[primary]**: the company's own material, a peer-reviewed paper, or
  official docs.
- **[benchmark]**: an aggregated dataset from a named firm (ChartMogul,
  First Page Sage, ProfitWell/Paddle). These are useful but self-selected.
- **[vendor/secondary]**: a blog repeating a number, or a vendor talking
  about its own category. Treat these as directional only.

Network note: the research session could search the web, but it could not
fetch several primary hosts directly (docs.stripe.com, chartmogul.com,
paddle.com, growthunhinged.com, revenuecat.com). Where a claim rests on one of
those pages, it was read through search-result excerpts of that page, not the
full page. Before anyone builds on the Stripe behaviour in §3.6, re-check the
linked Stripe docs and test it on a test clock.

PipGlyph facts used below come from `lib/billing/plans.ts` and
`docs/BILLING.md`: Plus is $6/mo ($60/yr), Pro is $15/mo ($150/yr), Plus
includes 30 credits a month and Pro 100, AI costs about $0.11 per generation,
Free starts with 5 credits that never refill and caps saved cards at 50, and
the trial is 7 days with a card required and 25 credits.

---

## 1. Trials

### 1.1 Opt-in (no card) vs opt-out (card required)

- **ChartMogul's Conversion Report** (with Growth Unhinged and ProductLed)
  **[benchmark]** found that about 20% of free-trial products require a card
  up front and 80% do not. When a card is required, it rates 25–35%
  trial-to-paid as "good" and 50–60% as "great". It also warns that a card
  requirement "could blunt signups, hurting the overall number of paying
  customers" unless the product warrants the friction. The most common trial
  length is 14 days (62%), followed by 7 and 30 days (14% each).
  <https://chartmogul.com/reports/saas-conversion-report/>
- **First Page Sage** **[benchmark, agency client data, 50+ clients]**
  reports organic trial-to-paid of about 18.2% for opt-in and about 48.8% for
  opt-out. The original page could not be reached; this figure is via
  <https://userpilot.com/blog/free-trial-conversion-rate/> and
  <https://www.shno.co/marketing-statistics/free-trial-conversion-statistics>.
- **Volume:** opt-in trials attract roughly 3–4× more trial starts **[vendor/secondary]**
  (<https://adapty.io/blog/markdown/trial-conversion-rates-for-in-app-subscriptions.md>).
  Several analysts argue that the net number of payers ends up comparable
  between the two models
  (<https://www.growthspreeofficial.com/blogs/b2b-saas-trial-to-paid-conversion-rate-benchmarks-2026-by-trial-type-acv-length-credit-card>).
  That is a reasoned argument, not a study.

**Takeaway.** A card-required trial (PipGlyph's model since 2026-09-24)
converts 2–3× better *per trial*. Those rates are inflated by people who
forget to cancel, and fewer people start a trial. Card-gated trials also
carry refund and chargeback risk, and they produce "surprise charge" churn in
month 2. No dataset found isolates the *causal* effect of the card
requirement; ChartMogul says so explicitly. For a $6 consumer hobby product,
the funnel-width cost is probably bigger than in B2B. Measure it rather than
assume: PipGlyph already logs `upgrade_modal_open` → checkout started →
trial started.

### 1.2 Trial length

The common lengths are 14, 7 and 30 days (ChartMogul above). No clean dataset
was found showing that one length converts better. Vendor posts agree on one
heuristic: the trial should be long enough to reach the "aha" moment two or
three times, and no longer. For a card creator, the aha moment happens in
minutes (one AI card saved and downloaded clean), so **7 days is defensible**.
A longer trial mainly delays revenue. Evidence: weak.

### 1.3 Reverse trials

A reverse trial gives a new user the paid tier for a fixed period with no
card, then drops them to Free instead of locking them out.

- Kyle Poyar (ex-OpenView) presents it as "the best of both worlds":
  freemium's signup volume with a trial's urgency. Airtable is the canonical
  example. **[primary opinion]**
  <https://www.growthunhinged.com/p/your-guide-to-reverse-trials>;
  TechCrunch summary:
  <https://techcrunch.com/2022/11/12/freemium-or-free-trials-why-not-both/>
- Elena Verna is often quoted as saying reverse trials lift free→paid by
  10–40%. **[secondary; operator anecdote, not a study]**
  (<https://userpilot.com/blog/2022/07/02/saas-reverse-trial/>)

**Relevance.** PipGlyph's admin comp is already a reverse-trial mechanism
(a Plus/Pro tier for a period, no Stripe, back to Free after). The referral
reward for free users (§7) is effectively a reverse trial that someone earned.
That makes it a cheap way to measure whether a no-card month of Plus converts.

---

## 2. Comps and free months

The evidence that free periods help *retention* is mixed to negative:

- **Datta, Foubert & van Heerde (2015)**, *Journal of Marketing Research*
  52(2) **[primary, peer-reviewed]**, studied 16,512 households at a
  European digital-TV provider. Customers acquired through a free trial
  churned more and were less profitable. The press summary quotes about half
  gone within two years and about 59% lower total profit than regular
  customers. They were also more sensitive to their own usage and to
  marketing. The authors' remedy is to remind free-trial customers of their
  own usage ("you made N cards").
  <https://research.tilburguniversity.edu/en/publications/the-challenge-of-retaining-customers-acquired-with-free-trials/>,
  press summary: <https://phys.org/news/2015-04-free-trial.html>
- ProfitWell (Patrick Campbell) has argued for years that discount- and
  promo-acquired customers have lower lifetime value. Its own pages that
  could be reached state the question but not the figure
  (<https://paddle.com/studios/shows/profitwell-report/discounting-benchmarks>).
  Treat "discounts cut LTV by ~30%" as **unverified**.

**Takeaway.** A free month is an acquisition and activation tool, not a
retention tool. It works when the recipient uses the paid features during
the month (usage reminders), and it should not stack into long free runs.
That argues for caps (§7).

---

## 3. Referral programs

### 3.1 Dropbox (2008–2010)

- **[primary]** Drew Houston's "Startup Lessons Learned" slides (April 2010)
  say a "referral program w/ 2-sided incentive permanently increased signups
  by 60%". Users sent "2.8M direct referral invites" in the **trailing 30
  days** (April 2010). Many blogs misreport that as an 18-month total.
  Registered users went from 100K (Sep 2008) to 4M (Jan 2010), the
  oft-quoted "3900%". The slides credit **PayPal's $5 signup bonus** as the
  inspiration. One copy of the deck gives 35% of daily signups from referrals.
  <https://www.slideshare.net/gueste94e4c/dropbox-startup-lessons-learned-3836587>
- **Reward design [primary]:** today's Dropbox help centre gives 500 MB per
  referral on Basic, capped at 16 GB, and 1 GB per referral on Plus and
  Professional, capped at 32 GB. That works out to **a cap of 32 referrals**.
  A referral counts only when the friend **installs the desktop app**, which
  is an activation trigger, not a signup. Sharing a folder does not count.
  <https://help.dropbox.com/storage-space/how-much-free-space>
- Why it worked: the reward was the product itself (more storage), it was
  two-sided, and it was **paid on activation** (the install). It was also
  capped, so storage given away stayed bounded.

### 3.2 PayPal (1999–2000)

**[secondary; consistent across many retellings, no primary transcript found]**
PayPal paid $20 to each side, then cut it to $10 and later $5. Daily growth of
7–10% is reported. Thiel and Musk are quoted as putting the total cost at
about $60–70M. Thiel's own lesson is that user growth was exponential but so
was the cost, with no revenue against it. Cash rewards that are not tied to
activation are the costly extreme.
<https://www.aakashg.com/paypal-the-original-product-growth-company/>,
<https://growsurf.com/blog/paypal-referral-program/>

### 3.3 Morning Brew (newsletter)

A milestone or tiered program, not per-referral cash: 1 referral → a weekly
draw entry, 3 → stickers, 5 → a premium Sunday newsletter, 10 → a mug, up to
larger swag. The share attributed to referrals varies by source and date:

- About 30% of subscribers, from product lead Tyler Denk, via GrowSurf
  <https://growsurf.com/blog/how-morning-brew-grew-its-subscribers/>
- About 20% of signups, from co-founder Austin Rief, in Press Gazette
  <https://pressgazette.co.uk/?p=170609>
- About 1,000 referral signups a day at 2M+ subscribers, also Rief, in Digiday
  <https://digiday.com/media/its-an-undervalued-growth-channel-publishers-eager-for-subs-increasingly-see-high-value-in-newsletter-referral-programs/>

**[secondary, but founder-attributed]**. Lesson: escalating, *visible*
milestones keep referrers going after the first reward. The rewards are
cheap and branded.

### 3.4 Notion, Canva, Figma, Superhuman

- **Notion** once offered $10 of credit to new signups and $5 per referral.
  It has since been withdrawn. **[secondary, deal sites]**
  <https://www.moneysmylife.com/tag/notion/>. Its current program is an
  affiliate scheme, closed to new applicants:
  <https://www.notion.com/affiliates>.
- **Canva:** sources conflict on whether the referrer earns a free month of
  Pro or Canva credits, and on whether the trigger is a friend's signup or a
  friend's payment. **[secondary; unverifiable]**
  <https://www.saasquatch.com/saas-referral-marketing-examples/>. The
  separate affiliate program pays up to $36 per Pro signup.
- **Figma** grew without a referral-bonus engine. Its loop was multiplayer:
  every shared file brought in a viewer or commenter (Kevin Kwok, "Why Figma
  Wins", via <https://chriscoyier.net/2020/06/23/why-figma-wins/>).
  **Lesson for PipGlyph:** the public card page, share image and deck pages
  are the organic loop. A referral program sits on top of that loop and does
  not replace it.
- **Superhuman:** a "free month for you and each friend" referral screen is
  documented in UI teardowns (<https://lazyweb.com/canvas/flows/superhuman/referral>).
  No published results were found. **[weak]**

### 3.5 What the research says generally

- **Referred customers are worth more [primary, peer-reviewed].** Schmitt,
  Skiera & Van den Bulte (2011, *Journal of Marketing* 75(1)), studying a
  German bank: referred customers had a higher contribution margin, were
  more loyal, and were worth **at least 16% more** than comparable
  non-referred customers. The gap varied by segment.
  <https://faculty.wharton.upenn.edu/wp-content/uploads/2012/04/Schmitt-Skiera-vandenBulte-2011-Referral-Programs-Customer-Value.pdf>
- **Two-sided beats one-sided [vendor/secondary consensus]**, mostly because
  the friend's reward gives the referrer a reason to send the link without
  feeling they are spamming. Dropbox credits the two-sided incentive
  explicitly (above).
- **Reward on a qualifying action, not on signup [primary practice]:**
  Dropbox requires the install. Uber releases the reward only after the
  referee completes the program's requirements (a first trip) and caps some
  markets at **50 payouts**
  (<https://www.uber.com/gb/en/legal/referral-program-rules/>). Fraud vendors
  agree: fake referees "do the bare minimum" needed to qualify, so the bar
  should be a real use of the product, and rewards can be held until refund
  windows pass
  (<https://www.sardine.ai/learn/referral-fraud>,
  <https://www.prefinery.com/blog/referral-fraud-types-and-prevention/>).
- **Fraud signals [vendor, consistent]:**
  - Device and email are the main signals, and disposable-domain lists are a
    common first filter.
  - Shared IPs are weak because households and offices share them. Use IP as
    one input to a score, not as a block.
  - Score risk rather than hard-block near-matches.
  - <https://www.thumbmarkjs.com/content/promo-code-abuse/>,
    <https://affonso.io/help/risk-center/disposable-email-detection>
- **Stripe card fingerprint [primary]:** `payment_method.card.fingerprint`
  identifies the same card number within one Stripe account. It ignores
  expiry date, may differ for Apple Pay or Google Pay tokens, and can be used
  in Radar lists and rules.
  <https://support.stripe.com/questions/how-can-i-detect-duplicate-cards-or-bank-accounts>,
  <https://docs.stripe.com/radar/lists>

### 3.6 Stripe: giving a paying subscriber "a free month"

Read through search excerpts of the docs. Verify on a test clock before
building.

- **Customer balance (credit)** (<https://docs.stripe.com/billing/customer/balance>):
  - A credit balance is applied automatically to the **next finalized
    invoice**, up to that invoice's total. The rest carries forward.
  - You cannot choose which invoice it hits; any invoice, including
    proration invoices, consumes it.
  - It is a ledger with an audit trail, which suits accounting.
  - It is per customer and per currency.
  - It is not refunded automatically on cancellation
    (<https://support.stripe.com/questions/refunding-credit-balance-to-customer-after-subscription-downgrade-or-cancellation>).
  - PipGlyph already relies on this behaviour: a Pro→Plus downgrade proration
    lands on the balance (`docs/BILLING.md` test table).
- **Coupon** (<https://docs.stripe.com/billing/subscriptions/coupons>): a
  `duration: once` coupon applies to the **next invoice whatever its
  length**.
  - **A 100%-off `once` coupon on an *annual* subscriber gives away a whole
    year.** A fixed `amount_off` equal to one month avoids that but is
    currency-specific.
  - A coupon competes with any other discount on the subscription, such as
    the win-back coupon.
  - Once the invoice finalizes, the discount disappears from the
    subscription, so later surfaces cannot see it.
- **Moving `trial_end` on an active subscription**
  (<https://docs.stripe.com/billing/subscriptions/trials/free-trials>,
  <https://docs.stripe.com/billing/subscriptions/prorations>):
  - Adding a trial to an active subscription is a proration trigger by
    default, and it moves the billing anchor.
  - The status becomes `trialing`, which PipGlyph's billing logic reads as a
    trial: one trial per account, `trial_will_end` notifications,
    `isUnconvertedTrial` and the trial credit tranche.
  - Stripe's newer "trial offers" cannot be extended at all.
  - The alternative is moving the period end with a schedule or
    `pause_collection`. Both are heavier and change dates that many PipGlyph
    surfaces print.

---

## 4. Pricing pages

- **Decoy effect [primary-ish, often retold].** Ariely's *Economist*
  experiment: web $59, print $125, print + web $125 → 16 / 0 / 84. With the
  "print only" decoy removed → 68 / 32. Students, small sample, a classroom
  study (<https://en.wikipedia.org/wiki/Decoy_effect>). Lesson: the options
  *around* a plan change which plan gets chosen.
- **Annual discount.** "Two months free" (about 16.7%) is the most common
  annual offer. Blogs attribute an average of about 16% (range 10–20%) to
  ProfitWell's 6,000-company dataset; the original was not reachable
  **[secondary]**
  (<https://www.getmonetizely.com/articles/whats-the-optimal-discount-for-annual-developer-subscriptions-a-data-driven-approach>).
  The claim that annual plans churn far less is near-universal (e.g. "annual
  plans drastically reduce churn",
  <https://paddle.com/studios/shows/profitwell-report/annual-vs-monthly>),
  but the specific numbers quoted (30% lower churn, 92% vs 68% retention)
  could not be traced. PipGlyph's ×10 annual price *is* "two months free" and
  should say so in those words, alongside the monthly-equivalent price.
- **Plan count and highlight.** No rigorous study was found. Practitioner
  consensus is three visible tiers, one "most popular" highlight on the plan
  you want chosen, and annual as the default toggle with the saving shown.
  CXL and other "highlighting lifts selection 25%" numbers are
  **untraceable**. PipGlyph already marks Plus as `featured`.

---

## 5. Paywall timing

- **Gate at, or just after, the aha moment, not before it.** Practitioners
  agree on this, and it follows from the activation literature, but no
  benchmark quantifies it.
  - If users never reach the aha moment, the fix is onboarding, not the
    paywall.
  - Contextual prompts at the moment of limit (the 4th project, the
    out-of-credits moment) are the standard pattern.
  - Avoid prompts during onboarding.
  - <https://momentuminspired.beehiiv.com/p/product-led-monetization-when-and-how-to-introduce-paywalls>
  - **[vendor/secondary]**
- **PipGlyph's own data point [primary, internal].** With a monthly free
  refill, the out-of-credits moment "almost never happened (one account ever
  ran dry)" (`lib/billing/plans.ts` comment, 2026-09-24). That was the reason
  for "5 to start". This is the right shape: free users reach the aha moment
  (an AI card) up to five times, then hit a natural, contextual gate.
- PipGlyph's natural value moments, roughly in order:
  1. The first AI card.
  2. The first download, where the watermark is the gate.
  3. Running out of credits.
  4. Hitting the 50-card cap.
  5. Print exports (Pro).

  Each already has a surface-tagged upgrade path. The work left is to measure
  conversion *by surface*.

---

## 6. Win-back

- **Reactivation rates [vendor/secondary, inconsistent definitions]:**
  - 5–15% of targeted lapsed subscribers is typical; optimised multi-email
    sequences reach about 15%
    (<https://dev.to/daniel_layfield_210727e0e/subscription-win-back-how-to-reactivate-lapsed-subscribers-1l3p>).
  - In app subscriptions, monthly subscribers come back about 4× as often as
    annual ones (RevenueCat, via
    <https://www.revenuecat.com/blog/growth/when-is-the-best-time-to-send-a-win-back-offer.md>).
  - Recurly reports that about one in four new subscriptions on its platform
    comes from a previously cancelled subscriber, and recommends one-click
    reactivation (<https://recurly.com/blog/customer-winback-strategies-for-subscriptions/>).
- **Timing:** a 7 / 30 / 90-day cadence is the common framework, with the
  discount usually at about day 30 **[practitioner]**.
- **Discounts:** a time-boxed deep discount (one month) is the standard
  offer. If people left because of price, the same price will not win them
  back; if they left because they stopped using it, a discount will not
  either. Ask why they cancelled, and send a "here's what's new" message
  before reaching for a coupon. **[practitioner]**
- PipGlyph today: a lapsed *trial* gets one email and a 20% coupon valid for
  30 days. **Cancelled paying subscribers get no win-back sequence** beyond
  the in-app "Resume" button while the plan is still running out.

---

## 7. Ranked recommendations for PipGlyph

Ranked by expected impact relative to effort.

1. **Ship the double-sided referral, triggered on activation (first saved
   card), with the caps and fraud rules in §8.**
   - *Evidence:* Dropbox (+60% signups, two-sided, paid on install, capped at
     32); Schmitt et al. (referred customers worth at least 16% more);
     Uber's activation trigger and payout cap.
   - *Effort:* medium. Comps, the Stripe balance and funnel events already
     exist.
2. **Instrument conversion by surface and cohort before tuning anything.**
   - Free→paid by first-touch source, including `ref`.
   - Activation milestones → `upgrade_modal_open` → checkout → trial →
     first payment.
   - *Evidence:* every source agrees benchmarks vary 3–5× by context. Our
     own number is the only one that counts.
   - *Effort:* low. `funnel_events` and the `first_*` milestones exist.
3. **Usage reminders to trialists and comped users** ("You made 7 cards
   and 3 clean downloads this week"), sent at mid-trial and two days before
   the trial or comp ends.
   - *Evidence:* Datta et al. 2015: free-trial customers respond to their
     own usage information.
   - *Effort:* low. The email shell, notifications and `trial_will_end`
     already exist.
4. **A win-back sequence for cancelled paying subscribers**, not only
   lapsed trials:
   - Day 7: "what's new", with one-click Resume or resubscribe and no
     discount.
   - Day 30: one discount for one month.
   - Ask the reason at cancellation and skip the discount for "stopped
     using".
   - *Evidence:* Recurly (about a quarter of new subscriptions are
     returners); the practitioner 7/30/90 cadence.
   - *Effort:* low to medium. This reuses the `trial_lapsed` machinery.
5. **Make the contextual gates sharper at the three value moments:** the
   watermark on download (show the clean version beside it), out of credits,
   and the 50-card cap. Lead with the plan, show packs second, and keep
   them free of nagging during onboarding.
   - *Evidence:* paywall-timing consensus; PipGlyph's own "nobody ran dry"
     lesson.
   - *Effort:* low.
6. **Test a no-card reverse trial for one cohort**, using the comp
   mechanism: seven days of Plus, unlocked at the first saved card, against
   the current card-required trial. Compare payers per 100 *activated*
   signups, not trial conversion.
   - *Evidence:* ChartMogul warns that the card requirement blunts volume;
     Poyar and Verna on reverse trials. The evidence is genuinely mixed,
     which is why this should be a test.
   - *Effort:* medium. It needs a cohort flag and a credit grant smaller
     than Plus's 30 (see §8.6).
7. **On the pricing page, say "2 months free" on annual, show the
   monthly-equivalent price, keep Plus highlighted, and default the toggle
   to annual.**
   - *Evidence:* the most common annual offer; annual plans churn less
     (directional); decoy and anchoring effects.
   - *Effort:* low.
8. **Make the referral visible where people are already proud:** right after
   a save, on a share, and on the public card page ("Made with PipGlyph,
   get a free month"). Add Morning-Brew-style visible progress ("2 of 3 this
   month").
   - *Evidence:* the Figma and Dropbox loops ride on sharing; Morning Brew's
     visible milestones.
   - *Effort:* low once item 1 is built.
9. **Keep the abandoned-checkout reminder at once per 30 days**, but send it
   within about 1 hour rather than at Stripe's 24-hour expiry. Pass
   `expires_at` a shorter value only if the data supports it.
   - *Evidence:* weak, practitioner only. Measure before changing.
   - *Effort:* low.
10. **Do not widen discounts further.** The trial, the win-back coupon, the
    pack discount and referral months are already four kinds of "free".
    - *Evidence:* Datta et al. (promo-acquired customers churn more);
      ProfitWell's discount-LTV warnings (unverified figure).
    - *Effort:* none. This is a guardrail.

---

## 8. Referral design implications

### 8.1 Trigger (activation)

- **Reward when the referred account saves its first card**, and only when
  the account is email-confirmed. Dropbox pays on install and Uber on a
  first trip. "First saved card" is PipGlyph's equivalent, but it is cheap
  to fake (one form submit), so pair it with the fraud checks below.
- **The referee's own reward goes out immediately** on the first save, since
  that is the activation moment and the reward reinforces it.
- **The referrer's reward is held for 72 hours.** During the hold:
  - the fraud checks re-run;
  - the reward is voided if the referee deletes the account or the first
    card;
  - the referrer sees "pending → earned".

  Fraud vendors recommend holding rewards until a reversal window passes.
  72 hours is a judgement call, not a benchmark.
- **The referee must be a new account:** created *after* the referral click,
  with no prior profile, Stripe customer or subscription history.

### 8.2 Reward size

One month on each side, as planned: Plus for a free user, or one month of
their *current* plan's price for a subscriber (see §8.6). It is the product
itself, as with Dropbox's storage, and it is two-sided. At Plus the
worst-case cost of one comp month is about 30 credits × $0.11 ≈ $3.30 of AI
spend, plus storage.

### 8.3 Caps

- **Monthly cap: 3 rewarded referrals per referrer per calendar month.**
  - A genuine hobbyist rarely converts more than one or two friends a month.
    Three leaves headroom for a playgroup or Discord moment while capping
    what one abuser can farm.
  - Rewards past the cap still *count* (towards progress and badges) but do
    not grant months. The referee is still rewarded. This keeps the friend's
    side whole and removes the referrer's incentive to farm.
- **Lifetime cap: 12 earned months per referrer.** That is a year free, the
  same order as Dropbox's 32-referral ceiling and Uber's 50-payout cap, but
  in months, because months are PipGlyph's real cost.
  - Past 12, offer a non-cash thank-you, such as a profile badge or an
    "Ambassador" flair.
  - Owner decision: whether to allow banking. Recommendation: earned months
    queue and are consumed one at a time; they do not stack into one long
    comp.

### 8.4 Attribution window

- **30 days from the click to account creation**, then **30 days from
  account creation to first saved card**. Past either window, nothing is
  rewarded.
- **Owner decision on how to carry the click.** The current first-touch
  attribution deliberately uses sessionStorage, with no cookie (CLAUDE.md
  Billing → FUNNEL). sessionStorage dies with the tab, so the effective
  window today is one browser session.
  - Option (a): accept same-session attribution. This is simplest and most
    private, and still covers most link → signup flows.
  - Option (b): add a first-party `localStorage` entry holding only the
    referral code and click time, read at signup and deleted afterwards.

  Recommendation: (b), disclosed in the privacy policy. Either way, the
  referral code also travels in the signup form, the same way first-touch
  attribution does, so the email-confirm round trip keeps it. The rule is
  **first-touch wins**: a later click does not steal a referral.

### 8.5 Fraud heuristics

**Hard blocks** (no referrer reward; the referee still gets their month
unless it is plainly the same person):

- **Self-referral:** the referee's user id equals the referrer's, or the
  normalised emails match. Normalise by lower-casing, stripping `+tag`, and
  removing dots in Gmail and Googlemail local parts.
- **Same Stripe card fingerprint:** at any time within 90 days, a card
  `fingerprint` on the referee's Stripe customer matches one on the
  referrer's. That voids or claws back the referrer's pending reward and
  blocks future rewards between the pair. Fingerprints are scoped to
  PipGlyph's Stripe account, which is what is needed. Wallet tokens may not
  match, so this signal is useful but not complete.
- **Disposable email domain** on the referee, checked against a maintained
  disposable-domain list. Block the reward, not the signup.
- **Circular pairs:** A refers B and B refers A; only the first direction
  counts.

**Soft signals** feed a review queue (`/admin`), never an automatic block:

- **The same *custom* email domain** on both accounts, e.g. both
  `@smallshop.com`. Coworkers and families legitimately share these, so it
  only flags.
  - **Never treat common free-mail domains as a match** (gmail.com,
    googlemail.com, outlook.com, hotmail.*, live.com, yahoo.*, icloud.com,
    me.com, proton.me / protonmail.com, gmx.*, aol.com, yandex.*, qq.com,
    and others). Most legitimate pairs share one.
- **The same IP or network at signup and first save.** Households and
  playgroups share these, so it only flags.
- **Velocity:** more than 3 referred signups from one referrer within 24
  hours, or many referees whose first card is near-empty (default title,
  no art).
- **No real use:** the referee does nothing after the first save within 7
  days. Use this signal to tune the rules over time, not to claw back.

**Grant only with admin-auditable rows:** one ledger row per reward with a
reason, voidable.

### 8.6 How "one free month" is delivered

- **A free user** (the referee, or a free referrer) **gets a comp month of
  Plus**, using the existing admin-comp mechanism with a `referral` reason.
  - If a comp is already running, extend its end by 30 days rather than
    stacking a second record.
  - **Do not grant Plus's full 30-credit allotment.** Today an unexpired comp
    on a free account "is still owed its tier" of credits (`docs/BILLING.md`).
    The cleanest abuse is farming accounts for AI credits, which is the only
    real cash cost.
  - Recommendation: the referral comp unlocks Plus *features* (clean
    downloads, capacity, print perks) plus a **10-credit grant**. The owner
    may prefer to match the trial's 25. Either way, the credit grant must be
    a separate, explicit number.
- **A paying subscriber gets a Stripe customer-balance credit equal to one
  month of their current plan's monthly price** ($6 Plus, $15 Pro), as a
  negative balance transaction with metadata `referral:<id>`. Why this
  rather than the alternatives:
  - It applies automatically to the next invoice, with no schedule or date
    change, and the status stays `active`. PipGlyph already handles balances
    from downgrades.
  - A **100%-off `once` coupon would make an annual renewal free for a
    whole year**, and it collides with the win-back coupon slot.
  - Extending `trial_end` would flip the subscription to `trialing`,
    re-anchor billing and trip the one-trial, trial-notification and
    trial-credit logic.
  - Costs to accept:
    1. On an annual plan, the credit is worth one-twelfth of the renewal,
       which is fair: one month's value.
    2. An upgrade's proration invoice may consume the credit first. That is
       still the user's money.
    3. Unused balance is not refunded on cancellation. Say so in the terms.
  - **Must verify:** a monthly invoice that the balance brings to $0 must
    still run the monthly credit refill. The "Payment received"
    notification keys on `amount_paid > 0`; check that the credit grant in
    the `invoice.paid` resync does not key on it as well. Test on a Stripe
    test clock.
- **A trialing user also gets a customer-balance credit of one month.**
  The trial still ends and converts on schedule, the first real invoice is
  reduced (to $0 on monthly), and the "full allotment on first payment"
  grant must fire on that $0 invoice too (same verification as above). Do
  not extend `trial_end`. That delays conversion and the allotment, and it
  muddles `trial_lapsed` and the win-back coupon.
  - If the trialist cancels before converting, the balance stays on the
    Stripe customer and applies if they ever subscribe. That is an
    acceptable, honest outcome.
- **A comped (non-Stripe) referrer** gets 30 days added to the comp end,
  within the lifetime cap.

### 8.7 Measurement

Tag every referral row with `funnel_events` (`referral_link_copied`,
`referral_signup`, `referral_activated`, `referral_reward_granted`,
`referral_reward_voided`). Compare referred cohorts with organic ones on
first-30-day activation, free→paid conversion within 90 days, and 6-month
retention. Schmitt et al. predict that referred users are worth more. If
that does not hold for PipGlyph, shrink the reward rather than grow it.
