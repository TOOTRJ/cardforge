# Getting people to share — research and recommendations (2026-11-06)

Owner's ask (2026-11-06): put the signed-in user's referral link into every
share button with a short message; fix the share modal's Copy link; research
what successful sites did to encourage sharing and come back with ideas and
recommendations. **Nothing here is built.** The two asks are diagnosed and
planned in §1; the research is §2–§4; the recommendation is §5.

## 1. The two things already asked for

### 1a. The referral link in every share button

Today `ShareTargets` (`components/cards/share-targets.tsx`) builds each
target's URL from the card page URL plus `?via=<network>` (GA attribution,
stripped from the address bar on landing by `ShareParamCleanup`). The
referral code is a separate thing: `/?ref=<code>` from the Refer-a-friend
page. Two facts make the owner's plan cheap:

- `AttributionCapture` sits in the ROOT layout and reads `?ref=` on ANY
  landing page (`lib/analytics/attribution.ts`), so a card URL carrying
  `ref` already attributes the signup; the referral row is written at
  onboarding from that first touch as it is today. No change to the
  referral pipeline.
- The share text is one string per target; a second sentence fits.

Plan (one PR, small):

1. ONE helper, `shareUrlFor(url, { via, ref })` in `lib/sharing/share-url.ts`
   — adds `via` and, for a signed-in viewer with a referral code, `ref`.
   Every target in `ShareTargets`, the native share, Copy link and Copy for
   Discord go through it; the creator's post-save prompt, the trending
   share button and the deck page share the same component, so they follow.
2. The viewer's code reaches the client once: `/api/me` gains
   `referralCode` (already `my_referral_code()` on the server), read where
   the share dialog mounts; a signed-out viewer gets plain links.
3. The message: the share text stays about the CARD ("<Title> — a custom
   Magic card I made on PipGlyph") and gains one short line when a code is
   present: "Join with my link and you get 30 free days of Plus when you
   save your first card." (the settings' `friend` reward words, the same
   phrase the Refer-a-friend page uses — never a hard-coded "30 days").
4. The landing: a card page opened with `?ref` by a signed-out visitor shows
   one quiet line under the card — "Made on PipGlyph · your friend's link
   gets you 30 free days of Plus when you save your first card" with a
   Create button. The canonical URL stays clean (no `ref`, no `via`).
5. Keep the program switch: with referrals OFF (`site_settings.referrals`)
   no `ref` is added and no line shows.

Risk check (from §3): Substack attaches the reader's referral link to every
share button and restack as first-party design with no reported backlash;
the backlash cases are pushy asks and MLM-style feeds. A query parameter on
a link the user chose to share, with the text still about the card, is the
safe shape. On Reddit the IMAGE should be the post (with artist credit,
r/custommagic rule 1), never a bare link — the Reddit target already submits
the page URL; leave the ref there, it is the page the mods see.

### 1b. The share modal's Copy link row

Verified on the preview (screenshot in the session): the row shows the URL
clipped mid-word with no ellipsis, and the text ends in `?via=copy`. Cause:
the URL `<span>` has `truncate`, but its parent (`flex flex-1 flex-col`)
has no `min-w-0`, so the column grows to the URL's full width and the
button's own overflow cuts it. Fix: `min-w-0` on the column (one class) —
then the ellipsis draws. Second, smaller decision: whether the preview text
shows the `?via=copy` tag. The copied link carries it on purpose (GA's
"copy" attribution); showing it looks like a mistake to a user. Options:
(a) show the clean URL and copy the tagged one — the preview and the
clipboard differ by the tag; (b) show and copy the tagged one, as now;
(c) drop the `via` tag from Copy link alone (GA loses the "copy" channel,
the biggest one). Recommendation: (a), with the row's hover title saying
"copies the link with a tracking tag". With 1a the copied link also carries
`ref`, so (a) matters more.

## 2. What worked elsewhere (sources in the reviewer's report; first-party only where said)

- **Dropbox** (first-party slides, 2010): two-sided storage reward raised
  signups 60 %; referrals were 35 % of daily signups, shared folders and
  other viral surfaces another 20 %. The "3900 %" figure is total growth,
  not referral-attributed.
- **Airbnb** (first-party post, quoted through vendors): the ALTRUISTIC
  framing ("give your friends $25") beat the selfish one; "the less mature
  the market, the more a referral program does" — PipGlyph's case.
- **Harry's prelaunch** (founder write-up): 100 k emails in a week, 77 %
  via referral, MILESTONE tiers (5 / 10 / 25 / 50 friends); the typical
  referrer brought 5.
- **Duolingo** (ex-CPO, 2023 — the cautionary tale): an Uber-style "free
  month of Plus" referral moved new users 3 % because the most active
  users already HAD Plus — the reward excluded the people most likely to
  refer. A redesigned leaderboard moved engagement far more.
- **Substack reader referrals** (first-party, 2023): the reader's link is
  attached to every share button and restack automatically; three
  stackable reward tiers; a page shows "how close to the next reward".
  Exactly the owner's plan 1a, shipped at scale, no reported backlash.
- **Loom / Canva / Typeform**: the output is the ad — a "made with" mark
  that links back (Loom to ~1 M users before a paid plan). PipGlyph already
  stamps pipglyph.com on every render (layout v20); the missing half is the
  landing page's "make your own" moment.
- **Discord Nitro**: gifting as a growth lever — the GIVER gets a cosmetic.
- **Suno**: both sides get credits once the friend makes 10 songs
  (activity-gated, as our first-card gate).
- **The MTG space** (fetched 2026-11): MTGCardsmith (likes, Top-100
  creators, forum contests, Discord), mtg.design (Moxtober prompt-a-day
  event), Moxfield / Archidekt (Discord of 15 k, feature voting), Scryfall's
  `[[card]]` bot as the hobby's lingua franca. None runs a referral
  program; their growth is community events + Discord + links that unfurl
  well.

Benchmarks (referral-vendor data, B2B-skewed, directional): 5–15 % of active
users see the program, 10–30 % of those share, 15–25 % of clicks convert;
K-factor 0.04–0.45.

## 3. Mechanics, the evidence, and the risks

| Mechanic | Evidence | Verdict for PipGlyph |
|---|---|---|
| Two-sided reward, friend's gift first | impact.com 2024: no conversion difference single vs double; rewarding the FRIEND is what matters; Airbnb's altruistic framing | Keep two-sided (built); lead every ask with what the friend gets |
| Milestone tiers + progress ("2 of 3 friends") | Harry's, Morning Brew, Substack; endowed-progress effect (34 % vs 19 % completion with a head start) | Strong and cheap |
| Share at the moment of pride (post-save, post-render) | vendor consensus; Spotify Wrapped's per-slide share | Strong, cheap to test — the post-save prompt exists |
| "Made with" mark linking back | Loom, Canva, Typeform | Half built (the mark); add the landing moment |
| Referral link on every share | Substack (first-party) | Safe in the quiet shape of §1a |
| OG image quality | big-image link shares ≈ 1.7× clicks (old Facebook data); Discord: 30-min cache, `summary_large_image` for the big layout, multiple `og:image` = a gallery | Keep big; both faces as a gallery is a one-liner |
| Share-to-unlock | no A/B found; Meta demotes share-baiting; unverifiable | Avoid |
| Leaderboards | Duolingo +17 % learning time; MTGCardsmith Top-100 | Good for CREATORS (likes); weak as a referral driver at small scale |
| Reminder nudges | Substack footers + welcome email; referral hubs | Cheap: banner, digest line, post-render toast with a frequency cap |
| Discord-native | Scryfall bot norm; guidelines forbid DM blasts, not an invited bot | Excellent unfurls first; a tiny bot later |
| Reddit | r/custommagic ~110 k; artist credit mandatory; site-wide spam rule, the 10 % norm | Post the image, credit the artist, never a bare ref link |
| Contests / prompt events | Moxtober, #canvalove, MTGCardsmith; challenges exist | Proven in this hobby |

Risks: a reward paid users can't use (Duolingo); pushy asks and MLM feel
(Temu 2023); share-baiting; trial farming (our first-card gate, caps and
keyed email fingerprint already cover the vendor consensus); Reddit
shadow-bans for the same link across subs; stale previews after a re-bake
(`renderVersionOf` already busts the cache — keep it on share URLs).

## 4. Ranked ideas (evidence-to-effort, this product's size)

| # | Idea | Why | Effort |
|---|---|---|---|
| 1 | **1a + 1b above**: ref on every share + the landing line + the Copy link fix | Substack, Dropbox's shared-folder channel; the mark is already on every render | S |
| 2 | **Post-save share prompt leads with the picture and the FRIEND's gift** | Airbnb framing; moment-of-pride timing | S (the prompt exists) |
| 3 | **A reward paid users can use** — the referrer's reward for a Plus/Pro account becomes credits (or days ADDED to the paid plan, which `grantFreeDays` does) | Duolingo's 3 % | S (a settings value + copy: `referrer.kind` per tier) |
| 4 | **Milestone tiers with a progress bar** on Refer a friend and in the prompt ("1 of 3 — next: +50 credits") | Harry's, Morning Brew, Substack, endowed progress | M (`referral_tiers` in the settings; the claim function is already atomic) |
| 5 | **Discord-first unfurl**: `summary_large_image`, both faces as an `og:image` gallery; later a 100-line bot answering a PipGlyph link or `[[name]]` with the card + "Make your own" | the hobby's norm | S (unfurl) / M (bot) |
| 6 | **Monthly prompt event with sharing built in** ("Pipglyph-tober"; each entry has Share with ref; the digest lists the theme) | Moxtober, #canvalove; challenges exist | M |
| 7 | **Reminder surfaces**: a dashboard banner after the first public card, one digest line, a post-render toast once per 7 days | Substack's footers; cheap | S |
| 8 | **Creator leaderboard by likes / shares** (never by referrals) | MTGCardsmith; Duolingo | M |

Avoid: share-to-unlock, queue-jumping waitlists, auto-posting to Reddit,
Discord DM or bulk invites.

## 5. Recommendation

Ship 1 and 2 first (one PR each, both small, both measurable through the
existing `share` GA event and the `signup` funnel row's `referred` flag),
then 3 — it fixes a real hole: a Pro subscriber who refers today earns "30
free days of Pro" they already have, Duolingo's exact mistake. 4 is the
first thing to build once the program has a month of data (the tier
thresholds should come from what the median referrer actually does; Harry's
saw 5). 5's unfurl half is a one-line change worth folding into 1. 6–8 are
good second-quarter work. Measure one number: signups with `referred: true`
over 30 days, before and after.
