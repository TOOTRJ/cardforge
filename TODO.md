# TODO

- [x] **Local dev no longer touches production** (2026-09-21). `.env.local`
      → the shared `dev` Supabase branch; `npm run dev` refuses to start
      against prod; prod creds parked in `.env.prod-peek`. Full environment
      rework + audit: docs/ENVIRONMENTS.md.

- [x] **Separate AI Gateway key for Preview + Development** (done 2026-09-21;
      production keeps its original key).

- [x] **`main` ruleset** (2026-09-21): PR-only, required checks `Typecheck, lint,
      unit` / `E2E (local Supabase)` / `Supabase Preview`, admin bypass.

- [ ] **New guide: "Card Conjurer alternative"** (target keyword: *card
      conjurer alternative*; secondary: *cardconjurer alternative*, *card
      conjurer replacement*, *card conjurer not working*, *custom mtg card
      maker like card conjurer*). Persuasive, honest comparison written for
      someone whose Card Conjurer workflow broke or stalled: what Card
      Conjurer did well (frame fidelity, free, offline-ish), what PipGlyph
      does better (live preview = print output, verified frame geometry from
      real scans, custom mana pips, AI art/rules assistant, deck proxy
      printing, gallery/sharing, no install), an honest "where Card Conjurer
      still wins" section (trust signal), a migration path ("rebuild your
      card in 3 minutes" walkthrough with the Scryfall import), and an FAQ.
      SEO/AI-search checklist: file `content/articles/card-conjurer-alternative.mdx`
      with `title` "The Best Card Conjurer Alternative in 2026 (Free MTG Card
      Maker)", `description` ≤155 chars containing the keyword, tags
      `["card makers", "comparison", "card design"]` so it joins the
      existing `/best-mtg-card-makers` cluster; H1 = keyword phrase, H2s as
      natural questions ("Is there a Card Conjurer alternative that works in
      the browser?", "Can I import my Card Conjurer cards?"), a comparison
      table (feature × PipGlyph / Card Conjurer), FAQ section rendered with
      the `FAQPage` JSON-LD helper (`components/seo/json-ld.tsx`), internal
      links to `/mtg-card-maker`, `/best-mtg-card-makers`, `/create`,
      `/articles/how-to-print-proxy-mtg-cards`, and a `<Callout>` CTA to
      `/preview` (no account needed). Add the slug to the "Best card makers"
      page's cross-links and to `lib/content/clusters.ts`; regenerate the
      per-article OG image automatically (existing `opengraph-image.tsx`).
      Keep claims verifiable (no invented Card Conjurer bugs); date it and
      set `updated` when Card Conjurer's status changes.

## Frames & card creation plan (2026-09-24)

From the 2026-09-24 card-creation/frame audit (report delivered in chat, not
in the repo). Ordered for execution: each phase unblocks the next. Priorities:
**[P0]** blocks the goal or users get a wrong card today · **[P1]** needed for
"complete frames / great creator" · **[P2]** quality · **[P3]** later. Line
numbers refer to commit `6077252` (the Card Conjurer audit notes to ~#378);
PRs #370–#382 moved a lot of code since, so search by symbol.

Status sync 2026-09-25 (main `267f46c`, PRs #370–#382 merged): Phase 0 done
except 0.17, 0.18 (partly), 0.22 and 0.24; the Card Conjurer M15 swap shipped
(4.2 storage, 4.3 importer for the M15 family, 4.4 with 4.16–4.18 inside it,
layout v24) plus the frame-review follow-ups (layout v25–v28, 4.31). Phases
1, 2, 5 and 6 have not started; the P0 live bug 3.13 is still open, and 3.14
is fixed (migration 0118; the owner re-bakes its two cards after deploy).
The borderless research of the same day adds 0.25, 1.16–1.18, 3.23,
4.32–4.38, 5.7 and 7.7 (all open; order at the end of this section).
The full-art research (2026-09-26) adds 0.26, 1.19, 3.24 and 4.39–4.44 (all
open; order at the end of this section).
The token research (2026-09-29, owner request: creature, artifact and
enchantment tokens and emblems; Scryfall pulls 2026-09-28) adds 1.23, 3b.15,
4.48–4.54 and 6.23 (all open; 4.49 is a P0 live bug; order at the end of this
section), with the owner's nine decisions of 2026-09-29 recorded in the
items. #396 (merged 2026-09-29) resolves every 2015-frame token `exact` on
the arch frame; 1.23 says what changes there. (2026-09-29: 4.49 (a) + (d) and
3b.15 built as layout v34 on `feat/token-v34`; 4.49 (b)'s text-box templates
on `feat/token-textbox`, unverified; the rest is open. Round 10,
owner-approved 2026-09-29, adds 4.55 — the arch's tall text box, split out
of 4.49 (b).)

Owner decisions this plan is built on (2026-09-24): first target the ~35
high-value frames, then expand by the import request log · Card Conjurer (CC)
art + measured bounds for the whole M15 era, MSE (744–750 px sources) for
showcase families and the 1993/1997/2003 borders · frame masters move out of
git into a storage bucket behind the CDN · the stepper stays the primary
creator (the canvas lab stays an experiment) · frames publish by auto-score +
owner sign-off per template · canonical render stays 1500×2100.

Cautions: CC's frames were the subject of Wizards' 2022 cease-and-desist and
the fork declares no licence, so land the storage move (4.2) before the first
CC frame ships and record provenance per template (4.1). The M15 re-source
(4.4) changes every existing card's look — bundle it with the other
layout-version bumps (3.12, 4.8, 4.9) so users see ONE "newer look" prompt.
(Status 2026-09-25: the storage move landed first (#377) and provenance is
recorded per CC template in `lib/cards/frame-sources.json` (#378). Since 0.20,
geometry changes are badge-free "sweep" bumps, so 4.4 shipped on its own as
v24 (#380) without 3.12/4.8/4.9 and nobody saw a "newer look" prompt; later
corrections can each ship as their own sweep.)

Open decisions are marked **[decide]**; none blocks its phase.

### Phase 0 — Unblock verification (1–2 weeks)

- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.1 [P0] Rotate landscape scans in the compare tool + score route.**
      Scryfall's battle/split PNGs are portrait with the content rotated 90°;
      ours are landscape. Rotate 90° CW in a swapped box (CSS) and
      `sharp().rotate(90)` with `W=1040,H=745` when the profile is landscape —
      `components/admin/frame-compare.tsx`:443,
      `app/api/admin/frame-align-score/route.ts`:95.
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.2 [P0] Map the second face into the reference render** — adventure/
      flip/split/aftermath compare against an empty half because
      `lib/scryfall/reference-preview.ts`:32 drops `patch.back_face`. Map it to
      `backFace` (split `subtypes_text` like the front).
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.3 [P0] Read-your-own-write after saving an override** — replace
      `revalidateTag(TAG, "max")` with `updateTag()` in
      `lib/cards/frame-profile-override-actions.ts`:100,121 and
      `lib/creator/lab-actions.ts`:31 (Save re-reads the OLD map today).
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.4 [P1] Conditional Reset** — `.delete().select()` and mark renders
      stale only when a row existed; clear draft-only state client-side —
      `frame-profile-override-actions.ts`:114, `frame-profile-editor.tsx`:302.
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.5 [P1] Slot outline above the scan** — render `SlotOverlay` after the
      `<img>` as a sibling (`frame-compare.tsx`:233,443).
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.6 [P1] Key `FrameCompare` on template/colour only** and sync `draft`
      from `savedOverride` in an effect so a save no longer resets
      mode/zoom/score — `app/(app)/admin/frame-compare/page.tsx`:148.
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.7 [P1] Selecting `costRect`/`symbolRect` must not dirty the draft** or
      persist a detached box the admin never edited (`frame-compare.tsx`:145).
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.8 [P1] Reference pinning validates colour and kind** — refuse when
      `pickFrameColorKey(parseColorIdentity(card)) !== colorKey` or the kind
      differs — `lib/cards/frame-review-actions.ts`:144.
- [x] (fixed 2026-09-25 — feat/registered-frame-score) **0.9 [P1] Registered, masked scoring (the "auto-score" foundation)** —
      align scan→render on the frame's pinlines (phase correlation or
      projection-profile edge fit), correct the 745×1040 ≠ 5:7 and MSE 0.4 %
      stretches, mask the art window + text runs, `brandMark: false`, flatten
      the scan, score SSIM/edge-IoU per slot, report the best per-slot dx/dy
      as the suggested nudge; drop the "the number should drop" copy
      (`components/admin/frame-guide.tsx`:28). New `lib/frames/align.ts`.
- [x] (done 2026-09-25 — feat/verification-metadata, migration 0115: version + override hash + reference + score stamped per tick, frame_review_events history, "re-verify" state; per-TEMPLATE sign-off deferred to 2.4 with the auto-score job) **0.10 [P1] Verification metadata + history** — migration adding
      `verified_layout_version`, `verified_override_hash`, `score_json` and a
      history table; flip to "needs re-verification" when the override or the
      frame PNG hash changes; sign-off becomes per TEMPLATE with per-colour
      auto-status (colours still individually withdrawable).
- [x] (done 2026-09-25 — feat/frame-reference-registry: 225/259 combos have references (34 documented nulls), most with a second printing; bloomburrow/bloomanime/tarkir/fullart flagged "confirm" for a human look) **0.11 [P1] Complete the reference registry** — two `highres_scan`,
      non-foil, non-promo printings per combo (short + long text) for every
      template, via a script that runs Scryfall searches and writes
      `FRAME_REFERENCES`; kind-aware sample content for the combos with no real
      printing — `lib/cards/frame-reference-registry.ts`:301.
- [x] (fixed 2026-09-25 — fix/fold-frame-overrides: folded into code, rows deleted by migration 0114; [decide] resolved: fold) **0.12 [P1] Fold the six production overrides into code** (m15devoid,
      m15land, m15pw, m15snowland, modern, saga) and delete the rows so
      previews/local/e2e render like production (dev branch has 0 rows,
      `supabase/seed.sql` seeds `frame_reviews` only). **[decide]** fold vs
      seed — fold recommended since 0.9/4.x re-derive geometry.
- [x] (fixed 2026-09-25 — feat/frame-gate) **0.13 [P1] Server-side verification gate** — reject unverified
      (template, colour) in `createCardAction`/`updateCardAction`
      (`lib/cards/actions.ts`:193) + `superRefine` in
      `lib/validation/card.ts`:217; frame chips disable / auto-swap colour when
      the current colour is unverified (`card-setup-panel.tsx`:291); check the
      kind-change, import and AI-fill fallbacks
      (`card-creator-form.tsx`:776,1056,1319) and toast on every substitution.
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.14 [P2] Verify click revalidates the ISR guest creator** —
      `frame-review-actions.ts`:63, `app/(marketing)/create-guest/page.tsx`:28.
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.15 [P2] Keyboard nudges** — ignore Cmd/Ctrl combos, fix Alt/Option on
      macOS, unify the "Alt for 0.5 %" copy (`frame-compare.tsx`:172,
      `frame-profile-editor.tsx`:334).
- [x] (fixed 2026-09-25 — fix/frame-compare-correctness) **0.16 [P2] Stale-marking covers legacy template values**
      (`normalizeFrameTemplate` targets; `frame-profile-override-actions.ts`:55).
- [x] (shipped in feat/creator-reliability: an admin's `/api/scryfall/search` call is never refused by the per-user quota and never logged (is_admin from `getCurrentProfile()`, never the request; a failed profile read keeps the quota; the profile read and the read-only quota check run in parallel), so the reference picker never spends the admin's `search` bucket, which `/api/scryfall/printings` shares. The global throttle in `lib/scryfall/client.ts` still spaces every upstream call. Admin searches no longer show on `/admin/scryfall` (the page says so; logging them under a separate action would need a migration — owner call). Tests: `tests/unit/api/scryfall-search-route.test.ts`, `scryfall-search-throttle.test.ts`) **0.17 [P2] Admin reference-picker lookups don't burn the admin's
      per-user Scryfall quota** (`app/api/scryfall/search/route.ts`:94).
- [ ] **0.18 [P2] Tests** (partly done 2026-09-25: reference validation, override save/reset stale marking, second-face preview, scan geometry, templateSupportsKind; #375 added `setFrameReviewAction` (stamps + reference-column preservation) and `setFrameReferenceAction` (refusal, pin/unpin events) in `tests/unit/cards/frame-review-actions.test.ts`, and per-kind sample content is covered in `frame-verification.test.ts` — still open: a test for `/api/admin/frame-align-score` itself (only `lib/frames/align.ts` is unit-tested), verify toggle + pin e2e) — `setFrameReviewAction` (reference-column
      preservation), `setFrameReferenceAction`, override save/reset stale
      marking incl. NULL-template rows, the score route,
      `buildFrameComparePayload` with a second face, per-kind sample content;
      e2e for verify toggle + pin.
- [x] (fixed 2026-09-25 — feat/frame-gate) **0.19 [P1] Honest marketing** — derive the homepage "frame styles" stat
      from the verified set (`app/(marketing)/page.tsx`:302), fix `README.md`:6
      "three decades", fix the Card Conjurer comparison row claiming split/
      adventure (`content/articles/card-conjurer-alternative.mdx`:65).
- [x] (fixed 2026-09-25 — fix/render-updates-sweep-not-badge: `hasNewerLook` counts only opt-in bumps, null stamps = platform re-bake, compare page re-bakes via the `marked` scope + admin action, notifications keyed on the newest opt-in version; no migration needed) **0.20 [P1] Frame-geometry changes are platform corrections, never owner
      badges** (owner-reported 2026-09-25: one layout-override save on the
      compare page put "A newer look is available" on 176 of the dev
      database's 189 baked cards, and the same would hit every M15 card in
      production on the Card Conjurer swap). Saving/resetting an override
      (`lib/cards/frame-profile-override-actions.ts`) and any frame-PNG
      replacement (4.4) must queue an admin re-bake of the affected cards
      instead of marking them opt-in stale: a sweep-pending marker that
      `hasNewerLook` does NOT read as a badge (today it nulls
      `layout_version`, which is the badge), a "Re-bake N cards" control on
      the compare page driving `/api/admin/rebake` in batches, and the daily
      `notify-render-updates` cron skipping sweep-pending cards. Correction
      bumps keep `VERSION_ROLLOUT: "sweep"`; the badge is for taste changes
      only. Land before 4.4.
- [x] (fixed 2026-09-25 — same PR: watermarked PNG serves the bake unless a platform correction is pending (`hasServableStoredRender`), ETag follows the bake stamps, paid clean PNG/PDF stay live with a modal note; the PDF is paid-only so it never had a stored source) **0.21 [P1] A card downloads the way it looks** (owner-reported
      2026-09-25) — the watermarked PNG download and the PDF serve the stored
      bake whenever one exists (`fetchStoredRender(card, { allowStale: true })`,
      as the OG image already does), so an owner who has not accepted a newer
      look does not get it in a download; a clean paid download has no stored
      source and stays live (say so in the download modal + docs). Route test
      for the stale-bake path. Land with 0.20.
- [x] (fixed 2026-09-25, layout v29 — the compare-tool check in the last bullet is the owner's step, and aftermath stays unverified until it is done) **0.22 [P1] Aftermath bottom half rotates the wrong way** (Card Conjurer audit 2026-09-25) — `AFTERMATH.secondFace.rotation` is 270 (`lib/cards/template-layout.ts`:1066). CSS/Satori apply that as 90° COUNTER-clockwise (`components/cards/card-preview.tsx`:669,1427, `lib/render/card-image.tsx`:329,1667). MSE's `angle: 270` is counter-clockwise, while CC (`packAftermath.js`:39-42, rotation 90) and the printed Cut // Ribbons and Commit // Memory are 90° clockwise. So today the second title reads bottom→top with its cost at the top, and the second art is upside-down relative to the frame (whose bar layout already matches print).
      - [x] Set rotation to 90. Slots rotate about their own centres, so footprints stay put.
      - [x] Re-check the rotated rules box against CC (x 6.94–44.94 / y 57.0–90.57, 0.0507 W) so wide text can't reach the type bar. Re-cut to CC's turned bounds; title + type boxes start where the print's do (y 56.5 %), the type box centred on its bar.
      - [x] Parity test: the second title's first glyph sits above its cost (tests/unit/render/aftermath-bake.test.ts, tests/unit/components/aftermath-preview.test.tsx).
      - [x] Also in v29 (owner answer): both halves print at one set of sizes, M15's scan-calibrated title 0.05 / type 0.0435 / cost 0.0485 W, rules from the 9 pt standard (`AFTERMATH_TEXT`), like the print and CC; the sideways bottom name bar (name, gap, cost) shrinks AS ONE only as far as it must, measured in Beleren's own metrics (`secondFaceLineSizes`, `lib/cards/display-metrics.ts`), so a long cost stays on the bar. And the bake's sideways art window paints its art as a px-placed background (`RotatedArtBake`), with no art-free strip (4.31).
      - [ ] Compare-tool check against Cut // Ribbons with the 0.1/0.2 rotated render before 2.2 walks aftermath. It is unverified, so no user sees it yet. (Owner's step.)
- [x] (won't do — owner decision 2026-09-25: "when the cards are created they become original, so the wording is correct") **0.23 [P0] Rewrite the 'original frames / no copyrighted assets' claims before any CC frame ships** (Card Conjurer audit 2026-09-25) — About 13 public lines promise original, non-WotC frames/fonts/mana symbols:
      - `components/marketing/marketing-hero.tsx`:108 ('Original frames — no copyrighted assets used.')
      - `app/(marketing)/mtg-card-maker/page.tsx`:162
      - `app/(marketing)/mana-pip-editor/page.tsx`:154
      - `app/(marketing)/best-mtg-card-makers/page.tsx`:39,54,240-241,356 (+ the :16 comment)
      - `lib/content/faq.ts`:54,214,218,226
      - `content/articles/how-to-print-proxy-mtg-cards.mdx`:31
      - `content/articles/mtg-card-frame-eras-explained.mdx`:13,68
      - the `lib/billing/plans.ts`:6 comment

      They are already inaccurate: the bake ships Beleren Bold + MPlantin (`lib/render/card-image.tsx`:1921-1931), and the frames are MSE replicas. They become flatly false with 4.4. Replace them with accurate fan-content wording: MTG-style frames recreated for fan use under the Fan Content Policy, unofficial, not affiliated, never sold, proxies for personal casual play. `/disclaimer` stays the one full statement. **[decide]** owner/legal wording.

      Acceptance: a unit test greps `app/(marketing)`, `components/marketing`, `lib/content` and `content/` for the banned phrases. Land before 4.4 (extends 0.19).
- [x] (shipped in feat/creator-reliability: checked against the cached Card Conjurer fork (Investigamer/cardconjurer `2fcddba`). Card Conjurer's Scryfall import (by name, every printing, 12 languages), its /print sheets (up to nine images, Letter/A4, PNG or PDF, cutting aids), local-storage saves plus the `.cardconjurer` export and its free-form layer editor (text boxes take numeric bounds — "Edit Bounds" — only the art is dragged) are now stated; "one renderer" is gone (a browser preview plus a separate server renderer, checked by parity tests), and so are its twins elsewhere — /faq's "same layout engine … pixel-for-pixel", the custom-pips answer's "same layout engine" and the homepage feature grid's "pixel for pixel" (the content test bans all three phrasings and now scans `components/marketing`); PipGlyph's import says "pick a printing" (the strip caps at 30); the /mtg-card-maker FAQ agrees that cardconjurer.com came back as a template tool and that proxy sheets are a deck's custom cards; the comparison is now on hosting and accounts, AI, custom pips, decks and decklist import, the gallery, verified frames and foil/etched on any frame; deck printing says only the custom cards print; `updated` 2026-09-26; `lib/content/faq.ts`'s "difference from MTG Cardsmith or Card Conjurer" answer no longer claims the editable-JSON model sets PipGlyph apart. Not changed: the "original frames/fonts" wording (0.23, owner decision — the owner may want to revisit it here, where the Card Conjurer contrast is sharpest). **Open:** MDX has no GFM, so this article's comparison table and the tables in 10 other guides render as raw `|` text — add `remark-gfm` (a new dependency) with a table mapping in `mdx-components` and a compile test, before or with this PR so the corrected table is readable) **0.24 [P1] Correct the Card Conjurer comparison article** (Card Conjurer audit 2026-09-25) — `content/articles/card-conjurer-alternative.mdx` gets several facts wrong:
      - :68 says CC has no Scryfall import. It imports by name, with all printings, in 12 languages (`creator/index.html`:638-662).
      - :69 says CC offers a 'PNG per card'. It also has PDF print sheets (`/print`).
      - :26 and :63 claim 'one renderer' (so does :39, 'One renderer drives the editor preview…'). PipGlyph has a DOM preview plus a separate Satori bake, with open parity items 3.1–3.7. (Still all present at `267f46c`; #371 fixed only the split/adventure row, 0.19.)

      Describe the preview as 'matches the export, checked by parity tests (3.11)'. Compare on the real differences: hosted with an account, AI, custom pips, decks, gallery, verified frames. When 6.14 ships, also update `lib/content/faq.ts`:221-222 and :74-76 of the article ('no CC import'). Extends 0.19's 'keep claims verifiable'.
- [x] (done 2026-09-26 — feat/quick-wins, migration 0119: every stored `borderless` finish → `regular` with `updated_at`, the render columns and `layout_version` kept (only `cards_set_updated_at` is disabled around the UPDATE); `CARD_FINISH_VALUES` drops it and `RETIRED_CARD_FINISHES` makes the validator / `normalizeCardFinish` read a legacy value as `regular`; borderless and regular bake byte-identical PNGs; 0014 errata; anatomy copy reworded. The map entry is the one expected `grep` hit outside frame/treatment code. Owner, before merge: the admin count by visibility and `cards_set_updated_at` present in `pg_trigger` for `public.cards`; after deploy, an anonymous read for `finish=borderless` returns 0 rows) **0.25 [P1] Retire the dead `borderless` finish** (borderless research 2026-09-25) — `"borderless"` is still a `CardFinish` (`types/card.ts`:247-259, where the comment says it "lets the art bleed under the section panels"). zod accepts it (`lib/validation/card.ts`:216), two tests pin it (`tests/unit/cards/validation.test.ts`:91-95, `tests/unit/billing/premium-gating.test.ts`:15), and migration 0014 documents it (`supabase/migrations/0014_card_finish.sql`:17). It has drawn nothing since the MSE-schema rebuild (commit 1220988, 2026-06-01): both renderers branch only on foil/etched/showcase (`components/cards/card-preview.tsx`:612-614, `lib/render/card-image.tsx`:246-249), and the picker no longer offers it (`components/creator/panels/effects-panel.tsx`:25-53). The only place a user sees it is the edit/remix summary, which prints "Finish: Borderless" (`components/creator/locked-summary.tsx`:48,62-65). Production has 12 public cards with `finish: borderless` from 4 owners, created 2026-05-15 to 05-23: 11 on m15, 1 on tarkirdragon. None came from a borderless printing (for example, Smothering Tithe ← CMM #57, which is black-bordered). They bake as ordinary bordered cards. Private rows are not counted yet.
      - Count every row with an admin query (`frame_style->>'finish' = 'borderless'`, all visibilities) before writing anything.
      - Migration at the next free number (0119 today): set those rows to `regular` without touching `updated_at`, `rendered_at` or `layout_version`. No pixels change, so no rebake and no badge. Give it explicit grants per CLAUDE.md, although it is data-only.
      - Drop `"borderless"` from `CARD_FINISH_VALUES`. Keep a zod `preprocess` that reads a legacy `borderless` as `regular`, so an old draft or remix never fails to parse. Update both tests and the finish comment. Correct 0014's header through the errata in `supabase/migrations/README.md`, never by editing the migration.
      - Borderless becomes a frame treatment (templates 4.32–4.38, import signature 1.17), never a finish. Only foil and etched stay finishes, which matches Scryfall's `finishes`: nonfoil/foil/etched, and borderless printings come in all three.
      - Copy: `content/articles/mtg-card-anatomy-explained.mdx`:34 says edge-to-edge art "depends on the frame era you choose", but no edge-to-edge template is published (0 of 71 verified combos). Reword it until 4.32 publishes (extends 0.19).
      - **Decided 2026-09-26 (owner: "go with your recommendation")**: (a) reset silently — the cards already look the same. (The alternative was a one-time "Borderless is here" notification when 4.32 ships.)

      Acceptance: the migration is idempotent; the zod test shows `borderless` parses to `regular`; `grep -rn borderless types lib components` finds only frame/treatment code.
- [x] (fixed 2026-09-26 — feat/quick-wins) **0.26 [P1] Full-art frames: honest names and kind gates before anything publishes** (full-art research 2026-09-26) — The six 2026-07 variation templates (`types/card.ts`:328-333: `extendedart`, `fullart`, `fullartland`, `m15textless`, `m15textlessland`, `expeditionland`; sets :456-461) are all unverified: production's 71 verified combos are the m15 family, saga and modern/w (`supabase/seed.sql`:36-58), and an anonymous read of `frame_reviews` for them returns 0 rows. Production also has 0 public cards on any of them (`content-range */0`). Three problems will show up as soon as 2.1's admin preview or a verification tick exposes these frames:
      - **`fullart` is not full art.** It is the Zendikar Rising hedron showcase: picker label "Hedron" (`types/card.ts`:381), profile label "Full Art" (`lib/cards/template-layout.ts`:1743-1745), references Makindi Ox ZNR #293 and others (`lib/cards/frame-references.json`). Scryfall flags none of the ZNR showcase printings `full_art` (`set:znr is:showcase is:fullart` → 404, checked 2026-09-25).
        - Move it to a new "Zendikar Rising" frame set in the showcase era, so the picker reads "Zendikar Rising — Hedron". This mirrors #382's `tarkirdragon` → `multiverselegends` move, printed once through `setQualifiedFrameLabel`.
        - The key stays `fullart`: it is stored in `frame_style`, in `frame_reviews` and in `lib/cards/layout-version.ts`:210.
        - Fix the comment at `template-layout.ts`:1741-1742 ("edge-to-edge art").
        - Fix the M15TEXTLESS comment at :1799-1802. It promises "scrim-backed rules", but FULLART has no `backdropHex`.
      - **Kinds the frames can't draw.** `SHOWCASE_KIND_RESTRICTION` (`lib/creator/card-kinds.ts`:248-253) leaves `fullart`, `m15textless` and `extendedart` open to every kind. These profiles have no loyalty slot and no `loyaltyRows`, so a planeswalker prints no loyalty value and its abilities come out as plain lines (HD bakes K and F in `scratchpad/fullart/today/renders`), and a battle gets no defense. Take planeswalker and battle off all three until 4.5's overlays exist.
      - **Basic lands only on `fullartland`.** It is allowed for kind `land`, and that kind includes nonbasics. On a shockland it prints cream rules straight on the art with no backdrop (bake C, Hallowed Fountain).
        - Add a per-template `basicOnly` flag, checked with `basicLandManaKey` (exactly one basic subtype, so dual lands stay out, 3b.4).
        - The frame chip is disabled with the reason "Full-art basic frames are for basic lands".
        - The server refuses the frame next to `frameGateError` (`lib/cards/frame-availability.ts`:37-48) and in 0.13's `superRefine`.
        - Nonbasic edge-to-edge lands belong to 4.34. The same flag serves 4.39–4.41.

      No stored card changes: no pixels, no migration, no bump.

      Acceptance: `templateSupportsKind("fullart","planeswalker")` and `templateSupportsKind("m15textless","battle")` are false (extend `tests/unit/creator/card-kinds.test.ts`:353-354). The `fullartland` chip is disabled with its reason for Hallowed Fountain. The server gate refuses `fullartland` on a nonbasic land. The picker shows "Zendikar Rising — Hedron".
      Shipped: `fullart` is in the new `zendikarrising` set, listed after Dragon Wing (key, label "Hedron" and bucket paths unchanged; profile label "Zendikar Rising Hedron"). `SHOWCASE_KIND_RESTRICTION` gives the three frames every standard kind but planeswalker and battle; `BASIC_ONLY_TEMPLATES` = `fullartland`, checked with `isSingleBasicLand` (`basicLandManaKey` plus at most one basic type). Where the code differed from this item: 0.13 shipped no `superRefine` in `lib/validation/card.ts`; its gate is `frameGateError` in the card actions. So the new server gate `frameKindGateError` (`lib/cards/frame-kind-gate.ts`) runs beside it in `createCardAction`/`updateCardAction`. An update is checked as the patch over the stored row and keeps a legacy pin editable. Only showcase restrictions are enforced there, never border-era frames: an artifact on plain m15 stays savable. The same rule also covers reference pinning (`validateReferenceForCombo`) and AI frame picks (`resolveGeneratedFrame` takes the designed card's `face`). The admin checklist, the compare title and the reference-pin errors print showcase frames set-qualified (`eraGroupFrameLabel`). The creator never strands a card on a basic-only frame: Land type → Nonbasic, or a rename that clears the basic seed, moves it to the land frame it is a variation of with a toast (`basicOnlyFrameFallback`); the "any frame in this colour" fallback of `resolvePublishedFrame` skips basic-only frames; the AI fill dialog doesn't offer them; and the Card step now prints a server `frame_style` refusal (this gate or 0.13's), which used to render nowhere. Confirmed 2026-09-26 by anonymous reads: 0 public production cards on the six templates and 0 `frame_reviews` rows for them (71 verified rows total). Left for 4.5 / 4.39 (found in review): lotr, lotrscroll, avatar, bloomburrow, bloomanime and the three tarkir frames still take planeswalkers and battles with no loyalty or defense slot; `m15textlessland` spreads FULLART's un-scrimmed rules yet accepts nonbasic lands; `fullartland/m` stays verifiable in the admin checklist although no basic is multicolour.

### Phase 1 — Import uses the exact frame (2–3 weeks)

- [x] (done 2026-09-26 — shipped in feat/import-correctness: the eight printing-level fields typed beside #385's four, and the face schema keeps `colors`, `color_indicator`, `artist`, `watermark` and `layout`; 58 real printings in `tests/unit/scryfall/fixtures/import-printings.json` back the Phase 1 tests. The per-face artist is parsed but not yet imported: 1.8) **1.1 [P0] Parse the full frame vocabulary** in `lib/scryfall/client.ts`:
      typed `border_color`, `full_art`, `textless`, `promo_types`, `set_type`,
      `security_stamp`, `color_indicator`, `produced_mana`, `watermark`,
      `finishes`, `flavor_name`, `lang`, `collector_number`; face-level
      `artist`, `colors`, `color_indicator`, `watermark`, `layout` (the strict
      face schema strips them today).
- [x] (done 2026-09-26 — shipped in feat/import-correctness: `frontFaceColors` / `frameColorsFromScryfall` (was `parseColorIdentity`). Per-face colours on transform/MDFC/battle faces; the card's colours for split, flip and adventure cards (Scryfall gives an adventurer its creature's colour); a Room's first door from its cost. A colourless front stays colourless unless it is a land or devoid. Devoid → its identity. A multi-faced land front → the front face's own symbols and basic land types (Westvale Abbey is colourless; its black identity is Ormendahl's). A single-faced land (a reversible card counts as one) → `landFrameColors`, a heuristic checked on Scryfall's scans, because Scryfall has no field for a land's frame colour: from the 2003 frame on, the colours of the mana it PRODUCES (`produced_mana`; identity only when Scryfall lists none) — Rootbound Crag prints R/G; any-colour lands print gold (Command Tower, the curated m15land/m default that used to be refused as colourless; the Thriving lands, the CLB Gates, Nykthos); utility lands that tap for {C} print colourless although their activation costs are coloured (Kessig Wolf Run, Gavony Township, Hanweir Battlements — base imported them gold/red). The 1993/1997 frames → the identity (any-colour lands print the plain land frame there). `LAND_FRAME_OVERRIDES`, by Oracle name, holds what the data can't predict: the five Vivid lands print their own colour, and Crumbling Vestige, Gemstone Caverns, Mirrex, Springjack Pasture and Urborg print grey; 1.4's registry supersedes the table. Design check: `cards.color_identity` is the frame colour (single-select, two colours collapse to multicolor) and never held Commander identity; deck entries keep Scryfall's identity via `lib/decks/import-resolution.ts`, pinned by a test, and the public Card details row now reads "Color", not "Color identity". The frame-compare render and the pin check read the same rule: over all 482 registry printings, 18 references the pin check refused are now accepted, none newly refused after moving two misfiled alternates (Cavern of Souls ZNE → expeditionland/m, the DSK Room out of split/m). Still wrong, for 1.4: fetch lands print their two colours but Scryfall gives them no identity or produced mana (Flooded Strand KTK #233 imports colourless)) **1.2 [P0] Colour from the front face** — `colors`/`color_indicator`
      first; `color_identity`/`produced_mana` only for lands and devoid
      (`lib/scryfall/import-mapper.ts`:271). Fixes DFC fronts importing gold
      and Westvale Abbey importing as a black land.
- [x] (done 2026-09-26 — shipped in feat/import-correctness: precedence token > land > creature > planeswalker > battle > enchantment > artifact > instant > sorcery (Bident of Thassa's "Legendary Enchantment Artifact" prints the Nyx ENCHANTMENT frame), and the other type words stay in `supertype` in printed order, so no word is lost (a layout kind's card type is preferred when the line carries it: Urza's Saga keeps "Land" instead of reading "Enchantment Enchantment"). Template: Artifact Creature → m15artifact (1.7), artifact token → m15tokenartifact, snow/devoid still win on the spell frame, and a KHM snow land (`frame_effects ∋ snow`) takes m15snowland. Kinds: a transforming Saga is a saga, a Room is its first door as an enchantment with the second as `back_face`, Class/Case their front face's kind, an Omen (Scryfall layout `adventure`) the adventure layout. The creator's import frame choice is one pure helper the tests run, `resolveImportFrame` (`lib/creator/frame-resolve.ts`). Left open: the renderers print the supertype BEFORE the card type, so some lines read their words in another order and a land creature hides its P/T (1.20); a layout kind still writes its own card type over the printed one (1.21)) **1.3 [P0] Type-line + layout precedence** — land > creature > rest for
      `card_type`; template from the whole word set (Artifact ⇒ `m15artifact`,
      Token+Artifact ⇒ `m15tokenartifact`, Artifact Land stays a land);
      Saga/Room/Class/Case/Omen from the front-face subtype (transforming
      Sagas, Rooms no longer Split) — `import-mapper.ts`:172-210.
- [x] (done 2026-09-28 — shipped in feat/import-frame-signatures: `lib/scryfall/frame-signatures.ts`, an ordered rule table (first match wins) with stable signature ids (`FRAME_SIGNATURE_KEYS` / `isKnownFrameSignature`, for 1.6) and a declarative match over frame, border, frame effects, promo types, set / set_type, per-set collector ranges, kind and type words. The patch carries `frame_match` {status, template, exactLabel, reason, signature, landOn?, reject?, forGood?, blockedBy?}; `frame_template` stays `landOn ?? template` (layout kinds: undefined) and `frameTemplateFromScryfall` is a thin wrapper. **Exact:** the border eras (the 1993/1997/2003 standards, the M15 standard and its snow/devoid/artifact dresses), layout kinds on the 2015 frame, extended art, and the pinned showcase runs whose border is true (ZNR hedron, the Expeditions but for the black and green masters, the THB constellation run #258–268 → nyx, which an Enchantment Creature borrows since A3). LTR ring, TDM draconic, BLB woodland and TLA/TLE elemental resolve to their frames but are capped at `nearest` until their edge defects are fixed (A8). **Nearest, with a reason and `blockedBy`:** anatomy gaps (owner question 1's default: legendary crown and two-colour frames 4.6, colour indicator, vehicle, double-faced marks Phase 5, unmodelled layouts 4.27, etched 4.28, white/silver/gold border 4.30, frame marks 4.7, and the Nyx starfield every modern enchantment prints — 4.7's `m15nyx`, since `nyx` is the dark THB showcase: FDN #27 → nearest m15); the templates whose border isn't true (capped: 4.35's bloomanime, tarkirghostfire, tarkirdragon, lotrscroll, battle, and 7.7's avatar, bloomburrow, lotr, tarkirdraconic and expeditionland b/g — A8); a coloured artifact on 1997/2003 → m15artifact (Porcelain Legionnaire NPH #19); THS's 2003 Nyx → nyx (Bident of Thassa THS #42); a frame that can't dress the card's kind lands on the kind's standard (`landOn`: a KHM snow artifact → m15artifact, a TDM omen → adventure; a creature on Nyx that isn't an Enchantment Creature → M15). A 2003-frame textless promo names the 2003 frame until m15textless is verified in its colour (`onceVerified`, A9). `frame: future` → unsupported, nearest M15 (1.10). `withVerification` (`lib/creator/frame-resolve.ts`) makes exact need the verified combo, `/api/scryfall/named` finalizes it, `resolveImportFrame` reads `frame_match`. `LAND_FRAME_OVERRIDES` moved into the registry (`landFrameColorRule`): a fetch land for two basic land types prints both colours (Flooded Strand KTK #233 → m15land/m, Arid Mesa ZEN #211 R/W); on their scans Fabled Passage ELD #244 and Prismatic Vista MH1 #244 print the GOLD land frame (added as "gold"), Evolving Wilds MSC #240 grey. The pin check accepts a standard kind the frame can't dress yet when the printing's signature IS that frame, and warns when it resolves elsewhere. Registry: all 498 references resolve to their own template and pass the pin check (`tests/unit/cards/frame-reference-signatures.test.ts`, fixture `tests/unit/cards/fixtures/reference-printings.json`) except five production-verified DEFAULTS, allowlisted for owner re-verification against their alternates: m15snow w/b/g (KHM #1, #83, #192 print the plain M15 frame, not snow), m15devoid/c (no colourless devoid printing exists), m15token/c (the Treasure token prints the artifact token frame). Re-pinned: Serra Angel off alphaland/w and retroland/w; Sothera EOE #382 (a poster) off m15textless/b; m15textless/c → null (no colourless borderless textless printing); There and Back Again (a saga) → Rush the Room LTR #598 on lotrscroll/r; the Aang cards (multicolour) → Arcane Signet TLE #315 · Sol Ring TLE #316 on avatar/c; the Stormbrood omens off tarkirdraconic (+ Roiling Dragonstorm TDM #296 on u); bloomanime → Lumra BLB #343 (g), Baylen #345 · Alania #344 (m), w/u/b/r/c null (the anime run has no such printing). Fixtures: 96 printings in `tests/unit/scryfall/fixtures/signature-printings.json`. Left for later: 1.5's chooser, 1.6's request log; `seed.sql` listed only the pre-4.32 verified combos — A7's separate supabase PR mirrors production's) **1.4 [P0] Frame signature registry + resolver** in the mapper — every
      template declares the Scryfall signature it reproduces;
      `frame_match: { status: exact | nearest | unsupported, template,
      exactLabel, reason }` on the patch; `exact` requires the combo to be
      verified. Fixtures from live data: BLB anime #316–336 / #343–355
      (borderless + showcase + inverted, the same flags as woodland #295–315,
      split by collector range), ZNR full-art Island, THS Nyx (`enchantment`
      on a 2003 frame), LTR ring/scroll, TDM ×3 (including ghostfire #399–408,
      black-bordered, and #409–418, white-bordered: neither run is
      borderless), Expeditions (`set_type: masterpiece`), extended art,
      legendary crown, `*dfc` effects, `future`.
      **Borderless research 2026-09-25:** the borderless rules (families,
      precedence, fixtures) are 1.17.
      **Full-art research 2026-09-26:** the full-art and textless rules are
      1.19. Move 1.4's fixture "ZNR full-art Island" there (ZNR #269, 4.40).
      `full_art` never picks a template on its own: 0 of the ZNR showcase
      (24), ZNE (30) and EXP (45) printings carry it. So `fullart` (the ZNR
      showcase, relabelled by 0.26) and `expeditionland` need set +
      collector-range signatures.
      **Import-correctness review 2026-09-26:** the registry takes over
      `LAND_FRAME_OVERRIDES` (`lib/scryfall/import-mapper.ts`, 1.2) and
      these known misses, each checked on its scan:
      - a 2003-frame coloured artifact creature lands on the plain modern
        frame when modern is verified in its colour — Porcelain Legionnaire
        NPH #19 prints the white ARTIFACT frame, and `importFrameCandidates`
        never reaches m15artifact;
      - fetch lands print their two colours, but Scryfall gives them no
        identity and no produced mana — Flooded Strand KTK #233 imports
        colourless;
      - THS-block Nyx printings (`frame_effects ∋ enchantment` on a 2003
        frame: Bident of Thassa THS #42) land on the plain enchantment frame;
      - 24 registry references are refused by the pin check, as they were
        before 1.2/1.3 (THB gods on nyx, Serra Angel on alphaland/w and
        retroland/w, KHM snow artifacts on m15snow, the TDM Stormbrood omens
        on tarkirdraconic, Aang on avatar/c, a BLB Forest on bloomanime/c,
        There and Back Again on lotrscroll, …): re-pin or fix them with their
        signatures.
      **Owner decisions 2026-09-29** (owner: "recommendations" on the
      signature registry's nine questions, feat/import-frame-signatures):
      - **A1 anatomy gaps — kept:** the legendary crown, two-colour frames,
        the DFC marks, etched and white/silver/gold borders stay `nearest`
        (with `blockedBy` 4.6 / Phase 5 / 4.28 / 4.30).
      - **A2 full-art basics — kept:** a bordered full-art basic (split bar,
        plain bar, per-set, SLD, ONE/MOM, coloured borders) lands on
        m15fullartland once verified in its colour; a borderless basic lands
        on m15land with 'Use Borderless Full-Art Basic' offered.
      - **A3 Nyx for Enchantment Creatures — changed:** a creature borrows
        the Nyx showcase the way it borrows m15artifact (1.7): the creator
        offers it in a creature's Variations ("For Enchantment Creatures"),
        picking it writes "Enchantment" into the supertype and leaving it
        takes the word out, AI frames and the any-frame fallback skip it
        unless the card says Enchantment, the server gate accepts a creature
        on it, and the pin check accepts only an Enchantment Creature. The THB
        constellation gods (#258–268) resolve `exact` nyx, so they land on it
        once nyx is verified in their colour (M15 until then). Every
        Theros-block Enchantment Creature on the 2003 frame (THS / BNG / JOU
        gods, bestow creatures, Nyxborn, Eidolons; 117 printings with
        their promos and reprints) keeps
        `nearest` nyx without the kind landing, so while nyx is unverified a
        white one lands on M15, not modern/w (the only verified 2003
        standard) — **owner 2026-09-29: keep as built** (they land on M15
        until nyx is verified; no `onceVerified` on `nyx/2003`, Bident
        unchanged).
        Their `frame_template` is now `nyx`, so the AI deck remix needs
        #397's `remixFrameFor` (which resolves the remix frame against the
        verified combos) before a remix of one saves.
      - **A4 regular Nyx — kept:** the 2015 starfield enchantments are
        `nearest` M15 (`blockedBy` 4.7's `m15nyx`); THS's 2003 Nyx is
        `nearest` nyx.
      - **A5 — kept:** Fabled Passage and Prismatic Vista print the gold land
        frame.
      - **A6 — owner step:** re-verify m15snow w/b/g and m15token/c in the
        walk-through against the printings that ARE those frames — Search for
        Glory KHM #27 (w), Priest of the Haunted Edge KHM #104 (b), Sculptor
        of Winter KHM #193 (g), Eldrazi TBFZ #1 (c) — then retire their
        allowlist rows (`tests/unit/cards/frame-reference-signatures.test.ts`).
        **Snow half done 2026-09-29:** the owner re-verified m15snow w/b/g on
        production against those three (`frame_reviews.verified_reference_id`
        b65c215d…, 0cde0f4d…, 9dab2ca2…); feat/import-tokens makes them the
        curated defaults in `lib/cards/frame-references.json`, drops the
        non-snow Axgard Braggart, Deathknell Berserker and Sarulf's Packmate
        from the combos, and retires the three allowlist rows. The
        m15token/c half stays with 4.49's re-pin.
        (Corrected 2026-09-29 by the token research: this first named Cadet
        TFRA #1, an M20-design print, not the see-through arch frame
        `m15token` draws. The allowlist row's text still names TFRA #1: 1.23's
        import branch left it to 4.49's re-pin, which re-pins the token combos
        and resets their ticks, so its walk-through covers m15token/c.)
        m15devoid/c stays verified against Kozilek's Channeler BFZ #10.
      - **A7 — a new small supabase PR** (branch
        `chore/seed-verified-frames`, its TODO 7.9) mirrors production's
        verified `frame_reviews` in `supabase/seed.sql` (never ahead of
        production), so previews and the dev DB show the full-art landings
        and the Borderless offers.
      - **A8 — changed:** avatar, bloomburrow, lotr and tarkirdraconic join
        `BORDER_PENDING_TEMPLATES`, and expeditionland is capped in black and
        green only (`BORDER_PENDING_COLOURS`; no printed Expedition is either),
        until their edge defects are fixed (7.7's known failures; a test
        holds the two lists together).
      - **A9 — changed:** the 2003-frame textless promos (Player Rewards
        P05–P11, Wrath of God P07 #1) name the 2003 frame (modern) as their
        nearest until m15textless is verified in their colour, then
        m15textless (`onceVerified`, swapped in by `withVerification`). Future
        Sight textless printings keep m15textless (`textless/future`).
- [x] (done 2026-09-28 — shipped in feat/import-dialog-printings. **Printings:** `/api/scryfall/printings?oracle_id=&view=&page=` — `representative` (the default) is the 30-printing strip with the look label extended to frame | snow | devoid | border colour | full art | textless | showcase | extended art, so each look keeps a representative (`selectRepresentatives`, `lib/scryfall/printing-summary.ts`); every other view pages the FULL list, one Scryfall search per page on the user's `search` budget, `oracleid:<id>` + a qualifier (`PRINTING_VIEW_QUALIFIERS`, `lib/scryfall/printing-views.ts`; checked on the syntax page and the live API: `border:borderless`, `frame:showcase`, `frame:extendedart`, `is:full`, `is:textless`, `-frame:2015`, regular = none of them on `frame:2015`). Each printing carries collector number, border, full art, textless, treatment, artist, `has_back_image` and its match (`verifiedFrameMatchFromScryfall`, ONE `frame_reviews` read per request). **Dialog** (`components/creator/import/*`): `PrintingsGrid` + `usePrintings` (reused by 1.15) with the ✓ Exact · ≈ Nearest · ✕ Not available badge (tooltip: exactLabel — reason), a treatment badge incl. "Full art", filter chips Representative · All · Regular · Borderless · Showcase · Extended art · Full art · Textless · Old border, and Load more. **Chooser** (`lib/creator/import-frame-choice.ts`): a non-exact match — or an edge-to-edge match landing on its bordered twin (1.18) — asks before commit: the kind's published frames in the imported colour (FrameThumb tiles), `resolveImportFrame`'s landing preselected, Keep my current frame (disabled with the reason when it can't dress the card); three headings (PipGlyph doesn't have the X frame yet / can't match this printing's X exactly yet — a crown or colour-indicator gap / has X but Scryfall's art won't fill it) with the window-cropped note. A substitute card is Not available and can't be imported. The pick rides on `ScryfallImportPayload.frameChoice`; `handleScryfallImport` applies it after the kind change, re-checked (`appliedImportFrameChoice`), a stale pick falls back to the usual resolution. 1.16's pre-import hint and post-import toast/offer are retired from the dialog path (`printingTreatmentHint` / `printingTreatmentLanding` deleted); the `/create?deckCard=` pre-fill keeps auto-resolution plus ONE toast naming the substitution (`importSubstitutionMessage`, with the 4.32/4.39 offer as its action). The Card step shows "Frame substituted (imported X)" while the card sits on the substituted frame — "Nearest frame (imported X)" when it sits on the frame the registry names for the printing, short of a detail (the crown), and nothing on the printing's own exact frame, also when the user picked Borderless itself over the bordered landing (session-only; any frame or kind pick clears it). The deck-remix toast has the chooser's three situations: the cropped art (an edge-to-edge frame published in the colour), the reason (the printing's own frame short of a detail), or the missing frame. The overwrite copy names the match (exact, or nearest to X with the pick) and says the frame stays on "Keep my current frame". Owner decisions 2026-09-29 below: a crown / colour-indicator-only printing no longer asks, the chooser lists the standard frame and the printing's family first) **1.5 [P0] Import dialog UX** — per-printing status (✓ Exact · ≈ Nearest
      · ✕ Not available); full printings list with a treatment filter instead
      of newest/oldest 30 (`app/api/scryfall/printings/route.ts`:108,
      `client.ts`:304); on a non-exact apply, an inline "PipGlyph doesn't have
      the *X* frame yet — pick one of these" chooser (kind's published frames
      for the imported colour, nearest preselected, "keep my current frame");
      a "Frame substituted (imported …)" chip on the Card step; rewrite the
      "matched to this printing's border era" copy
      (`components/creator/scryfall-import-dialog.tsx`).
      **Full-art research 2026-09-26:** the treatment filter gets "Full art"
      and "Textless". Until the full list lands, the 30-printing strip's
      `selectRepresentatives` labels printings by frame + snow/devoid only
      (`app/api/scryfall/printings/route.ts`:105-128). Add `full_art`,
      `textless` and `border_color` to the label so each look keeps a
      representative, and badge full-art printings. For Plains, 17 of the
      newest 30 printings are full art.
      **Owner decisions 2026-09-29** (owner: "recommendations" on the
      dialog PR's four questions, feat/import-dialog-printings):
      - **C1 — changed:** no chooser when the ONLY gap is a detail no
        PipGlyph frame draws — the legendary crown, a colour indicator
        (`UNDRAWN_DETAIL_GAPS`). The registry now lists every anatomy gap
        that holds (`FrameMatch.gaps`, the reason's first); a `nearest`
        match whose gaps are all undrawn details, on its own frame (no
        `landOn`, published in the colour, a true border), imports there
        without asking (`onlyUndrawnDetailsMissing`); the Card step shows
        "Nearest frame (imported X)" with the reason as its tooltip, and
        the overwrite note says "the frame (M15 (2015) Standard — PipGlyph
        doesn't draw the legendary crown yet)". A second gap (the Vehicle
        plate, the two-colour split frame, Nyx, a nickname…) still asks.
      - **C2 — changed:** the chooser lists the nearest, the printing's own
        frame, the kind's M15 standard and the printing's family (its frame
        set — Bloomburrow woodland + anime, Tarkir draconic + ghostfire,
        the full-art basics, the textless frames, an era's standard; a skin
        such as Snow or Devoid only when it IS the printing's frame) first,
        with "Show all frames (N more)" for the kind's other frames in
        gallery order (keyboard focus moves to the first frame it reveals;
        each printing starts collapsed, and a pick among the other frames
        keeps them on show). With none of those published, everything
        shows.
      - **C3 — changed:** the `/create?deckCard=` pre-fill toasts only a real
        frame substitution: a crown / colour-indicator-only printing on its
        own frame gets just the chip (`importSubstitutionMessage` → null).
      - **C4 — kept:** on an edge-to-edge frame, the Identity-step art note
        for a full-art or textless printing's crop reads "Scryfall only has
        this art cropped to the printed frame, and it includes parts of that
        frame — upload the full illustration for a sharp borderless card"
        (1.18), not "classic window": those crops are taller than the
        window.
      - With #396's A3, the chooser offers Nyx to an Enchantment Creature
        (and re-checks a Nyx pick) through `borrowedFrameFits`, never to a
        plain creature.
      **Token research 2026-09-29:** 1.23 adds a "Tokens & emblems" search scope to this dialog. Scryfall's `include_extras` is sent only there, or as a fallback when a plain search finds nothing. The printings list (#399) is unchanged.
- [x] (done 2026-09-28 — shipped in feat/import-frame-requests: migration 0123 `frame_requests`, one row per import whose FINAL match isn't exact (the registry's `nearest` / `unsupported`, or an `exact` frame not verified in the card's colour — `withVerification`): signature, the registry's exactLabel, set + collector number + Scryfall id, status, the frame the card landed on, 1.18's art flag and the source (the import dialog, or the `/create?deckCard` pre-fill). Written only through `record_frame_request()` (security definer, stamps `auth.uid()`, raises on bad input, silently skips past 30 rows per user per hour) from `recordFrameRequestAction` (`lib/frames/frame-request-actions.ts`, the user's own client, validated by `frameRequestSchema`: a registry signature, a PipGlyph template, a set code; never throws), which `handleScryfallImport` fires and forgets after the frame resolution (`frameRequestFromImport`, `lib/frames/frame-requests.ts`) — never in an admin's frame preview (2.3), whose picker set is verified ∪ previewed and whose stepper walk-through (2.2) seeds through the same handler. RLS: admins read (`viewer_is_admin()`), no write policies; grants stated (select to authenticated, all four to service_role, anon and authenticated writes revoked for production's auto-grants; the counts function is service_role only). The import patch now carries `printing` (set, collector number, border, full art, textless). **/admin/frame-requests** (admin nav and avatar menu "Frame requests"): `admin_frame_request_counts(p_since)` per signature + set + cause, most distinct users first, then requests, over 30 / 90 days / all time, in two groups — "Missing frames" and "Not yet verified" — label, signature (flagged when it isn't a registry key) and the registry's TODO item, set, status, distinct users, requests, last seen, landed frame, art flags, a sample printing linked to Scryfall; the families PipGlyph won't build (`forGood`: posters, SLZ, substitute and art cards) sit collapsed at the bottom. Seeds: `supabase/seeds/21_frame_requests.sql`, 16 rows over real signatures and printings, both causes, a few from dev_* accounts, plus one retired key for the flag (a unit test holds each to the registry's answer for that printing). The signature ids are now stored data: never rename a rule key (`docs/FRAMES.md`); owner decisions D1–D6 below) **1.6 [P1] `frame_requests` table + admin panel** — written on every
      nearest/unsupported outcome (signature label, set, count, last seen);
      "most-requested missing frames" decides the order of 4.7/4.11.
      **Owner decisions 2026-09-29** (owner: "recommendations" on the
      request log's six questions, feat/import-frame-requests):
      - **D1 unverified exact frames — kept, and told apart:** both are
        logged, and each row stores WHY in `frame_requests.cause` (0123,
        CHECK `missing` | `unverified`; `unverified` only with status
        `nearest`): `missing` = the registry has no exact frame (its nearest
        or unsupported answer), `unverified` = its exact frame exists but
        isn't verified in the card's colour. `withVerification` marks the
        match it downgrades (`FrameMatch.unverified`), so the cause survives
        the named route's finalization; `frameRequestCause()` reads it. The
        page splits into "Missing frames" (build) and "Not yet verified"
        (verify in Frame compare). The seeded "Not yet verified" rows are
        frames production hasn't verified (Heliod THB #259 on Nyx, WOE #328
        on the extended-art frame) — never the FDN #282 Plains, which is
        exact on production's verified m15fullartland; a test re-derives
        every seeded row against `supabase/seed.sql` (A7 keeps it equal to
        production). Follow-up: a row doesn't store which frame + colour
        waits for verification (the page shows the label and where the card
        landed).
      - **D2 retention — kept:** no prune job; the log is small and kept for
        good (funnel_events prunes at 180 days; this doesn't).
      - **D3 per-user cap — kept:** 30 rows an hour per user, then silently
        skipped (`record_frame_request`).
      - **D4 order — changed:** most distinct users first, then requests,
        then the latest — in the RPC (its 500-row limit needs it) and
        `sortFrameRequestRows()`; the Users column comes before Requests.
      - **D5 avatar menu — changed:** "Frame requests" joins the avatar
        dropdown's admin shortcuts, after Frame compare.
      - **D6 made-up rows — changed:** the table still accepts any key (a new
        rule needs no migration), but the page flags a row whose signature
        isn't a registry key ("not in registry": a renamed or removed rule,
        or a key written straight through the RPC) and counts them above
        the groups.
- [x] (done 2026-09-26 — shipped in feat/import-correctness: `BORROWED_VARIATIONS` in `lib/creator/card-kinds.ts` offers m15artifact under a creature's M15 standard ("For Artifact Creatures"); it stays the Artifact kind's own standard. Picking it on a creature whose type line doesn't say Artifact writes "Artifact" into the supertype, and leaving the variation (Standard, another frame, another kind) takes out only the word it wrote. It never dresses a plain creature behind the user's back: AI frames skip it, random or by name, unless the designed card says Artifact (`resolveGeneratedFrame`), the AI fill dialog doesn't offer it, `resolvePublishedFrame`'s any-frame fallback skips it, and the reference-pin check accepts only an Artifact Creature on it (Llanowar Elves is refused). The import keeps "Artifact" in the supertype and asks for m15artifact before m15 (`importFrameCandidates`), so an Alpha Juggernaut lands on it when agclassic isn't published, and on agclassic paints the brown card. Pinning the curated m15artifact references (Solemn Simulacrum, Esper Sentinel, Phyrexian Metamorph, Baleful Strix, …) is no longer refused as the wrong kind) **1.7 [P1] Artifact creatures** — offer `m15artifact` under kind Creature
      as a variation with P/T and route "Artifact Creature" imports to it
      (`lib/creator/card-kinds.ts` `framesForKind`,
      `lib/cards/card-display.ts`:32). The import must keep the Artifact
      word too (`parseTypeLine` keeps one type word, so "Artifact Creature"
      lands as a plain creature): the Alpha frame paints its brown artifact
      card for "Artifact" in the supertype (4.31, `isArtifactFrameType`), and
      today an imported Juggernaut — or the frame-compare view of Battering
      Ram — gets the grey colourless card.
      **Owner decision A3 (2026-09-29):** the same borrow for the Nyx
      showcase — a creature may wear Nyx as an Enchantment Creature (the THB
      constellation gods). `BORROWED_SHOWCASES` / `borrowedTypeWord` in
      `lib/creator/card-kinds.ts` carry the word each borrowed frame writes
      ("Artifact", "Enchantment"); every 1.7 rule above reads it.
- [x] (done 2026-09-28 — feat/import-mapper-fixes: `/api/scryfall/named`'s card payload carries `has_back_image` (`hasBackFaceImage`, `lib/scryfall/client.ts`: `card_faces[1].image_uris` holds a URL), and the import dialog asks `/import-art` for `art-back` only then — a split, adventure, flip, aftermath or Room card is one image, so it no longer spends a lookup on a 404 and toasts "The back-face art couldn't be fetched" (Bonecrusher Giant ELD #115); a DFC still gets both faces (Delver ISD #51). `/import-art` charges `import_art` only after the face AND its image URL resolve ("no back face" / "no image" cost nothing; the placeholder gate still refuses first) and returns the requested face's artist. Per-face artist (`scryfallFaceArtist`, `lib/scryfall/import-mapper.ts`): a multi-face card's front is `card_faces[0].artist ?? card.artist`, its back `card_faces[1].artist ?? card.artist` — Fire // Ice DMR #215 imports David Martin / Franz Vohwinkel, not "David Martin & Franz Vohwinkel" twice; the admin frame-compare render (`buildFrameComparePayload`) picks it up. Fixtures: image_uris captured 2026-09-28 on isd-51, eld-115, dmr-215; tests `tests/unit/scryfall/face-art.test.ts`, `tests/unit/api/scryfall-import-art-route.test.ts`, `tests/unit/components/scryfall-import-back-art.test.tsx`) **1.8 [P1] Back-face art only when the face has `image_uris`** (expose
      `has_back_image` on `/named`), log the quota after URL resolution,
      import the per-face artist — `app/api/scryfall/import-art/route.ts`:134,
      `import-mapper.ts`:346,391.
- [x] (done 2026-09-28 — shipped in feat/import-dialog-printings: every setState in the search effect checks the controller, the `json()` catch and the `finally` included, so an aborted search never shows "Search failed" nor stops the newer search's spinner; the result list's selection (`selectedResultId`) is apart from the shown printing, a printing click keeps the detail mounted under a "Loading printing…" overlay and the grid node (so its scroll); while committing, Cancel / the X are disabled (`DialogContent`'s new `closeDisabled`), Escape and outside clicks are prevented and `onOpenChange` ignores closes — `tests/unit/components/scryfall-import-dialog.test.tsx`, mutation-checked) **1.9 [P2] Dialog state** — stale abort must not render "Search failed"
      (check `signal.aborted`); a printing click keeps the list selection and
      scroll; block Cancel/Escape during commit.
- [ ] **1.10 [P2] Flavour `*…*` markers → italic toggles; rarity `special`/
      `bonus` → the purple special symbol; `frame: "future"` labelled and
      reported as unsupported** (`import-mapper.ts`:80,226,339).
      **Signature registry 2026-09-28:** the `frame: "future"` part is done in 1.4 (signature `future`: `unsupported`, exactLabel "Future Sight frame", nearest M15, `blockedBy` 4.15; FUT / MB2 textless printings resolve through 1.19's textless rule first). The flavour `*…*` italic toggles and the `special`/`bonus` purple rarity need Lane A: a renderer change plus the rarity CHECK constraint.
- [ ] **1.11 [P2] Mana-symbol vocabulary** — `{G/U/P}`-style Phyrexian
      hybrids, `{C/W}`, `{HW}`, `{½}`, `{∞}`, `{CHAOS}`, `{TK}`, `{A}`, `{PW}`,
      `{P}`, `{L}`, `{D}` in the tokenizer and both renderers
      (`components/cards/mana-cost-glyphs.tsx`:66, `lib/pips`,
      `lib/render/card-image.tsx`:884).
      **Card Conjurer audit 2026-09-25:** Take every new symbol (h/half, paw, 100, 1000000, c/p, loyalty-*, ci-*, chaos, planeswalker) from mana-font 1.18, not CC's img/manaSymbols. CC's set is narrower: half.svg is never loaded and there is no {C/P}. {E}, {TK}, {A}, {CHAOS}, {PW} and the inline loyalty icons render as bare glyphs in text ink, with no disc, in both renderers. Print (KLD Aether Hub) has no disc; today {E} sits on the grey colourless disc (`lib/cards/rules-text.ts`:253-257, mana.css `.ms-cost`). Parity test.
      **Needs Lane A (2026-09-28, Phase 1 lane split):** the tokenizer and both renderers draw every one of these symbols, and moving {E} off its disc alters existing bakes — a renderer change with its `CARD_LAYOUT_VERSION` bump and `VERSION_ROLLOUT` policy, so it ships with the render lane, not the import lane.
- [x] (done 2026-09-28 — feat/import-mapper-fixes: card titles to 150 characters — `CARD_TITLE_MAX` (`lib/validation/card.ts`) for the front title and the second face's, mirrored by the card_fill job's pinned title (`app/api/ai/jobs/route.ts`) and the remix's "(remix)" prefill (`lib/creator/revise.ts`); deck, challenge and news titles stay 120. Migration `0122_card_title_150.sql` (merge order, 2026-09-29: main's 0120 is the automatic re-bake (#398), #395's frame preview is 0121 and #400's `frame_requests` 0123, so this PR merges after #395 and before #400 — Supabase applies versions in order) drops and re-adds `cards_title_length` as 1–150 and changes no grants; a test holds the CHECK to the constant. The longest printed name, "Our Market Research Shows That Players Like Really Long Card Names…" (141 characters, **Unhinged** #107 — not Unfinity), imports and validates. `/api/scryfall/named`: an empty parameter is absent (`?id=&exact=Lightning%20Bolt` looks up the name), two non-empty ones are a 400, and `getCardByNameResult` (`lib/scryfall/client.ts`) tells Scryfall's "ambiguous" 404 from a plain 404, a 400 and an upstream failure — "Several cards match “bolt” — type more of the name." (404), "No card named “x”." (404), 400, 502; only a found card is logged. `getCardByName` (card or null) stays for the decklist importer, which now gets null instead of an exception on a network failure. Scryfall's error bodies captured 2026-09-28 in `tests/unit/scryfall/fixtures/named-errors.json`. **Token research 2026-09-29:** Scryfall's `/cards/named?exact=Treasure` answers F17 #11 "Dinosaur // Treasure", a DFC promo, not the Treasure token. 1.23 handles token names; keep this route's contract as it is) **1.12 [P3] Title schema to 150 chars; proxy edge cases** (`?id=&exact=`,
      Scryfall 400 vs ambiguous 404 messages).
- [x] (done 2026-09-28 — feat/rules-text, rides layout v33: `ABILITY_WORDS` refreshed from ONE throttled fetch of Scryfall's `catalog/ability-words` (User-Agent pipglyph-dev-audit), saved as the committed fixture `tests/unit/cards/fixtures/scryfall-ability-words.json` with its date; 48 → 69 words (Eerie, Void, Survival…), "Descend 4" and a curly apostrophe read; a test keeps the list in step with the fixture. On the public cards only two paragraphs change, both now correctly italic: Rodent Crevice's "Disappear —" and Diana, la Chulapa's "Vivid —".) **1.13 [P2] Refresh `ABILITY_WORDS`** (`lib/cards/rules-text.ts`:33) with
      the 2024–2026 words + a test against Scryfall's `catalog/ability-words`.
      **Needs Lane A (2026-09-28, Phase 1 lane split):** `ABILITY_WORDS` italicises rules text in both renderers, so a new word changes existing bakes. Pair it with Lane A's rules-text round (3.29) and a captured `catalog/ability-words` fixture (tests never call Scryfall live).
- [x] (done 2026-09-26 — shipped in feat/import-correctness: the mapping is gone; Bitterblossom, Crib Swap and Kindred Discovery pin it, and no fixture imports the legacy "spell") **1.14 [P2] Kindred stays a supertype word; delete the dead
      `tribal → "spell"` mapping** (`import-mapper.ts`).
- [x] (done 2026-09-28 — shipped in feat/import-art-from-card: "Use art from a real card" beside Choose file in the Identity step's art block (`components/creator/real-card-art-dialog.tsx`, `RealCardArtButton` + `RealCardArtDialog`). A name typeahead on `/api/scryfall/search` (debounced, aborted, the 1.9 stale-search guard; the trimmed result now carries `oracle_id`), the chosen card's printings through 1.5's `PrintingsGrid` + `usePrintings` with the filter chips and no frame-status badges, the chosen printing's crop, set, number and artist, and "Use this art" → POST `/api/scryfall/import-art` {scryfallId, mode} (route unchanged; same `search` + `import_art` quotas). "Front art" / "Back art" (`art-back`) is offered only when the printing `has_back_image` (1.8's `hasBackFaceImage`, the same test as `/named`'s flag); the back art is preselected when the art is for the card's back face, and the chosen-printing panel then shows the back face's own crop and artist (each printing carries `back_thumb_url` / `back_artist`, `lib/scryfall/printing-summary.ts`), and the front art's own credit as `front_artist` — both by 1.8's `scryfallFaceArtist`, the credit import-art writes, so Fire // Ice's front art shows David Martin, not the card-level "David Martin & Franz Vohwinkel". The one write path is `realCardArtWrites` / `applyRealCardArt` (`lib/creator/real-card-art.ts`): the target face's `art_url`, a re-centred `art_position` and its `artist_credit` (the route's `artist`: the requested face's own since 1.8; cleared when Scryfall credits no one, held to 120 chars) — never the title, text, type, frame, colour, `source_scryfall_id` or tags; tests compare the whole form before/after. Targets: the front art block; the second face's art block of a split / aftermath / flip half (`LayoutPanel`); and, for a card with a back face but no second-face editor (an imported transform / modal DFC such as Delver of Secrets, until 5.2), a "Back face art" row in the Art block — the preview turns to the back when its art lands. An import error toasts the route's message and writes nothing; the dialog can't close mid-download; a placeholder scan can't be used. Front art from a printing sets the creator's session-only `importedArtOrigin`, so 1.18's `ImportedArtNote` reads the same as after a full import (the dialog shows it for the chosen printing first). Guests: disabled with "Sign in to use art from real cards." No renderer change. Still open: the optional server-side "Paste an image URL" below, and re-framing a window crop against a full-bleed slot (3b.13)) **1.15 [P2] 'Use art from a real card' in the Art panel** (Card Conjurer audit 2026-09-25) — Today real-card art only arrives with a full Scryfall import that overwrites text, frame and colour (`components/creator/scryfall-import-dialog.tsx`:364-399,841). CC has a separate art-by-name lookup (`creator-23.js`:4138-4185).

      Add a dialog in the Art panel:
      1. Name typeahead.
      2. Printings grid (1.5's list, with thumbnails + artist).
      3. POST `/api/scryfall/import-art` {mode: art | art-back}. The route is already id-only and SSRF-safe.

      It sets only `art_url`, a reset `art_position` and `artist_credit`, never text, frame or colour, and counts against the same Scryfall quota.

      Optional follow-up: a server-side 'Paste an image URL', under the upload allowlist, size limit and moderation. Never a client CORS proxy, which is what CC uses. Depends on 3.14 for orientation.
      **Still open after 2026-09-28:** this paste-URL follow-up (not started — it needs its own server route: host allowlist, size limit, the omni-moderation scan, never a client proxy).
      **Owner decisions 2026-09-29** (owner: "recommendations" on the
      art PR's four questions, feat/import-art-from-card) — all four kept
      as built:
      - **E1 — kept:** the Art block's "Back face art" row stays for a card
        with a back face but no second-face editor (an imported transform
        / modal DFC such as Delver of Secrets). It's the only way to change
        that back's art without importing again; 5.2's two-sided editor
        takes it over.
      - **E2 — kept:** a printing Scryfall credits no artist CLEARS
        `artist_credit` (`realCardArtWrites`), rather than keep the old
        artist's name beside art they didn't draw.
      - **E3 — kept:** the interim `art-back` credit. Until 1.8's per-face
        artist lands in `/api/scryfall/import-art` (feat/import-mapper-fixes,
        `scryfallFaceArtist`), the back of a DFC whose faces have different
        artists is credited to the card-level name; Delver (Nils Hamm on
        both) is unaffected. The client credits whatever the route returns,
        so it follows 1.8 with no change here.
      - **E4 — kept:** the two additive route fields — `oracle_id` on each
        `/api/scryfall/search` result, `back_thumb_url` / `back_artist` on
        each `/api/scryfall/printings` item (null unless the back face has
        its own image). No existing field changes.
      - **After 1.8 landed (restacked onto #399 + main):** the route credits
        the requested face, as E3 expected. The chosen-printing panel now
        previews that same credit for the front art through a third
        additive field, `front_artist` (`scryfallFaceArtist(card, 0)`), so
        a split card such as Fire // Ice shows David Martin, the name the
        import writes. `has_back_image` / the back art use 1.8's
        `hasBackFaceImage`, the same test `/named` uses.
- [x] (done 2026-09-26 — feat/quick-wins: `printingTreatmentFromScryfall` names a borderless / showcase / extended-art / full-art / textless printing (full-art and textless 2015 tokens skipped), the import dialog says so before the import and the creator toasts the frame the card actually landed on, in front of the "Seeded form…" / "Pre-filled…" toast; the frame choice is unchanged. The "Use Borderless" / "Use Full-Art Basic" toast actions moved to 4.32 / 4.39's acceptance. Still silent, for later items: foil-etched frame printings (`frame_effects ∋ etched`, 4.28), white/silver/gold borders (4.30), `frame: future`, Expeditions) **1.16 [P0] Stopgap: say so when a borderless or showcase printing imports as the plain frame** (borderless research 2026-09-25; ships before 1.4) — The importer drops every treatment, so all 6,327 paper borderless printings land silently on the bordered standard:
      - `frameTemplateFromScryfall` (`lib/scryfall/import-mapper.ts`:239-259) maps only `frame`→era plus snow/devoid.
      - `border_color`, `full_art` and `promo_types` pass through untyped (`lib/scryfall/client.ts`:143-210, `.passthrough()`).
      - m15 is verified, so `resolvePublishedFrame` returns `exact` and the creator shows nothing (`components/creator/card-creator-form.tsx`:1092-1118).

      Reproduced with the real mapper: Sheoldred DMU #435 → m15, Festival of Embers BLB #316 → m15, Archangel Elspeth MOM #320 → m15pw, Archway of Innovation MH3 #350 → m15land.

      Until 1.4/1.5 land, read `border_color`, `frame_effects` (`showcase`, `extendedart`) and `promo_types` in the import path and toast "This printing is borderless — PipGlyph used the standard bordered M15 frame." Once 4.32 is verified for that colour and kind, add a "Use Borderless" action to the toast. It is small, and it stops the false "exact" today.

      Acceptance: unit test with Sheoldred DMU #435 (borderless), Clarion Conqueror TDM #400 (black-border showcase) and a plain M15 printing (no toast).
      **Full-art research 2026-09-26:** also toast for non-borderless `full_art || textless` printings. Skip tokens on `frame: 2015`: those 171 already land on `m15token`, which is the right family.
      - Toast: "This printing is full art — PipGlyph used the standard <frame> frame."
      - This closes 1,131 more silent "exact"s (survey `stopgap.txt`).
      - Fixtures: BFZ #250 (→ m15land, toast), ONE #262 (toast), SCH #3 (textless → m15, toast), T2XM #4 (no toast).
      - Once 4.39 is verified for that colour, add a "Use Full-Art Basic" action.
      **Token research 2026-09-29:** "Skip tokens on `frame: 2015`: those 171 already land on `m15token`, which is the right family" is wrong for the M20 design. T2XM #4 and TM20 #2 belong to the full-art family (4.48), not the 2014–19 arch that `m15token` draws. The T2XM #4 fixture changes from "no toast" to a toast. 1.23 removes the exception in `printingTreatmentFromScryfall`.
- [x] (done 2026-09-28 — shipped in feat/import-frame-signatures, in the order below with the full-art amendment. Exact: the dark-box standard → m15borderless / m15borderlessartifact (the import still lands on the bordered frame, 1.18's decision, via `landOn`), BLB woodland, LTR ring, TLA/TLE elemental. An edge-to-edge match (m15borderless, m15borderlessartifact, fullartland) ALWAYS lands on its bordered frame, `full_art` or not: measured 2026-09-28, the `art_crop` of full-art borderless printings is the window too (FRA #382, CMM #702, SPG #119, TLE #1 626×457; MH3 #326 571×460). Nearest: the crown, the nickname line, the Nyx starfield, a vehicle, a colour indicator, a two-colour pinline and the light box (4.37) on the standard family; planeswalkers → m15pw (4.33); nonbasic lands → m15land (4.34); basics → fullartland (FRA #382–396's dark bars; other borderless basics — landing on m15land with 'Use Borderless Full-Art Basic' offered once verified, as 4.39 has it) or m15textlessland (textless); double-faced cards (5.7, checked before the kind so ZNR #284 names it); layout cards (4.38); tokens (4.37); textless non-basics → m15textless (4.35); text on the art (source material, TDM clan, 4.36); the other showcases and set frames (4.11). Posters are unsupported for good; MP2 / UST / BOT unsupported (UST's five textless basics go to the basic rule). **Correction, checked by eye on the scans:** BLB #295–336 is ONE woodland run in WUBRG + gold order (#315 and #316 print the same vine frame; so do #326 and #331), and the anime frame is only the raised-foil legends #343–355 — BLB #316 resolves `exact` bloomburrow, not anime. WOT #64 is the standard frame (confirmed). TLE #305–317 print the TLA elemental frame.) **1.17 [P0] Borderless families in the signature registry (feeds 1.4)** (borderless research 2026-09-25) — 1.1 parses the fields; this item is the borderless half of 1.4's resolver. Every borderless printing is `frame: 2015` (`-frame:2015` returns 0). None is a battle, and none carries `extendedart` (0 each).

      Resolve in this order:
      1. `promo_types ∋ poster` (369; artist-lettered, e.g. SPG #119, LTR #731) → `unsupported` for good. Offer Borderless (4.32) as the nearest.
      2. `promo_types ∋ sourcematerial` (247: MAR/FCA/TLE/PZA) → text-on-art (4.36).
      3. By set: STA/SOA (321, Mystical Archive) and EOS (180, Stellar Sights, no showcase flag) → 4.11. MP2, UST and BOT (`shatteredglass`) → unsupported.
      4. `frame_effects ∋ showcase` (1,131) → a per-set showcase family (4.11). Only collector ranges tell these apart, so pin each range as a fixture with its Scryfall id:
         - BLB woodland #295–315 vs anime #316–336 and #343–355;
         - LTR ring #302–331 and #794–823;
         - TDM clan #327–376 → 4.36.
      5. Otherwise it is the **standard** family (5,196 non-showcase). Route by kind:
         - planeswalker → 4.33;
         - nonbasic land → 4.34;
         - basic → per-set full-art basics (4.11);
         - transform/MDFC → 5.7;
         - saga/adventure/room/class/mutate → 4.38;
         - token → 4.37;
         - everything else → 4.32.

      `inverted` picks the dark box (4,400 of the 5,196). Without it, the light box (4.37) is `nearest`, except planeswalkers, which print light by default (199 of 245). Until their pieces exist, these are `nearest`:
      - `legendary` → floating crown (4.6);
      - `flavor_name` → nickname line (6.3);
      - `enchantment` → Nyx.

      Ignore art-only flags: `portrait`, `concept`, `doubleexposure`, `imagine`, `stepandcompleat`. `full_art` is unreliable, set on FRA/MH3 standard borderless too.

      Fix 1.4's fixture list: BLB anime is not "no effect". BLB #316–336 carry `showcase`+`inverted`, the same flags as woodland, so the collector range decides. TDM ghostfire is not borderless: #399–408 are black-bordered and #409–418 white (4.35, 4.30).

      Fixtures, 2 per family:
      - M21 #315 Grim Tutor and FDN #311 (standard dark);
      - DMU #435 Sheoldred (crown);
      - ELD #271 Oko and WOE #297 Ashiok (planeswalker light/dark);
      - MID #281 Deserted Beach and OTJ #304 Spirebluff Canal (land);
      - IKO #275 Zilortha (flavour name);
      - ZNR #284 Branchloft Pathway (MDFC);
      - TDM #383 (saga);
      - WOE #298 Kellan (adventure);
      - DSK #334 (room);
      - BLB #295 and BLB #316 (showcase ranges);
      - TDM #327 and TLE #1 (text-on-art);
      - SPG #119 (poster);
      - STA #1 and EOS #1;
      - WONE #1 (token);
      - UNF #235 (basic);
      - WOT #64 (anime art with no showcase flag, so standard; confirm by eye).
      **Full-art research 2026-09-26:** step 5's "basic → per-set full-art basics (4.11)" gets one owner per borderless basic:
      - Not textless, with the two-bar layout (FRA #382–396) → `fullartland` (4.39).
      - Textless borderless basics (50: SLD 15, UNF 15, EOE 10, UST 5, ONE #365–369 5) → per-set (4.11), `nearest` `m15textlessland`. After 4.35(a) that frame is borderless and name-only, and its registry already lists EOE.
      - Other borderless basics → `nearest` `fullartland`.

      The fixture UNF #235 now resolves `nearest` `m15textlessland`. Add FRA #382 (`fullartland`). (4.35's reference decision went to FRA, 2026-09-26.)
- [ ] **1.18 [P1] Borderless imports and their art** (borderless research 2026-09-25) — The art import takes Scryfall `art_crop` (`app/api/scryfall/import-art/route.ts`:155). For borderless printings that crop is still cut to the M15 window: 626×457, aspect 1.37 (checked on DMU #435 and FDN #311). Only `full_art` printings get a taller crop (UNF #235: 745×767). Covering 4.32's art area (1500×1937 above the bottom bar) scales the crop 4.24× and keeps 56 % of its width. Scryfall's full-card `png` has the frame printed on it, so it is never usable as art.
      - When an import lands on a borderless treatment, show an inline note on the Art step: "Scryfall only has this art cropped to the classic window — upload the full illustration for a sharp borderless card". Log `art: window-cropped` on the 1.6 request row.
      - The art positioner re-frames the crop against the full-bleed slot (3b.13).
      - **Decided 2026-09-26 (owner: "go with your recommendation")**: a borderless import lands on the bordered M15 frame (the art fits exactly), with Borderless offered in the 1.5 chooser, while 6.10's full-resolution path is missing; it may land on Borderless once the user uploads their own art. (The alternative was Borderless with the window-cropped art and a note.)
      **Full-art research 2026-09-26:** full-art printings get a taller `art_crop`, aspect 0.77–0.97. Sizes: ZEN 566×704; BFZ, ZNR and PRM 625×682; NEO and ONE 626×747; UST and UNF 745×767; P07/P08 619×808 (`today/artcrop-sizes.txt`, `survey/artcrop/sizes.json`).
      - **The crop still stops at the printed bars,** and it often contains printed frame pieces:
        - the type bar (PRM #68039; UNF #277, with its rules);
        - NEO's kanji banner;
        - SLD #1417's cost pips;
        - corner wedges (BFZ, ZNR, FUT, P08, TZEN).
      - **The effect.** A full-art import on the M15 window prints a second type line inside the art (bake I, Llanowar Elves).
      - **Window-shaped crops.** Other full-art printings still get the 626×457 window (SCH #3, MID #268, DSK #389, SLZ #46). Covering a 1500×2100 slot scales the tall crops about 2.6–3.2× and the window crops about 4.6×.
      - **What to do.** Show the Art-step note with "…and includes parts of the printed frame", and log `art: frame-in-crop` on the 1.6 row.
      - **Decided 2026-09-26 (owner approved the full-art recommendations)**: warn only (the alternative was auto-trimming by a per-family inset table, which is heuristic and wrong on one-offs).
      **Status 2026-09-28 (feat/import-dialog-printings):** the UI half shipped. The import dialog's chooser (1.5) preselects the bordered frame with "Scryfall's art for this printing is cropped to the bordered window" and offers Borderless (m15borderless / m15borderlessartifact / fullartland) when verified in the card's colour. The Identity step's art block shows `ImportedArtNote` (`components/creator/import/imported-art-note.tsx`, reusable by 1.15) while the imported art is still the card's art: (a) on a frame whose art reaches the edge, "Scryfall only has this art cropped to the classic window — upload the full illustration for a sharp borderless card"; (b) for a full-art or textless printing, "…includes parts of the printed frame" (warn only); both at once, "…cropped to the printed frame, and it includes parts of that frame…" (the copy kept by the owner 2026-09-29, C4). The creator keeps session-only `importedArtOrigin` {artUrl, borderless, fullArt, textless}. Still open: logging `art: window-cropped` / `art: frame-in-crop` on the 1.6 request row (the requests PR); re-framing the crop against the full-bleed slot (3b.13).
      **Request log 2026-09-28 (1.6):** the art flags are logged — an import that brings its art writes `art_flag` on its frame request row: 'frame-in-crop' for a full-art (`full_art` or the `fullart` effect) or textless printing, bordered or not, else 'window-cropped' for a borderless one (`artFlagForImport`, `lib/frames/frame-requests.ts`); /admin/frame-requests shows them per row. With the dialog PR's UI half (above) merged too, only 3b.13's positioner is still open.
- [x] (done 2026-09-28 — shipped in feat/import-frame-signatures, in the order below: substitute cards rejected (`reject`); SLZ and black posters unsupported for good, nearest M15; the Japan showcase nearest M15 (white run: 4.30 too); 1997/2003 tokens nearest m15token, 2015 full-art tokens exact; full-art basics by border, set list and design, never by `full_art` alone — FDN #282 / HOB #194 exact m15fullartland, ONE / MOM nearest (the 4.39 amendment), split bar (4.40, incl. ZEN / J14 on the 2003 frame), plain bar (4.41), coloured borders (4.30), per-set designs (4.11) and SLD black basics nearest m15fullartland; textless non-basics nearest m15textless / m15textlessland (4.42, 4.43), the TRK LCARS lands unsupported; any other bordered full-art printing nearest M15, "full-art one-off"; the look-alikes by set + range: ZNR #290–313 → fullart, ZNE / EXP → expeditionland (never by set_type alone: MUL, STA, EOS, WOT and SPG are `masterpiece` too). **Landing change:** a black-bordered (or yellow/white-bordered) full-art basic now lands on m15fullartland once that combo is verified (it landed on m15land, with a "Use Full-Art Basic" offer for the 2022 design only; their `art_crop` is the taller full-art crop) — kept by the owner 2026-09-29 (A2). A 2003-frame textless promo (P07 #1) names the 2003 frame (modern) as its nearest until m15textless is verified in its colour, then m15textless (owner decision A9 2026-09-29, `onceVerified`: it lands on modern/w as before the registry); Future Sight textless printings keep m15textless (`textless/future`). **Token research 2026-09-29:** 1.23 replaces two lines here: step 4's "`frame: 2015` → `m15token`, already exact (171 printings, e.g. T2XM #4 Cat)" and the Scale list's "only the tokens (T2XM #4, TZEN #3) → `m15token`". The new rule: released 2019-07-12 or later → 4.48; earlier → 4.49. The T2XM #4 fixture resolves to 4.48 (`nearest` `m15token` until 4.48 is verified). #396 (merged 2026-09-29) shipped step 4 as "2015 full-art tokens exact" and closed this item; 1.23 corrects that) **1.19 [P0] Full-art and textless families in the signature registry (feeds 1.4; runs after 1.17)** (full-art research 2026-09-26) — 1.17 resolves `border_color: borderless`. This item is the same resolver for every other printing Scryfall flags `full_art` or `textless`.

      **Scale.** 1,449 paper full-art printings are not borderless. 1,302 of them would still import as the bordered standard with a false "exact" after 1.16 as written (survey `stopgap.txt`; the 1.16 amendment above closes this). Run through the real mapper (`lib/scryfall/import-mapper.ts`:237-259; `today/resolve-results.txt`, `survey/mapper/mapper-results.txt`), today:
      - BFZ #250, ZNR #266, NEO #293 and ONE #262 → `m15land`; (2026-09-26: ONE / MOM print an older bar geometry than `m15fullartland`'s master — `nearest`; FDN #282 is the `exact` fixture, see 4.39)
      - SCH #3, FUT #19 and PRM #68039 → `m15`;
      - P07 #1 → `modern`;
      - only the tokens (T2XM #4, TZEN #3) → `m15token`.

      **What not to key on.** Never `full_art` or the `fullart` frame effect alone:
      - The effect is on only 109 printings, and inconsistently: ZNR #266 has it, ZNR #274 (same design) does not.
      - `full_art` is false on every ZNR showcase, ZNE and EXP printing (0 of 24, 30 and 45), and true on 129 standard borderless printings (1.17).
      - SLZ says `border_color: black`, although it is frameless.

      Resolve in this order:
      1. **Substitute cards.** `type_line == "Card"` (57, sets SZNR…SLCI) → reject as "not a playable card".
      2. **Unsupported for good; nearest `m15`.**
         - `set: slz`: The Zeta Set, 363 frameless MSCHF typeset cards (checked by eye).
         - `promo_types ∋ poster` on a black border: 6 printings (survey).
      3. **Japan showcase.** `promo_types ∋ japanshowcase` (62 black, 45 white) → 4.36's text-on-art inside a ring, with the white run via 4.30. `nearest` `m15` until then.
      4. **Tokens.**
         - `frame: 2015` → `m15token`, already exact (171 printings, e.g. T2XM #4 Cat).
         - `frame: 2003/1997` (80, e.g. TLRW #3) → 4.43; `nearest` `m15token` until then.
      5. **Basic lands** (575 black, 10 yellow, 1 white; the 89 borderless are 1.17's, amended above):
         - Yellow or white border → 4.39's bars plus 4.30's border (DFT #507–516, MB2 #121).
         - Per-set designs → 4.11, `nearest` 4.39: UGL, UNH, UND, black UNF #486–490, NEO, LCI, `frame: 1997` (SLD #1652–1656), PLST UGL-84 / UNH-139.
         - Split bar with a centred medallion (checked by eye on SNC #272, MH1 #250, MID #268, AKH #250, ZNR #266 and BRO #278) → 4.40. Sets: BFZ, OGW, AKH, HOU, MH1, ZNR (stone ring); SNC, BRO (plain ring); MID, VOW (dark bars). ZEN and J14 are the same design on the 2003 frame (→ 4.43).
         - Plain bar, no symbol → 4.41: THB, 2XM, DMU, SPM, SOS, PLG25.
         - Left medallion → 4.39 `m15fullartland`, for the set list in 4.39. Pin by set list, never by date: SPM and SOS (2025–26) print the plain bar (checked by eye).
         - SLD black (112, mixed drops) → pin collector ranges as drops get checked; `nearest` 4.39 by default.
      6. **`textless` non-basics.**
         - `frame: 2015` → 4.42 (37 printings), except the TRK LCARS lands #392–401 and #487–496 (20) → unsupported, a per-set design (P3).
         - `frame: 2003` (58: Player Rewards P05–P11 + PLST) and `frame: future` (9: FUT, MB2) → 4.43.
      7. **Any other bordered full-art printing** (SLD #364–368 and #2350–2353, UNH #120) → `nearest` `m15`, reason "full-art one-off".

      Two look-alikes 1.4 must never send to a full-art template:
      - the ZNR showcase (`frame_effects ∋ showcase`, set znr, pinned collector ranges) → `fullart`;
      - `set_type: masterpiece` ZNE/EXP → `expeditionland`.

      Fixtures, 2 per family:
      - ONE #262 · HOB #194 (4.39); FRA #382 (`fullartland`, reached via 1.17);
      - BFZ #250 · ZNR #269 (4.40);
      - THB #250 · SPM #189 (4.41);
      - DFT #507 (yellow);
      - NEO #293 · LCI #287 (per-set);
      - SCH #3 · PF19 #1 (4.42);
      - P07 #1 · FUT #19 (4.43);
      - T2XM #4 · TLRW #3 (tokens);
      - SLZ #46 and one SZNR card (unsupported / reject);
      - DSK #389 (Japan showcase);
      - ZNR #293 Makindi Ox (showcase, not full art) · ZNE #1 (Expedition).
- [ ] **1.20 [P1] Print the type line in its printed order; P/T on a land creature** (import-correctness review 2026-09-26) — 1.3 keeps every type word, in `supertype`, but `buildTypeLine` (`lib/cards/card-display.ts`:157) prints the supertype BEFORE the card type. A line whose card type isn't its last word reads another order. New imports only (stored cards never had the words):
      - Dryad Arbor: "Creature Land — Forest Dryad" (printed "Land Creature");
      - tokens: "Creature Token — Goblin", "Artifact Token — Treasure" (printed "Token Creature", "Token Artifact"; before 1.3 the words were dropped: "Token — Goblin");
      - Urza's Saga MH2 #259: "Land Enchantment — Urza's Saga" (printed "Enchantment Land");
      - Summon: Bahamut FIN #1: "Creature Enchantment — Saga Dragon" (printed "Enchantment Creature");
      - Bident of Thassa THS #42: "Legendary Artifact Enchantment" (printed "Legendary Enchantment Artifact").

      `showsPowerToughness` (`card-display.ts`:49) is false for card type land, so Dryad Arbor loses its 1/1. Fix both in the renderers — for example store where the card type sits among the type words, or print Token / a layout kind's card type first — plus P/T when the supertype says Creature. A renderer change: `CARD_LAYOUT_VERSION` bump + a `VERSION_ROLLOUT` policy (owner's call). Fixtures: all five are in `tests/unit/scryfall/fixtures/import-printings.json` (dsc-273, tmsh-27, mh2-259, fin-1, ths-42).
      **Needs Lane A (2026-09-28, Phase 1 lane split):** `buildTypeLine`'s word order and `showsPowerToughness` are renderer paths (`lib/cards/card-display.ts`, read by both renderers), so the fix needs a `CARD_LAYOUT_VERSION` bump and a `VERSION_ROLLOUT` policy — the render lane's. The import side is done: it already keeps every word, in printed order, in `supertype` (1.3), and since 1.21 a layout kind keeps its printed card type too.
      **Token research 2026-09-29:** the token half ("Token" first) moves to 3b.15 and ships with it as its own card-scoped sweep. Dryad Arbor, Urza's Saga, Bident and Summon: Bahamut stay here.
- [x] (done 2026-09-28 — feat/import-mapper-fixes: `LAYOUT_KIND_CARD_TYPES` + `importedCardTypeForKind` (`lib/creator/card-kinds.ts`), decided from the profiles and the masters: adventure → creature, enchantment, artifact, land, instant, sorcery (its master paints no P/T box — the plate is M15's overlay, drawn only for a P/T type — and it has no loyalty/defense slot; Scryfall prints 8 enchantment, 8 artifact, 5 FIN Town land and 1 sorcery adventurers, captured 2026-09-28); flip → creature, enchantment, token (WOE's Role tokens are "Token Enchantment" flips); saga → enchantment; split / aftermath → instant, sorcery. The import applies the kind with that card type (`applyKindProgrammatic(kind, cardType)` in `handleScryfallImport`), so the P/T / loyalty gating and the default watermark follow it; the kind is unchanged (the layout template decides it) and the save's kind gate accepts it. Virtue of Loyalty WOE #38 → Adventure, Enchantment; Commit // Memory AKH #211 → Aftermath, Instant; Beck // Call DGM #123 → Split, Sorcery (fixtures captured 2026-09-28). The adventure frame CAN draw a non-creature, so Virtue is an Enchantment. Tests: `tests/unit/creator/layout-kind-card-types.test.ts` (the table held to the profiles' stat slots), the form through the deck-remix prefill in `tests/unit/components/creator-form-reliability.test.tsx`. Not changed: the order the renderers print the words in (1.20, Lane A)) **1.21 [P2] A layout kind keeps the printed card type** (import-correctness review 2026-09-26) — the creator writes the layout kind's card type (`applyKindProgrammatic`, `KIND_DEFS[kind].cardType`) and never the patch's, although the mapper reads the right one (`parseTypeLine` with the kind's card type preferred). Wrong since before 1.3:
      - Virtue of Loyalty WOE #38 ("Enchantment // Instant — Adventure") imports as a Creature;
      - Commit // Memory AKH #211 (front "Instant") imports as a Sorcery;
      - a sorcery split card (Beck // Call DGM #123) imports as an Instant.

      Decide which card types each layout template can draw (the adventure frame's P/T box, the aftermath halves), write `patch.card_type` after the kind when the template can draw it, and add the three fixtures.
      **Owner decisions 2026-09-29 (Lane-B answers B1, B2 — "recommendations"):** B1 — keep the WIDE adventure table as built (creature, enchantment, artifact, land, instant, sorcery: the adventure master paints no P/T box, and Scryfall prints 8 enchantment, 8 artifact, 5 Town land and 1 sorcery adventurers). B2 — flip keeps `token` (WOE's "Token Enchantment — Aura Role" flips import as tokens). No code change. **Token research 2026-09-29:** for Roles, 1.23 replaces this landing (front Role only, logged `unsupported`; owner-confirmed).
- [x] (done 2026-09-28 — feat/import-mapper-fixes: `remixFrameFor(patch, verifiedKeys)` (`lib/creator/frame-resolve.ts`, pure) and `scryfallRemixMechanics` (`lib/ai/remix-mechanics.ts`), which `executeDeckRemixStep` calls with `new Set(await getVerifiedFrameKeys())` for Scryfall-sourced entries, passing the template and card type to `createCardAction`. A standard kind resolves like the import (`resolveImportFrame`, the kind's M15 standard as the fallback): Juggernaut LEA #255 → m15artifact/c, Seat of the Synod MRD #283 → m15land/u, Command Tower C13 #281 → m15land/m on production's verified frames, and agclassic/c, modernland/u, modernland/m once those are verified. A layout kind lands on its layout template with 1.21's card type and its second half as `back_face` (the adventure's page, the split / aftermath / flip half — the text, never the printing's artist); while the layout template is unpublished in the colour (adventure, split, aftermath and flip are unverified on production) it prints on its card type's standard frame, as the creator import does, and never becomes double-faced there (Bonecrusher Giant → m15 creature, as before). Nothing published in the colour → the step fails with "No published frame for this card's colour yet." before any art is generated (never a colour switch — including the resolver's last resort, a fallback frame published only in ANOTHER colour, which it reports as "frame-switched"). Tests: `tests/unit/ai/remix-mechanics.test.ts`, each landing checked against the save's frame and kind gates; `tests/unit/ai/deck-remix-step-frame.test.ts` drives a deck_remix step through `runNextJobStep` and pins what reaches `createCardAction` (template, card type, second half) and that an unpublished colour fails before the identity, the art and the save. Follow-up: the remix doesn't log a `frame_requests` row (1.6) for its nearest/substituted frames) **1.22 [P2] The AI deck remix resolves its frame like the creator import** (import-correctness review 2026-09-26) — `executeDeckRemixStep` (`lib/ai/generation-jobs.ts`) passes `patch.frame_template` straight to `createCardAction`, never through the published-frame fallback. A remixed deck entry pinned to an old-border printing fails `frameGateError`, and the step fails: Juggernaut LEA → agclassic/c, Seat of the Synod MRD → modernland/u, Command Tower C13 → modernland/m (the same on 88003bd). Resolve it with `resolveImportFrame` (`lib/creator/frame-resolve.ts`) and `getVerifiedFrameKeys()`, falling back to the kind's M15 standard, and test the three.
      **Owner decisions 2026-09-29 (Lane-B answers B3, B4 — "recommendations"):**
      - **B3 — CHANGED, done on the same branch:** an AI deck remix of a two-part layout card renames BOTH halves, and the two names read as one card. It used to name the front only, so Bonecrusher Giant // Stomp became "<new name> // Stomp". The identity call (`generateRemixIdentity`, `lib/ai/remix.ts`) is still ONE model call; for a remix that carries a second half (`scryfallRemixMechanics` sets `back_face` only on a landed adventure / split / aftermath / flip frame) its schema also requires `second_title` and `second_flavor_text`, and its prompt adds the layout's relationship (`SECOND_HALF_RELATIONSHIP`: an adventure is the subject's deed, a split card a matched pair, an aftermath what follows, a flip the same being's new form), bans reusing either original name, its proper nouns or a keyword, and lists the original names (with a legendary's own name, "Dokai") as reserved. A one-faced card sends the request it always sent (pinned by a test). `applyRemixNames` (`lib/ai/remix-names.ts`, pure) writes the names: the rules text of both halves follows both renames ("Stomp deals 2 damage" → "<new> deals 2 damage"; a legendary's short name too — the part before the comma, or a legendary "X the Y"'s X via `shortNameOf`: Goka the Unjust's oracle reads "Goka deals 4 damage", Jaraku the Interloper's "Remove a ki counter from Jaraku"; a one-word name that is also a rules word, like Exile, is left alone), the half's flavour is the AI's only where the printing's half had flavour, and a missing second name, or EITHER new name keeping EITHER original name or a legendary's own name (`reusesSourceName` over the same list the prompt reserves: "Kuon's Echo" after Kuon, Ogre Ascendant // Kuon's Essence, a swapped "Ice // Fire"), fails the step BEFORE the art — the credit wrapper refunds it, as for any failed step. The guard is two-part only; a one-faced remix is named as before. The step label reads "<front> // <back>". **One-faced remixes change too:** their rules text now follows the new name wherever the oracle still names the card — spells and legendaries ("Lightning Bolt deals 3 damage to any target." → "<new name> deals 3 damage…", "Whenever Ragavan deals combat damage…"). A non-legendary permanent's current oracle says "this creature" (Juggernaut LEA: "This creature attacks each combat if able."), so it has nothing to rename. Credits, settlement and the number of AI calls are unchanged. A live dry run of the identity call (2026-09-28, no DB) named Bonecrusher Giant // Stomp → "Ragewing Colossus // Thunderous Charge", Fire // Ice → "Ember // Frost", Commit // Memory → "Erase // Begin Anew", Budoka Gardener // Dokai, Weaver of Life → "Keeper of the Grove // Verdant Sage, Life's Channel" (an earlier prompt kept "Dokai" and named a half "Trample" — hence the reserved list and the guard; the dry run's rules text was hand-written in the pre-2024 wording, so its renamed fronts show a rename the current oracle — "this creature" — doesn't need). Tests: `tests/unit/ai/remix-names.test.ts`, `tests/unit/ai/remix-identity.test.ts`, `tests/unit/ai/deck-remix-step-frame.test.ts`. Not covered: a remix of the user's OWN two-part card (`entry.card_id`) still copies neither its frame nor its second half (it prints one-faced on its type's default frame), so it has one name — a follow-up with its own frame-gate question.
      - **B4 — kept as built:** the dev DB and every preview branch mirror production's verified frames, where adventure, split, aftermath and flip are unverified, so on a preview a layout card (import or remix) lands on M15 with its printed type; the layout frame appears only where it is verified. B3's two-part naming therefore can't be seen on a preview until one of those frames is verified there; the unit tests cover it.
- [ ] **1.23 [P1] Token and emblem imports: find them by name, land on the right design and kind** (token research 2026-09-29; owner request; owner decisions 2026-09-29; **partly done 2026-09-29 — feat/import-tokens**, see "Done" and "Remains" at the end of this item) — Checked against the mapper at `fab0437`, PR #396 (`feat/import-frame-signatures`, 1.4/1.17/1.19; merged 2026-09-29, re-checked on `2d488b5`) and Scryfall (2026-09-28/29):
      - **Since #396, every 2015-frame token resolves `exact` on the arch frame.** The registry (`lib/scryfall/frame-signatures.ts`, rule `era/2015`, family `m15` → `m15token` / `m15tokenartifact`) resolves every `frame: 2015` token `exact`, so an M20-design token (TM20 #2, T2XM #4: every token since 2019-07-12) is called exact on a design it isn't, and #396 closed 1.19 with "2015 full-art tokens exact". This item changes in that registry:
        - a `token/m20` rule before `era/2015`: `released_at` ≥ 2019-07-12 (a `plst` reprint by its prefix, below) → `nearest` `m15token`, `blockedBy` 4.48, and 4.48's templates via `onceVerified` once they are verified;
        - the `nyx` gap on the token kind names 4.51, not 4.7 (`m15nyx` is a non-token frame); `crown` and `two-colour` already name 4.6;
        - `no-card-type` stops catching `layout: emblem` (the emblem rules below replace its `unsupported`);
        - the allowlist row `m15token/c#0` in `tests/unit/cards/frame-reference-signatures.test.ts` says "re-verify against Cadet TFRA #1", as 1.4's owner step A6 did until this research corrected it. TFRA #1 is an M20-design print (Reality Fracture, 2026-10-02), not the see-through arch `c` that `m15token` draws. The target is TBFZ #1 Eldrazi (4.49's pins): change the row's text, and 4.49's re-pin moves Cadet off `m15token/c`.
      - **Search can't find a token or an emblem by name.** `searchCards` (`lib/scryfall/client.ts`, `unique: cards`, `order: name`) sends no `include_extras`: `!"Treasure"` and "Kaito Cunning Infiltrator Emblem" find nothing, `t:token !"Treasure"` finds 5, and the printings lookup by `oracleid:` does return them (TFDN #24). Don't send `include_extras` on every query. Measured 2026-09-29, it puts 4, 6 and 7 extras (tokens, an art card, a `front_card`, a vanguard) into the first 12 typeahead results for "Soldier", "Treasure" and "Angel". With it, `!"Treasure"` returns F17 #11 "Dinosaur // Treasure" (a DFC promo) first and FJ22 #36 (`front_card`) fifth; its only single-faced Treasure token is TFRA #15. Instead:
        - send it only from a "Tokens & emblems" scope in the import dialog, or as a second request when the plain query finds nothing;
        - drop the `art_series`, `front_card`, `planar`, `scheme` and `vanguard` layouts and the DFC promo tokens (F17, F18) from those results;
        - let 1.5's printings list (#399) pick the printing;
        - `/api/scryfall/named?exact=Treasure` also answers F17 #11 Dinosaur // Treasure: pick tokens through the search and the printings list, and keep that route's contract as #397 left it (1.12).
      - **An emblem import keeps the previous kind.** "Emblem" is neither a card type nor in `KNOWN_SUPERTYPES` (`lib/scryfall/import-mapper.ts`), so `kindFromScryfall` returns undefined and the form keeps its kind (a Creature titled "Kaito, Cunning Infiltrator Emblem"); since #396 the registry answers `unsupported` (`no-card-type`, nearest `m15`). Map `layout: emblem` (140 of the 141 printings) to the emblem kind (6.23):
        - title = Scryfall's name minus the trailing " Emblem";
        - keep a subtype only where the printing prints one: `frame: 2015` released before 2019-07-12 (M15 → MH1, "Emblem — Ajani"), set `tafr` ("Emblem — Ellywick"), or a `plst` reprint whose collector prefix names a pre-M20 set. Checked by eye 2026-09-29: plst TSOI-18 and TORI-12/13/14 print "Emblem — X", while TSTX-8 and TKHM-21 print "Emblem". Scryfall's `type_line` is Oracle, not print: TFDN #25 Vivien Reid prints "Emblem", but Scryfall says "Emblem — Vivien";
        - the M20 design → `exact` `emblem` (4.52) once verified. The 2014–19 look (the same date / `plst` rule) → `nearest` `emblem` (4.52's P3 variant). The 13 `frame: 2003` emblems (TDKA #3, TM13 #11, TTHS #11 …) → `nearest` `emblem`, `blockedBy` 4.43;
        - one-offs → `unsupported`, logged (1.6): TLTR #H13 The Ring (`double_faced_token`), TACR #7, TFIN #24 and WFIN #1 (full bleed), MB2 #513 (playtest).
      - **Token designs, by printing** (replaces 1.19 step 4). `frame: 2015` covers two designs, and `full_art` can't split them: Scryfall sets it on 57 of the 58 vanilla tokens from M20's first year, but on only 4 token printings in all of 2024.
        1. `released_at` ≥ 2019-07-12 (M20 on) → the full-art family (4.48). A `plst` reprint follows its collector prefix's set: pin the 11 pre-M20 prefix sets seen in `plst` (TAKH, TBNG, TC17, TGRN, TISD, TNPH, TORI, TSHM, TSOI, TUMA, TXLN; 22 of its 71 token and emblem printings), held by a test against a Scryfall fixture. Height follows 4.48's rule (Scryfall has no field for it). Use the artifact templates (4.50) when the type line says Artifact, and Nyx per 4.51.
        2. Earlier `frame: 2015` (M15 2014-07-18 → MH1 2019-05-30) → the 2014–19 frame (4.49): `m15token`, `m15tokentext` when the printing has rules text, and the artifact versions for Artifact.
        3. `frame: 1997/2003` (303 printings) → `nearest` `m15token` until 4.10 / 4.43. 1.4's `token/old-frame` rule (#396) already does this.
        4. `border_color: borderless` (19: WONE, WMOM, SLD) → 4.37, `nearest` 4.48 textless (#396 names `m15token`). Silver (11 on the 2015 frame) and white (4) → `nearest`, plus 4.30.
        5. `layout: double_faced_token` (41, e.g. TMOM #16 Incubator // Phyrexian) → the front face, with a toast until 5.5. `layout: flip` Roles (6: TWOE #15–17, TWOC #1–2, plst TWOE-17) → the front Role only, logged `unsupported` (1.6). **Owner 2026-09-29:** Roles stay unsupported and no two-Role layout is planned (4.51). This replaces what main does with them since #397: 1.21's flip table keeps `token` (B2), so a Role imports on the flip kind today. **Owner 2026-09-29: confirmed — for Roles this overrides B2's flip landing; other flip cards keep B2.**
        6. Two colours (a gradient on M20+ prints) and Legendary (a floating crown) → `nearest` until 4.6 (#396's gaps).
      - **Type words.** "Token Creature — Soldier" keeps `card_type` token with "Creature" in `supertype` (1.3). 3b.15's picker reads the same words, so an import lights the right toggles.
      - **Copy tokens.** 38 printings are named "Copy", with the type line "Token", no P/T, colourless, in the M20 design (T2XM #31, 2020 → TMSC #1 / #17, 2026). TFDN #26 prints the italic line "This token can be used to represent a copy of something else." They import as the token kind with no type words (owner 2026-09-29: a token may have no type toggle on, 3b.15), on 4.48's `c` with the regular box.
      - **Other token types** → `nearest` on the token kind, logged (1.6):
        - "Token Planeswalker — Jace" (TFRA #5, loyalty abilities; Reality Fracture, 2026-10-02);
        - "Token Land" (TDSK #16, TECL #11);
        - "Token Land Creature" (TBRO #3, TM3C #19, TFRA #9).
      - **The toast exception goes.** `printingTreatmentFromScryfall` skips full-art and textless 2015 tokens because they "land on `m15token`, which is that family's own frame" (`import-mapper.ts`:420-445 at `2d488b5`; #396 and #397 kept it, and the open #399–#401 don't touch it). That is wrong for the M20+ prints (T2XM #4, TM20 #2): until 4.48 is verified, they toast like any other `nearest`.
      - **Fixtures:**
        - tokens: TDOM #3 (2014–19 textless) · TDOM #2 (2014–19 text box) · TXLN #7 (2014–19 artifact) · TM20 #2 and T2XM #4 (M20 textless, no longer `exact` on `m15token`) · TFDN #27 (regular box) · TLCI #17 and TBLB #5 (tall) · TFDN #23 (colourless artifact) · TDSK #7 (coloured artifact) · TDSK #4 (Nyx, pinned) · TKHM #1 (plain colourless enchantment) · TFDN #26 (Copy) · TMKM #13 (legendary, `nearest`) · TMKM #10 (two colours, `nearest`) · TMOM #16 (DFC) · TWOE #15 (Role) · TFRA #5 (token planeswalker) · TLRW #3 (2003 token, `nearest`);
        - emblems: TFDN #24 ("Emblem"), TFDN #25 ("Emblem", Oracle "— Vivien"), TAFR #16 ("Emblem — Ellywick"), TM15 #13 ("Emblem — Ajani"), plst TORI-14 ("Emblem — Chandra", 2014–19 look), plst TSTX-8 ("Emblem"), TDKA #3 (2003 emblem, `nearest`).
      - **Depends on:** the search half ships alone (with 3b.15). The design rules build on 1.4's registry (#396, merged 2026-09-29) and need 4.48–4.52 for `exact`. The emblem half needs 6.23.
      - **Done 2026-09-29 (feat/import-tokens, Lane B — no stored image changes, no layout bump):**
        - **Search.** `lib/scryfall/search-scope.ts`: a "Tokens & emblems" chip beside "Cards" in the import dialog sends `scope=tokens` to `/api/scryfall/search`, which asks Scryfall `(<query>) (t:token OR t:emblem)` with `include_extras`; the Cards scope sends a plain query with `fallback=tokens` and, only on Scryfall's 404 "no matches" (never on a 429/5xx), the route asks once more in the tokens scope — the answer's `scope` says which, and the dialog says "No cards matched — these are tokens and emblems." Only the import dialog asks for the fallback: the route's other callers (the "Use art from a real card" dialog, the admin frame-reference picker) send no `fallback` and search once, as before (feat/import-tokens-final). Each upstream search counts against the quota (admins exempt, as before). `searchCardsWithOutcome` (`lib/scryfall/client.ts`) drops `art_series`, `front_card`, `planar`, `scheme` and `vanguard` and the F17/F18 double-faced promos before the limit: `!"Treasure"` (captured) answers TFRA #15 alone instead of F17 #11 first. Token rows show the type line and P/T, not the rarity. `/api/scryfall/named` is unchanged (its `exact=Treasure` still answers F17 #11; the dialog loads by id).
        - **Registry** (`lib/scryfall/frame-signatures.ts`): `isM20DesignPrinting` (released ≥ 2019-07-12; a `plst` reprint by its collector prefix, `PLST_PRE_M20_PREFIX_SETS` = the 11 sets, held by `tests/unit/scryfall/fixtures/plst-token-prefixes.json`); rules `token/role` (unsupported, front Role), `token/other-type` (Token Planeswalker / Land / Land Creature, nearest, logged) and `token/m20` (nearest `m15token` / `m15tokenartifact`, `blockedBy` 4.48) with gaps `nyx-dress` (4.51; `enchantment` effect or the pinned TDSK #4 / TDSK #10 / SLD #1835), `border` (4.30), `crown` and `two-colour` (4.6). A gap on a nearest base keeps the base's reason and records no `gaps`, so the chooser always asks (C1 only skips it on the printing's own frame). The 2014–19 tokens stay `era/2015` exact; their Nyx gap is `era/2015+nyx-dress` (4.51); `nyx` (4.7) no longer matches a token. `onceVerified` is NOT set yet: 4.48's templates don't exist.
        - **Mapper** (`lib/scryfall/import-mapper.ts`): a Role card (`layout: flip`, Token type line) is the token kind, front Role only; a `double_faced_token` imports its front face (`dropped_face`, no `back_face`, no back-art request); the dialog's detail pane and the creator's toast say which face came in (`droppedFaceNotice`). Copy tokens import as the token kind with no type words; "Token Creature — Soldier" keeps "Creature" in `supertype`. The 2015-token toast exception in `printingTreatmentFromScryfall` now covers only the 2014–19 design: T2XM #4 / TM20 #2 are named "Full art" like any nearest.
        - **Fixtures + tests:** `tests/unit/scryfall/fixtures/token-printings.json` (the list above, emblems included, plus TDOM #11, TFDN #6, T2XM #31, TC15 #23, TEOC #13, TDSK #10/#16, TBRO #3, TWOC #1, plst TXLN-10/TKHM-19/TWOE-17, TFRA #15, F17 #11, FJ22 #36), `token-search.json`, `plst-token-prefixes.json`; `tests/unit/scryfall/token-imports.test.ts`, `token-search.test.ts`, `tests/unit/components/scryfall-import-tokens.test.tsx`, the route's scope/fallback tests, and the e2e "the Tokens & emblems scope finds a Treasure token and imports it" (mocked routes).
      - **Remains:**
        - **4.48:** name its templates through `onceVerified` on `token/m20` and make the rule `exact` (its gaps then say what's missing, and C1 applies); pick the height (textless / regular / tall) by 4.48's rule; move the M20+ references off `m15token` (4.49's re-pin). **Built 2026-09-29** (`feat/fullart-tokens`): the `m20` family (height by `tokenHeightForText`, the artifact template for an Artifact) through `onceVerified` + `exactOnceVerified` (`FrameMatch.onceVerifiedMatch`, applied by `withVerification`): exact once verified in the colour, the gaps' own nearest otherwise; TM20 #2 / T2XM #4 / TFDN #6 → `m20token`, TFDN #27 / TFDN #26 / T2XM #31 / TKHM #1 → `m20tokentext`, TBLB #5 → `m20tokentall`, TFDN #23 / TFRA #15 / plst TKHM-19 / TMOM #16 → `m20tokenartifacttext`, TLCI #17 → `m20tokenartifacttall`, TDSK #7 → `m20tokenartifact` (`token-imports.test.ts`).
        - **4.49:** `m15tokentext` for a 2014–19 token with rules text (TDOM #2 is `exact` on `m15token` until then); re-pin the token references and fix the `m15token/c#0` allowlist row's text (TBFZ #1 Eldrazi, not Cadet TFRA #1 — left to the token re-pin track). **Built 2026-09-29** (`feat/token-v34` + `feat/token-textbox-final`, merged with this item's rules): TDOM #2 / TXLN #7 / plst TXLN-10 → `exact` `m15tokentext` / `m15tokenartifacttext` (nearest "not yet verified" until ticked, landing on the textless dress meanwhile); the family pick also names the text-box arch as the nearest of an M20+ token, a Role or another token type that prints text (TFDN #27, TBLB #5, TFDN #26 Copy, TMKM #13 …); the 21 tall-box arch printings are the `tall-box` gap (4.55 since round 10; it was 4.49 (b)'s).
        - **4.50 / 4.51:** the artifact templates of the M20 family; the Nyx dress (the `nyx-dress` gap names it; the pinned list lives in `NYX_TOKEN_PINS`).
        - **6.23 (+ 4.52):** every emblem bullet — `layout: emblem` → the emblem kind, the title without " Emblem", the printed subtype rule, the M20 / 2014–19 / 2003 emblem answers, the one-offs; `no-card-type` still answers emblems `unsupported` (nearest M15) and an emblem import keeps the previous kind until then.
        - **3b.15:** the type picker that reads the imported words; rarity chips hidden for tokens (owner decision 8).

### Phase 2 — Admin walk-through of the stepper (3–5 days)

Status 2026-09-28 (feat/admin-stepper-walkthrough, migration 0121): 2.1–2.4
done, 2.5 left open. Nothing in this phase changes a stored bake or a
renderer (Lane B). How it works: `docs/FRAMES.md` "Walking the stepper and
signing off a template".

Owner decisions 2026-09-28 (the nine PR questions, PR #395):
1. Kept: the template sign-off publishes the scored colours; a colour with no
   real printing is published by its own tick after a walk.
2. Changed: a colour whose match is below 90 % (`SIGN_OFF_LOW_MATCH_PCT`;
   the recorded number is an edge difference, so match = 100 − it) is
   marked on its row and named in a confirm step before Publish. It warns
   and never blocks (2.4).
3. Kept: a colour's newest score counts, either the tick's recorded score
   or a sign-off Score, if it was taken against today's reference.
4. Kept: every save during a walk is a private frame preview, even on a
   verified combo.
5. Kept: walks don't import the reference art.
6. Changed: My Cards badges a preview "Frame preview" in the grid, compact
   and list views (2.3).
7. Changed: a bulk "make public / unlisted" in My Cards skips the previews
   and changes the rest, and says so. The server decides; a batch of only
   previews changes nothing and says why (2.3).
8. Kept: the short deploy → migration window, when a preview save fails
   with PostgREST's missing-column message. Ordinary saves and bulk changes
   don't depend on 0121.
9. Kept: 2.5 (the snapshot strip) stays open at P3.

- [x] (done 2026-09-28 — feat/admin-stepper-walkthrough: `resolveFramePreviewMode` in `lib/creator/frame-preview.ts` parses `all`, a template (all seven colours) or `template/colour` tokens, drops anything unknown, and unions the combos with the verified set only when the server-read profile is an admin — the URL never decides it. `/create` and `/card/<slug>/edit` pass the union to the picker and the real verified set to the form (`framePreview.publishedKeys`), which the in-form AI dialog uses; AI jobs resolve frames on the server from the verified set as before. A persistent banner (`components/creator/frame-preview-banner.tsx`) names the mode, the unverified count, the walk and an "Exit preview" link; on the edit page it says the frame is locked there (revise mode) and, for a flagged card, that it stays private. The guest ISR page never reads searchParams (a unit test pins it); a non-admin's `?previewFrames` changes nothing (unit + e2e). Not done: frame chips don't mark which offered combos are unverified — the banner carries it) **2.1 [P1] `?previewFrames=all|<list>` for admins** on the create and
      edit pages: union the keys, persistent banner; never on the guest ISR
      page; AI jobs keep their own set (`app/(app)/create/page.tsx`:234,
      `app/(app)/card/[username]/edit/page.tsx`:165).
- [x] (done 2026-09-28 — same PR: a "Walk" link on every colour row, a "Walk the stepper" link per template (its first colour still to verify, `firstColourToWalk`) and one on the compare view. The create page builds the seed with `buildFrameWalkthrough` (`lib/creator/frame-walkthrough.ts`): the combo's reference (the compare view's rule, now shared as `pickFrameReference`: `?ref=` pick, else pinned, else registry default) through `buildFrameComparePayload`, which now also returns its form patch — second face included — pinned to the template under test; no printing or a failed lookup → the compare view's sample content (`sampleWalkthroughPatch`), and the banner says which. The form applies the seed once through `handleScryfallImport` (the user's import path), pins frame + colour, toasts if the reference lands on another colour, and starts on the Card step. Art is not imported (as in the compare view) — the banner says to add some on Identity when the art window matters. Checked on the dev DB with adventure/g (Lovestruck Beast // Heart's Desire, the storybook page filled) and battle/r (sample). Note: 0.22's last bullet — the owner's Cut // Ribbons compare check — should still come before walking aftermath) **2.2 [P1] "Walk the stepper" link per template row** in the checklist →
      `/create?previewFrames=all&kind=…&template=…&color=…&seed=reference`,
      prefilled from `buildFrameComparePayload()` (with the second face from
      0.2) so battle/adventure/saga/split/flip/aftermath (later DFC) flow
      through Card → Identity → Text & stats → Publish exactly as for a user.
- [x] (done 2026-09-28 — same PR, migration 0121: `cards.frame_preview` default false; CHECK `cards_frame_preview_private` (a flagged card is private, so every public/unlisted surface — gallery, sitemap, hubs, trending, feeds, profiles, OG — excludes it by construction); trigger `cards_guard_frame_preview` lets only an admin's API session raise the flag (service role / migration owner pass); grants stated (the trigger function is revoked from the API roles; the column rides 0097's table grants). In the app: the form asks for `frame_preview` on a save in preview mode on an unverified combo and on every save during a walk (judged as a draft: a title is enough); `createCardAction` honours it only for an admin — skips the verification gate (the kind gate still runs), stores it private + flagged, never adds it to a deck, never records `card_saved`; an ordinary save never names the column. `updateCardAction` keeps a flagged card private whatever the patch says and flags a card an admin's preview-mode edit moves onto an unverified combo. The create → edit redirect keeps `previewFrames`. Listed under its template in the checklist and per colour in the sign-off view (`listFramePreviewCards`, service role, grouped by the frame/colour it renders as) with Re-verify (the card reopened in preview mode on today's frame — own cards only; another admin's can be deleted) and Delete (`deleteFramePreviewCardAction`, flagged rows only, render objects dropped). My Cards (owner decisions 6 and 7, 2026-09-28): the grid, compact and list views badge a preview "Frame preview" (`FramePreviewCardBadge`, `components/creator/frame-preview-card-badge.tsx`); nothing else about the tile changes. A bulk "make public / unlisted" skips the previews and changes the rest: `updateCardsVisibilityAction` reads `frame_preview` in its pre-flight (never from the client; before 0121 lands the read falls back to the old columns, since no card can be a preview yet), keeps its ownership checks, and returns `skippedPreviews`. The toast reads "Published 5 cards. Skipped 2 frame previews — they stay private." (`lib/cards/bulk-visibility-copy.ts`); a batch of only previews changes nothing and says why. A card flagged between the read and the write still trips the CHECK, which reads in words) **2.3 [P1] Preview saves** — allowed for admins on unverified combos but
      forced private and flagged `frame_preview` (migration); excluded from
      gallery/sitemap/hubs/trending/feeds; listed under the template in the
      checklist with delete / re-verify.
- [x] (done 2026-09-28 — same PR, migration 0121 adds the `score` / `signoff` event actions: `/admin/frame-compare?template=<t>` (no colour) is the sign-off view — per colour the reference, the verification record (0.10: version, override hash, stale reasons), the recorded auto-score (0.9) with whether it is current, a Score button (`scoreFrameColorAction`, records a `score` event), Walk / Compare links, the walked previews rendered live, and the per-colour checkbox, which still publishes or withdraws one colour. "Score N colours" scores the unscored/stale ones one at a time. Publish (`signOffFrameTemplateAction`) re-derives the rule on the server (`signOffStatus`, `lib/cards/frame-signoff.ts`): every colour WITH a reference printing scored on today's renderer and override (the tick's own staleness rule) and against the reference the combo stands for today (a re-pin stales the old score; a per-colour tick's own recorded score counts as well as a Score, whichever is newer) + the owner's tick; it stamps those colours exactly like a tick (0.10 columns, pinned-reference columns untouched) and logs a `verify` per colour and one `signoff` (colour `*`). Owner decisions 2026-09-28: colours with no real printing stay on their own checkbox, after a walk; a colour's newest score counts, either the tick's or a Score, if it was taken against today's reference; a colour whose match (100 − the recorded edge difference) is below `SIGN_OFF_LOW_MATCH_PCT` (90) is marked on its row ("Below 90% match"), and Publish first asks "N colours score below 90% — publish anyway?", naming them. It warns and never blocks. The signoff event records them as `lowMatch`) **2.4 [P1] Sign-off flow** — per-template verify button showing the
      auto-score per colour (0.9), the walked preview cards (2.3) and the
      metadata (0.10); publishing = all colours scored + the owner's tick.
- [ ] **2.5 [P3] Optional Playwright-generated snapshot strip** of each step per
      kind in the compare view. (Still open 2026-09-28: not small — it needs a
      render target outside CI (the compare view is admin-only on a live
      deploy, and CI's Playwright runs against the local stack), somewhere to
      store the strips (a bucket + a manifest, or artifacts) and a way to
      refresh them per kind. The sign-off view's live renders of the walked
      preview cards cover most of the need for now.)

### Phase 3 — Parity on frames people already use (1 week)

- [ ] **3.1 [P1] Snow/untap/Phyrexian pips in the bake match the mana font**
      (`lib/render/card-image.tsx`:884, `lib/cards/rules-text.ts`:253).
- [ ] **3.2 [P1] Rules-paragraph run margins identical in both renderers**;
      cancel the last line's margin (`card-image.tsx`:1092,
      `components/cards/card-preview.tsx`:1625).
- [x] (fixed 2026-09-25, layout v29 with 3.13: `LOYALTY_ROW` in `lib/cards/loyalty-rows.ts` holds the row anatomy both renderers draw — one 1.5 em badge height, its width, padding, gap, numeral size and nudge; a parity test forbids the old literals) **3.3 [P1] One loyalty-badge height constant** (1.6 vs 1.5 —
      `card-preview.tsx`:1797, `card-image.tsx`:1186).
- [ ] **3.4 [P2] Shared disc-relative constants** for cost gaps, inline
      hairlines and disc shadows.
- [ ] **3.5 [P2] Shadows/outlines as width fractions** materialised per renderer
      (`OUTLINE_SHADOW`, `ADV_SHADOW`, `SHOWCASE_SHADOW`, brand mark).
- [x] (shipped in #381, layout v25: `brandMarkLayout()` sizes the mark off the card's short side (×5/7 on landscape) and `FrameProfile.brandMark` places it — battle at right 11 %, clear of the defense badge; both renderers) **3.6 [P2] Brand mark on landscape** — size by height, anchor away from
      the defense badge (`card-preview.tsx`:1014, `card-image.tsx`:709).
- [ ] **3.7 [P1] Saga chapters through `RulesBody`** with the fit ladder and
      pips (`card-preview.tsx`:1294, `card-image.tsx`:1536).
      **Card Conjurer audit 2026-09-25:** Start chapter text at the 7.5 pt compact standard; today `SAGA.chapters.sizePct` 0.029 W = 5.2 pt (`lib/cards/template-layout.ts`:828-836) vs CC 0.0427 W. Put the chapter rail on the profile: badge at x 3.86 W, 7.87 W × 6.29 H straddling the left border; numeral 0.045 W; text 13.34–48.34 W; reminder block 8.67/11.29/40.4×17.72; rows 17.86 % H from 28.96, content-sized via 3.13's helper (`layoutLoyaltyRows`, `lib/cards/loyalty-rows.ts`, shipped in v29). Both renderers; verify on History of Benalia (DOM). Saga is verified, so this is a platform correction (0.20).
- [ ] **3.8 [P2] Artist footer on the 12 footer-less templates** (flip, split,
      aftermath, battle, lotr, lotrscroll, avatar, bloomburrow, bloomanime and
      the three tarkir frames — counted from the profiles; the plan said 13).
      **Card Conjurer audit 2026-09-25:** Footers also honour `TextSlot.shadowCss` in both renderers. `lib/render/card-image.tsx`:618-660 and `components/cards/card-preview.tsx`:983-1007 ignore it, though FULLARTLAND sets it (`lib/cards/template-layout.ts`:1437-1442). Full-art, borderless and showcase footers get an outline by default before they publish (CC outlines its bottom info).
- [ ] **3.9 [P2] Second faces + adventure page get set symbol, flavour text,
      watermark and rarity** (`card-preview.tsx`:1416, `card-image.tsx`:1648).
- [ ] (partly 2026-09-28, layout v32 (4.20): every M15-era family title and type line is fitted by its measured width — `fitTitleBand` (`lib/cards/title-band.ts`) and `fitTypeLineBand` (`lib/cards/render-tiers.ts`) behind `TextSlot.fit: "measured"`, shrinking only as far as the room before the cost or the drawn set symbol's ink needs, to 5 pt of the card's orientation, then ONE "…" both renderers draw; the frames outside the family keep the estimate and the CSS ellipsis. Follow-up: the measure is an upper bound (advances + the pairs the browser kerns wider) that runs ≈ 2.6 % over the kerned ink, so the longest printed type lines still shrink a little where the print keeps full size (ONE #196 64 vs 68 px, DSK #113 62): a kerned (GPOS) estimate for the preview's width, with Satori's unkerned layout box given the room past it, would close that — re-measure with 4.8. Partly 2026-09-25, layout v29: "titles shrink instead of ellipsizing" is done for the frames with a DETACHED cost — m15pw and modern: `fitDetachedCostTitle` (`lib/cards/title-band.ts`) ends the name one band gap before the pips it draws and shrinks it, in Beleren's measured advances + 2 % headroom, down to the 5 pt floor, where it is cut with a whole "…" (never on a one- or two-letter stub); aftermath's sideways bottom bar shrinks too (0.22). Every other frame still ellipsizes, and the rest of the item is open) **3.10 [P2] Bake paints by position not z-index** (document), `Band`
      honours `slot.font`, U+2212 mapped in the preview, titles shrink instead
      of ellipsizing (`card-image.tsx`:149,369,781, `card-preview.tsx`:714).
- [ ] **3.11 [P1] Parity tests for 3.1–3.7** in
      `tests/unit/render/render-parity.test.ts` + a CI visual-regression
      harness: a fixed card matrix (short/long name, long type, 1/8-line rules,
      flavour, P/T, crown once it exists) through both renderers for every
      published template with an SSIM threshold (reuse `/api/dev/render` +
      `scripts/visual-audit.mjs`).
      **Card Conjurer audit 2026-09-25:** Add matrix cases: a 1/1/5-line planeswalker (3.13), the aftermath second-face title-above-cost check (0.22), an orientation-6 JPEG (3.14), a 4-mode Command (3.16), `100/100` P/T (3.18), and reversed-hybrid plus unknown-code symbols (3.15).
      **Full-art research 2026-09-26:** add 3.24's four parity cases (full-art Plains disc, Zendikar split type line, textless creature with hidden rules, `m15land` Plains unchanged).
- [ ] **3.12 [P1] Layout-version bump + rebake sweep** after the fixes (owner
      badge flow; /news post) — bundle with 4.4/4.8/4.9 if timing allows.
      **Card Conjurer audit 2026-09-25:** The bundled bump also carries 3.13–3.22 and 4.16–4.20. Geometry and parity corrections go out as a 0.20 sweep, not as owner 'newer look' badges.
      **Status 2026-09-25:** stale as written — 4.4 did NOT wait: it shipped as v24 (sweep, #380) with 4.16–4.18 inside it, and v25–v28 followed as separate sweeps (#381/#382). None of 3.1–3.22 was in them (3.6 rode v25). This item is now "one sweep bump for the 3.x parity fixes when they land", no owner badge.
      **Status 2026-09-25 (round 5):** layout v29 (sweep, `VERSION_SCOPES[29]`) carries 3.3, 3.13, 3.18, part of 3.10 and part of 4.19, with 0.22 and the 4.31 leftovers. The other open 3.x fixes still need a later sweep when they land.
      **Owner step after the v29 merge deploys — run the sweep right away:** `SCOPE=version VERSION=29 node scripts/rebake-renders.mjs` (the plan), then again with `CONFIRM=yes` (or `SCOPE=sweep`). On production's 731 public cards (every one at v28, anonymous read 2026-09-26) it re-bakes the 729 whose bake v29 changes and stamps the 2 it doesn't (Bar e002bc65 and Worm f107e1f3, tarkirdragon), plus any unlisted cards in scope, which an anonymous read can't see. That is about 729 HD Satori bakes on Vercel. Until it runs, each in-scope card's free watermarked PNG download renders live (`hasServableStoredRender`: a platform correction is pending), and its download modal says the download looks different from the gallery image. That is correct, but it is the per-request Satori load behind the 2026-09-14 quota incident. OG images keep serving the stored bake. Also expected after deploy: /admin/frame-compare marks every verified combo "stale" (`frame-verification-state.ts` asks `isRenderStale` about a regular card with no name or stats). That is accurate for the 25 display-footer templates and aftermath, where every card changed. On the other 11 templates only cards with a two-word name or type line changed, which is nearly every reference card. Re-verify rather than trust the old ticks.
- [x] (fixed 2026-09-25, layout v29 — `layoutLoyaltyRows` / `layoutProfileLoyaltyRows` in `lib/cards/loyalty-rows.ts`: each row needs its estimated text height (the rules-fit wrap model, capitals counted at MPlantin's 0.74 em) or one badge height, plus padding; the text size is the largest ladder step at which every row fits; the slack is shared equally. The bake draws whole-pixel rows from shared edges (no seam gaps), the preview the same fractions, and each foil stripe follows its row. Not done: the optional per-row weight in `face_content`; saga chapters reuse it under 3.7. Walkers whose abilities don't fit even at 5 pt still lose text — an editor warning is a follow-up) **3.13 [P0] Planeswalker ability rows sized by content in both renderers** (Card Conjurer audit 2026-09-25) — Both renderers stack equal `flex: 1` loyalty rows (`lib/render/card-image.tsx`:1205-1212, `components/cards/card-preview.tsx`:1778-1786). The browser grows a long row (min-height:auto), Satori/Yoga does not. So a walker with a long ultimate looks right in the editor, while the stored PNG, gallery tile and OG image clip that ability under the loyalty plate. Reproduced by baking a 1/1/5-line m15pw. `fitRulesSizePct` only sees the whole box (`card-image.tsx`:213-231), so nothing shrinks. m15pw is verified for all 7 colours (`supabase/seed.sql`:40-51).

      Fix:
      - Compute per-row heights in the shared fit module: each ability's line count at the fitted size, a floor of one badge height, the remainder shared.
      - Feed the same numbers to both renderers and keep each badge centred on its row.
      - Add an optional per-row weight in `face_content` for manual tuning.
      - Reuse the helper for saga chapters (3.7).

      Acceptance: a parity test with a 1-line / 1-line / 5-line walker. Ship as a platform correction (0.20 sweep).
- [x] (fixed 2026-09-25 — `lib/media/orientation.ts` + migration 0118) **3.14 [P0] Normalise EXIF orientation for every raster we bake** (Card Conjurer audit 2026-09-25) — `uploadCardArtServerAction` (`lib/cards/upload-art-server.ts`:111-140) stores the original bytes with their EXIF orientation tag, and `components/creator/art-uploader.tsx` does not re-encode on the client. The browser preview honours the tag; the Satori bake ignores it (reproduced: an orientation-6 JPEG bakes unrotated). `toSatoriDataUrl` (`lib/render/art-source.ts`:67-89) passes JPEG/PNG up to 3 MB straight through and resizes larger files without `.rotate()`. So a phone photo looks upright in the creator and sideways in the stored bake, the WebP thumb, the OG image and downloads.

      Fix:
      - Auto-orient with `sharp(buffer).rotate()` and re-encode when `metadata.orientation > 1` in the art, watermark, set-icon and pip upload actions.
      - In `toSatoriDataUrl`, never pass through an oriented JPEG, and call `.rotate()` before `resize()` so existing uploads bake upright.
      - Run a one-off re-bake of cards whose art has orientation > 1.

      Acceptance: a unit test feeds an orientation-6 fixture through `resolveRenderableImage` and asserts upright pixels.

      Shipped: `lib/media/orientation.ts` is the one rule. Uploads (art, watermark, cover/set icon, avatar/banner) store the pixels turned the way the EXIF tag says, with no tag (same format; untagged files are stored byte-for-byte), so every browser and the bake agree on a new file; the pip normaliser turns before its square crop. At render time `toSatoriDataUrl` / `resolveRenderableImage` / `foilMaskSource` (bake, card OG, profile/deck OG) and the AI remix source follow what the creator shows in Chrome (`browserAppliesOrientation`): a tagged JPEG or PNG is turned, and the foil mask uses the turned natural size; a tagged WebP is drawn as stored, because Chrome ignores a WebP's tag (measured in Chromium 148 and Chrome 153; macOS ImageIO reports the tag, so Safari may turn it — no production file is a tagged WebP). A read-only production scan found 2 affected cards (orientation-6 JPEGs), and migration 0118 nulls their stamp; uploaded avatars, banners and deck covers (30 files) carry no tag. **Owner step after merge + deploy:** "Re-bake now" on /admin/frame-compare (marked scope) or the next SCOPE=sweep. Not fixable: a custom pip uploaded from a tagged photo before this fix was stored as a sideways PNG with the tag already gone — the owner re-uploads it. Known residual: when the server-side fetch of an allowed URL fails, `resolveRenderableImage` hands Satori the raw URL, which draws a legacy tagged JPEG sideways; a stored bake refuses that path (`resolveBakeArt`), so only a live download or an unbaked card's OG image during a storage hiccup can show it.
- [x] (fixed 2026-09-29 — fix/strip-upload-metadata: `lib/media/strip-metadata.ts` + `lib/media/upload-bytes.ts`; owner step below) **3.14a [P1] Strip camera metadata (GPS) from every upload** (3.14 review 2026-09-25) — Uploads are re-encoded only when their orientation tag is 2–8 (`normalizeUploadOrientation`, `lib/media/orientation.ts`). Every other JPEG/WebP (and a PNG's eXIf chunk) is stored byte-for-byte WITH its EXIF at a public storage URL: camera model, capture time and, for phone photos, GPS coordinates. A read-only production scan on 2026-09-25 found 65 card-art JPEGs with EXIF, and 1 of them carries GPS coordinates (aggregate count only; neither the coordinates nor the file were recorded). None of the 30 uploaded avatars, banners and deck covers carries GPS (2 avatar PNGs have an eXIf chunk without it).

      Fix:
      - Drop metadata from every JPEG/WebP/PNG in the five upload actions (art, watermark, cover/set icon, avatar/banner; custom pips already re-encode to a tag-free PNG). Either always re-encode with sharp (about 190 ms for a 12 MP photo, measured, plus one generation of JPEG loss) or strip the APP1/eXIf/EXIF chunks losslessly at the byte level. sharp converts an embedded colour profile to sRGB, which is what resvg draws anyway.
      - Backfill: an owner-run script that rewrites stored uploads that still carry GPS. With a byte-level strip the pixels don't change, so the stored render stays valid and nothing needs a re-bake. Never drop an Orientation tag of 2–8 without turning the pixels too (the two 0118 files): the creator would then show them sideways.

      Acceptance: a unit test uploads a JPEG and a WebP with GPS and orientation 1 and asserts that the stored bytes carry no EXIF; a re-run of the scan finds 0 files with GPS.

      Shipped (2026-09-29): `lib/media/strip-metadata.ts` strips at the CONTAINER level — no decode, no re-encode — so the decoded pixels are byte-identical: JPEG (EXIF incl. GPS/thumbnail/MakerNote, XMP + extended XMP, IPTC/Photoshop, COM, JFXX and JFIF thumbnails, MPF and everything after EOI, unknown APPn, between the scans of a progressive file too), PNG (eXIf, tEXt/zTXt/iTXt, tIME, unknown ancillary chunks, bytes after IEND), WebP (EXIF, XMP, unknown chunks; VP8X flags fixed), GIF (comments, XMP and unknown application extensions). Kept: the ICC profile (and PNG's colour/transparency/animation chunks, JFIF, Adobe APP14), an Orientation of 2–8 as a one-tag EXIF block, taken from the FIRST EXIF block only — the one sharp and Chrome read, so a later block's tag is never promoted (a file whose upright re-encode would overflow its bucket, or a legacy one — never dropped without turning), and C2PA Content Credentials only while they are the file's sole metadata and carry no EXIF (an assertion, or a thumbnail's own binary EXIF) (then the file is untouched and still verifies — 161 of dev's card-art files are FLUX/OpenAI art whose only metadata is that provenance; the credential goes whenever anything else must, since its hash covers those bytes). Every human upload path runs `prepareUploadBytes()` on the server: card art (both faces), design watermark + land icon, deck cover + card set icon, avatar + banner; the custom pip is a sharp re-encode that writes none (pinned by a test); and `restyleImage` hands the AI remix model a stripped source. sharp reads each result back, and a container the stripper can't walk is re-encoded instead (so a malformed file can't slip through) — decoded leniently, so a JPEG cut short or a PNG with no IEND, which uploads stored as-is before, still uploads instead of turning into "not a valid image". Not user files, left as they are: Scryfall imports (third-party art), AI outputs (`ai-*`, the model's provenance), bakes/thumbs (our own sharp/Satori output). Tests: `tests/unit/media/strip-metadata.test.ts` (per format, synthetic GPS — no real photo), `upload-metadata.test.ts` (every path), `tests/unit/render/strip-metadata-bake.test.ts` (a card baked from the stripped file is pixel-identical: inline, turn and transcode paths). Also proved on 899 real macOS system images (identical decode colour-managed, raw and turned; ICC identical) and on 44 real-photo variants with GPS/rotation injected (identical bakes).

      **Owner step after merge (production is never touched by CI or Claude):** from an up-to-date `main` checkout, `node scripts/strip-upload-metadata.mjs --target prod` (dry run; the secret key is read at a hidden prompt that echoes nothing — `scripts/lib/hidden-prompt.mjs`, now shared with `frames-promote.mjs`, whose old prompt put a TYPED key on screen once it wrapped past the terminal edge; listing objects isn't public) lists every affected object in card-art, profile-media, set-covers and custom-pips with the KINDS of metadata it carries (no values, no coordinates); then `--target prod --apply` (type "yes") rewrites them in place with the same Content-Type, Cache-Control and custom metadata. Each object is re-downloaded, stripped, verified (identical pixels, frames, orientation, ICC, and the same bake input — a JPEG/PNG the strip would move under the bake's 3 MB inline cap is padded with zero bytes to stay above it), checked unchanged since listing, written, and read back; anything that fails a check — or that sharp cannot decode, so it can't be verified — is listed and left alone, and the scan goes on. Resumable (`~/.pipglyph/strip-upload-metadata.<project>.json`). No stored bake changes and nothing needs a re-bake. `--gps-only` does the one GPS file first; a re-run of the dry run must then report "0 carry metadata (0 with GPS)" — that is the acceptance scan (anything still counted there is listed under "left alone" with the reason). Dev dry run 2026-09-29: 217 objects, 4 carry metadata (2 macOS-screenshot PNGs, 2 JPEG comments), 0 with GPS. Known residual (closed by the follow-up below): the storage RLS still let a signed-in user write their own folder directly with the Supabase client, bypassing the upload actions.

      **Owner step DONE 2026-09-29 (production):** the dry run scanned 1,599 objects, 265 of them carried metadata (1 with GPS); `--apply` rewrote all 265; the confirm dry run reported 0 carry metadata (0 with GPS) — the acceptance scan passes.

      - [x] (fixed 2026-09-29 — fix/storage-server-writes, migration 0126) **Follow-up: storage writes are server-only** (owner decision 2026-09-29). Every user bucket (card-art, card-exports, set-covers, card-renders, profile-media, custom-pips) had owner-folder INSERT/UPDATE/DELETE policies, so a signed-in user could write `{their id}/anything` with the Supabase client — no byte sniff, no strip, no moderation scan — and could upsert any picture over their own card's bake OBJECT in card-renders. 0126 drops all 18, and its drift guard drops EVERY other insert/update/delete/all policy on `storage.objects` whatever it names (production's early storage setup was hand-applied, 0005), with a WARNING per drop; the two owner SELECT policies (0038, 0039) and `frames` are unchanged. Every write is now server code on the service role: `lib/media/user-storage.ts` (`userFolder(bucket, userId)`) takes the id from the action's own auth check and bare server-made names only (`{uuid}.jpg`, `avatar-{uuid}.png`, `G.png`…; a slash, `..` or a non-uuid owner is refused), and `fileNameInFolder()` keeps a path read back from stored data (a profile's old avatar URL) inside the caller's folder — another user's object is never deleted. Moved onto it: card art, watermark/land icon, deck cover/set icon, avatar/banner (+ "Remove"/built-in swap), custom pip save/delete, AI art (`persistGeneratedArt`), Scryfall import; card renders go through `lib/cards/bake-core.ts`, which takes an owner + card ids (never a client or a path) and opens `userFolder("card-renders", ownerId)` — the save bake, the admin sweep, card delete, go-private, a moderation hide and a frame-preview delete (the last two used to drop only the PNG or call storage directly). Deletes moved too: through a user's JWT a storage `remove` needs SELECT as well as DELETE, and card-art/profile-media/set-covers have no SELECT policy (advisor 0025), so those removes had been silent no-ops — a flagged upload stayed stored and a replaced avatar/banner was never deleted; choosing a built-in avatar now deletes the old upload only after the row has moved off it.
        **The render pointer (review 2026-09-29, pre-existing).** Protecting the object wasn't enough: `rendered_image_url` / `rendered_thumb_url` / `rendered_at` / `layout_version` were writable by the owner like any column (0003 UPDATE policy, 0097 table grant), so they could PATCH their card at an outside URL (a viewer-IP tracking pixel in every public listing), their own raw card-art upload (no watermark) or another card's bake; tiles, deck proxies, the free download and the share image showed it. 0126's `cards_guard_render_columns` lets `anon`/`authenticated` only keep or CLEAR those four (a new card can't be born with one; refusal = 42501), and cleans rows written before it (a pointer that isn't the card's own `card-renders/{owner}/{id}` object is cleared; production's public + unlisted cards: 0 outside our card-renders bucket on 2026-09-29). The save bake persists a new URL with the service role, pinned to id + verified owner + the `updated_at` it rendered; clears stay on the owner's client (so they work without the key). Display side, because the DB can't know its public storage host: `isStoredRenderUrl()` (`lib/cards/render-cdn.ts`: our host, card-renders) gates `BakedCardThumbnail`, the deck proxy images and the featured tiles (`featuredImageOf`), and `fetchStoredRender` serves only the card's own `{owner}/{id}.png` (it used to accept any object on our host, or Scryfall).
        **Missing `SUPABASE_SECRET_KEY`** (a local checkout or a preview without it): uploads and bakes fail with a plain error, and every render delete that can't happen — a private card, a deleted card — is `console.error`ed (the PNG stays publicly fetchable at its fixed URL), never skipped silently.
        Tests: `tests/unit/media/user-storage.test.ts`, `storage-server-writes.test.ts` (every action: auth first, the caller's folder whatever the form says, strip + scan, flagged → removed, the cookie client's `.storage` throws), `storage-callers.test.ts` (no browser module touches storage — member, destructuring or bracket access; the only callers are `user-storage.ts` and account deletion), `tests/unit/cards/render-storage-writes.test.ts` (bake objects + the service-role persist + the loud missing-key paths), `render-cdn.test.ts`, `featured-image.test.ts`, `stored-render.test.ts`, `baked-card-thumbnail.test.tsx`, `tests/unit/db/storage-server-writes-migration.test.ts` (replays every storage policy: none but the two SELECTs remain; pins the drift guard and the trigger), and the e2e `tests/e2e/storage-direct-writes.spec.ts` (a real session: a direct upload to each bucket, an upsert/delete of a bake, and a PATCH of each render column are refused; clearing works — all 8 fail against the pre-0126 schema). The trigger's per-role behaviour was also run on a scratch Postgres.
        **Deploy note.** The code commits work under the old AND the new database (the service role ignores policies and the trigger), so they can merge before 0126 with no window. Merged together, 0126 reaches production about when Vercel starts building; until the new deployment is live the OLD code's uploads, AI-art persists and save-bake uploads are refused (a refused bake only clears that card's render; the auto-rebake cron re-bakes it; a refused AI step is refunded by the reconcile cron a day later), and its render DELETES (card delete, go-private, private-card bake) remove nothing and report no error — list the cards made private or deleted in that window and remove their render objects with the service role. Once `sync-dev` migrates the shared dev DB, any preview or local checkout on older code loses uploads against dev until it merges main.
- [x] (fixed 2026-09-29 — fix/storage-url-guards, migration 0127; owner decisions 2026-09-29) **3.14b [P2] Tie every user-media URL column to our storage** (3.14a follow-up review, 2026-09-29) — 0126 made storage writes and a card's render pointer server-only, but the other picture URLs are still whatever their owner writes through PostgREST: `cards.art_url` (and the second face's art inside `back_face`), `cards.set_icon_url`, the watermark's land icon inside `cards.watermark`, `profiles.avatar_url` / `banner_url`, `decks.cover_url`, `custom_pips.image_url`, `deck_cards.image_url`. Their DB CHECKs are length-only (0003, 0022, 0039, 0055) and `isSafeImageUrl` means "any https", so an outside picture skips the strip, the moderation scan and (for art) the watermark, and several public surfaces draw them with a raw `<img>` (the comment author's avatar on card pages, `components/cards/set-symbol.tsx`, the deck card modal, the user menu; `CardPreview`'s art). The bake itself only fetches art from our storage + Scryfall (`isAllowedServerImageFetchUrl`). Fix: per column, a guard trigger or CHECK that ties the value to our storage host + the owner's folder (the DB doesn't know its public host — a server-only write path like the render pointer's, or a `site_settings` row the check reads), plus Scryfall hosts where imports store them and `/defaults/…` for built-in profile media; zod mirrors it; display surfaces check before drawing. Owner decision 2026-09-29: yes — every such column, plus a per-user upload rate limit and an orphan sweep.
  - Also from that review, pre-existing and not fixed by 0126: (a) [done — below] the upload actions have no per-user rate limit or quota (each call can store up to 8 MB under a new random name that nothing cleans up — card-art objects aren't tied to rows — and runs a moderation call); a limit needs a counter table like `scryfall_calls` (a migration) and owner-chosen numbers ; (b) [done — below] an owner-run service-role ORPHAN sweep: objects no row references (flagged uploads and replaced avatars/banners that the old user-session removes never deleted, plus any render left by the deploy window above) — card-art needs care (remixes share `art_url`, AI job steps and unsaved drafts reference fresh uploads), so only objects older than a few days ; (c) [still open] a Content-Security-Policy `img-src` would stop any leftover outside picture from loading (today the CSP is `frame-ancestors` only, `next.config.ts`).
      Shipped (2026-09-29): **Database.** Migration 0127 adds a guard trigger per table (`cards_guard_media_columns` on `art_url`, `back_face`, `watermark`, `set_icon_url`; `profiles_guard_media_columns`; `decks_guard_media_columns`; `custom_pips_guard_media_columns`; `deck_cards_guard_media_columns`), the shape of 0126's render guard (SECURITY INVOKER, EXECUTE revoked, `anon`/`authenticated` only): keep the current value, clear it, or store what `public.media_url_allowed(kind, url, auth.uid())` accepts — a public object on a `public.storage_origins` origin, in the kind's bucket (art / second-face art / watermark: card-art; set icon: set-covers or card-art; avatar / banner: profile-media or a built-in `/defaults/…` of that kind; deck cover: set-covers or card-art for AI covers; pip: custom-pips with `?v=`), directly in the caller's own folder; card art may also be a built-in image (the seed cards); a deck entry's `image_url` takes `https://cards.scryfall.io/…` only (the one Scryfall URL the product stores — imported art is copied into card-art). Refusal = 42501 `media_url_not_allowed: <table>.<column>`, mapped to a field error by the card and deck actions (`lib/media/media-url-errors.ts`). Existing rows are grandfathered, nothing is rewritten. `storage_origins` = production's custom domain + project host (the migration — nothing else, since it runs on production too) plus each other database's OWN origin, which the app upserts with the service role before its first user-folder write (`lib/media/storage-origin.ts`; `seed:dev --copy-cards-from` does it too) — no dev host in the migration, no `*.supabase.co` in a seed. `handle_new_user` now keeps a signup's metadata avatar only for a Google sign-in (`raw_app_meta_data.provider = 'google'`, GoTrue's) and only a Google ACCOUNT picture (`lhN.googleusercontent.com/a/…` or `/a-/…` — all 53 production Google avatars) (any email signup could set `avatar_url` in its metadata, and the trigger runs past the guard). `cards_guard_back_card`: `back_card_id` may only name another of the owner's cards (it was app-checked only); the card page skips a legacy mismatch (`sameOwnerBackCard`, `lib/cards/back-card.ts`; production public/unlisted: no card has a `back_card_id`). **Remixes:** the creator prefills a remix with the parent's art, second-face art and custom watermark — the parent owner's objects — so `createCardAction` now copies those into the remixer's card-art folder first (`lib/cards/remix-media.ts`, `userFolder().copyIn`, counted as one upload) — whoever owns the parent, since a remix of your own pre-0127 remix still has the original owner's art (only objects in another user's folder are copied); remixes saved before 0127 keep sharing; a parent whose object is gone now fails the save plainly instead of storing a dead link. The deck import drops a Scryfall URL 0127 would refuse to null (`isScryfallPrintingImage`, the same regex) instead of failing the whole insert; `seed:dev --copy-cards-from` re-hosts the second-face art, custom watermark and set icon too (`scripts/lib/seed-card-media.mjs`). **Display.** `isAllowedMediaUrl(kind, url, ownerId)` / `profileMediaSrc()` (`lib/media/media-urls.ts`, host list in `lib/media/storage-hosts.ts`, shared with `isStoredRenderUrl`) gate: `CardPreview` and every server render of a stored card (`drawableCardMedia` in `rowToPreviewData` / `cardToPreviewData`, so preview and bake drop the same pictures; `resolveBakeArt` refuses art it would drop), `SetSymbol`, `getPipOverrides`, owner / author avatars (card queries, comments), the card page's creator block, featured creators, the profile page (banner, avatar, JSON-LD) and its share image, `/api/me` + the app layout (header menu), settings + onboarding, the admin user list and moderation queue, deck covers (grid, page, My Decks, share image, ZIP export) and deck entry images (list, modal). A dropped avatar / banner falls back to a built-in picked from the profile id. **Rate limit (a):** `public.upload_hits` + `hit_upload_limit(user, per_minute, per_day)` (service role only; per-user advisory lock; one row per counted upload, so the windows SLIDE — the last 60 s and the last 24 h, never calendar minutes; each call prunes up to 500 expired rows of anyone's with `skip locked`; admins exempt from `profiles.is_admin`; account deletion cascades) — `checkUploadRateLimit()` (`lib/media/upload-rate-limit.ts`, 30/min, 300/day, fail-CLOSED with `UPLOAD_RATE_LIMITED` except while the function isn't deployed — PGRST202 / 42883) runs right after the auth check in card art, watermark / land icon, deck cover / set icon, avatar / banner, custom pip, the Scryfall art import (429 + Retry-After) and the remix copy; refusals carry `code: "UPLOAD_RATE_LIMITED"` and the owner's copy ("You're uploading too fast — try again in a minute." / "Daily upload limit reached — try again tomorrow."; when the counter itself fails, "Uploads are paused for a moment — try again in a minute." — wording owner-approved 2026-09-29 (d)). Not counted: our own bakes and AI art (credit-metered, and every AI step already passes `checkAiRateLimit`, 40/min / 500/day) — owner decision 2026-09-29 (a): AI art stays EXEMPT, no bucket of its own. Production (public + unlisted, 2026-09-29): 785 cards — art 781 own folder, 2 remixes sharing their parent's, 2 empty; set icons 105 set-covers + 3 old AI icons in card-art; 17 custom watermarks, all own; 92 profiles — 53 Google avatars, 33 + 91 built-in, 6 + 1 uploads; 33 decks — 24 own covers (20 AI in card-art); 8 pips, all own; 812 deck entries — 376 Scryfall, 436 empty. Nothing outside our storage. Private rows: the owner's read-only query in `supabase/migrations/README.md` ("Storage"). Tests: `tests/unit/db/media-url-guards-migration.test.ts`, `tests/unit/media/media-urls.test.ts` (incl. the SQL ↔ TS tables), `media-display-surfaces.test.tsx`, `upload-rate-limit.test.ts`, `upload-rate-limit-callers.test.ts` (closed list of storage writers), `user-storage.test.ts` (`copyIn`), `media-url-errors.test.ts`, `tests/unit/cards/remix-media.test.ts`, `render-parity.test.ts`; e2e `tests/e2e/media-url-guards.spec.ts` (a real session per column, the signup avatar incl. a Google-hosted one on an email signup, the back face, the limiter's sliding windows and prune). The first cut of the SQL ran on a scratch Postgres from the Supabase image (89 per-column cases, 44 failing without 0127); the review round's SQL (sliding limiter, back-face guard, provider check) is proved by the CI e2e. Also `tests/unit/media/storage-origin.test.ts`, `tests/unit/cards/back-card.test.ts`, `tests/unit/devops/seed-card-media.test.ts`, `tests/unit/decks/import-plan.test.ts`.
    - [x] (done 2026-09-29 — feat/storage-orphan-sweep, no migration) **(b) the orphan sweep.** `scripts/sweep-storage-orphans.mjs` (helpers + reasoning in `scripts/lib/storage-orphans.mjs`, runbook in `docs/ENVIRONMENTS.md` §4 "Storage orphan sweep") is owner-run, dry run by default, `--target dev|prod` (production's key only at the hidden prompt; dev reads `.env.local` and refuses production). It lists card-art, profile-media, set-covers, custom-pips and card-renders and reports, per bucket, the objects no row references with size and age, plus bytes reclaimable. A reference is the object's `{uuid}/{file}` key inside ANY string of ANY row: the scan reads every text/JSON column of every table in PostgREST's OpenAPI document (keyset-paged to an empty page, so a lower max-rows can't end a table early; any read error aborts), so `cards` (art, `back_face`, set icon, watermark icon, bake/thumb), profiles, decks, `deck_cards`, `custom_pips`, AI job steps, idea batches, notifications, site updates, `card_exports.storage_path` and any future column are all covered; the tables the app writes URLs to today (`URL_SOURCES`) must be present or it refuses. Never deleted: anything changed in the last 7 days (`--min-age-days`, floor 7, every bucket), a bake/thumb whose card exists, anything outside the `{uuid}/{file}` shape (listed), `frames` (never listed) and `card-exports` (legacy download history from before 163a48c, still named by `card_exports` rows and handed out as share links — listed read-only). `--apply` (type "yes") deletes in batches of 25: `--backup-dir` copies first (a copy must match the listed MD5 eTag), then a fresh full DB scan for the batch's keys + card ids, then every object looked up again right before the delete (all at once until (e); now a few at a time) (gone / another eTag or size / recently changed → kept — storage has no conditional delete); `state.pending` is written before each delete (a crashed run is settled next time); after the delete every object is looked up again and only what storage reports gone is appended to `~/.pipglyph/sweep-storage-orphans.<project>.manifest.jsonl` (an unconfirmed one stays pending with its copy); eTags are compared however each API quotes them; `--limit` caps a run. Every batch re-reads the whole database, so the prompt prints the number of full reads first (production was told to use `--batch-size 100` — withdrawn after the 2026-09-29 incident, see (e): the full read takes about 2 s there, the default 25 is fine); `--backup-dir` is refused inside any git working tree (public repo, users' images). The dry run also lists, for review only, renders of PRIVATE cards still stored and user-folder objects whose names the server doesn't make (an older path, or a direct pre-0126 upload that skipped the sniff/strip/scan). Accepted race: a custom pip re-uploaded between its last lookup and the delete (milliseconds until (e); under a second at the default batch size since, a few seconds when storage is busy). Dev check 2026-09-29 (a throwaway object in a fake folder): list and info() give the same quoted MD5 eTag, remove() echoes full paths, info() of a gone object is 400/statusCode "404". Tests: `tests/unit/devops/sweep-storage-orphans.test.ts` (reference detection per column/form, paging past a capped page, age floor, live-card bakes, the per-batch re-check, limit, backup + MD5 check, crash + resume, and the CLI end to end against a fake Storage + PostgREST; each safety check was also removed once to see a test fail). Dev dry run 2026-09-29: 218 card-art (193 referenced, 24 unreferenced but under 7 days, 1 test file outside a user folder) + 380 card-renders (all referenced), other buckets empty → 0 orphans; an independent whole-dump check agreed. Follow-ups, owner decisions 2026-09-29 (b) and (c), two modes of the same script (one tool: they act on the two lists its dry run prints, and share its target guard, hidden prompt, adapters and state/manifest conventions — a separate script would copy ~150 lines of that; each mode keeps its own `~/.pipglyph/sweep-storage-orphans.<project>.<mode>.json` + `.manifest.jsonl`): **`--rescan-review`** (`scripts/lib/review-rescan.mjs`) runs the upload path's moderation scan on the review list ONLY (`reviewList()`, the dry run's own definition) — the same request, model and category allowlist, now in `lib/moderation/image-scan-core.ts` (no `server-only`), which `lib/moderation/image-scan.ts` uses too; the object's public URL with `?v=<eTag>`; paced (`--per-minute`, default 60), 429/5xx retried with Retry-After / backoff, 5 unfixable failures in a row or a refused key (401/403) stop the run, an error is recorded as "not scanned" (never clean, unlike the upload path's fail-open) and retried next run; a verdict is kept per object and eTag (resumable); types the model can't read are listed, not sent; production's `OPENAI_API_KEY` only at the hidden prompt and only to api.openai.com (dev: the env file's). `--apply` (type "yes") removes the flagged object as the upload path does — and, since the owner answers of 2026-09-29 (sub-item (d) below), first acts on every row that DRAWS it, through the app: each one looked up again (new bytes → kept and no row touched, the next run scans the new bytes), the rows acted on, then `state.pending`, remove, confirm; the run lists every row that names a flagged file (table, column, row id; one full DB read) in the output and the manifest (`categories`, `usedBy`, and each row action with its result). Never a copy (`--backup-dir` refused). **`--private-renders`** (`scripts/lib/private-renders.mjs`) removes the card-renders PNG + thumb of every card whose row says PRIVATE, whatever folder they sit in — only on that positive evidence (skeptic review 2026-09-29: the first cut also removed the renders of cards with no row, so a visibility answer cut short would have made a PUBLIC card "deleted" and taken its render; a deleted card's render is an orphan and stays the orphan sweep's, with its reference check, age floor and backup). Every visibility read checks the server's exact count against the rows returned and stops the run when they differ. Per batch of cards it first clears the pointer (`rendered_image_url`, `rendered_thumb_url`, `rendered_at`) of those that are private at that moment — one conditional UPDATE, what bulk go-private and a moderation hide write — then looks every object up (gone, or new bytes since the listing → kept), then reads the visibility AGAIN, then removes — nothing slow sits between that re-read and the remove: a card that is anything but private by then (public, unlisted, no row) is never touched. Dry run: card ids and counts only (no titles, no owners). No backups (`--backup-dir` refused: a render is derived). Dev dry runs 2026-09-29: `--private-renders` 380 card-renders = 190 cards, all public/unlisted → nothing to remove; `--rescan-review` 598 objects listed, review list 0 → nothing to scan. Tests: `tests/unit/devops/sweep-private-renders.test.ts`, `sweep-rescan-review.test.ts`, `tests/unit/moderation/image-scan.test.ts` (the same request + verdict as the upload path; each safety check was removed once to see a test fail), fakes shared in `tests/unit/devops/helpers/fake-supabase.ts`. **Owner steps, in this order, after #409 and #411 are live on production** (runbook: `docs/ENVIRONMENTS.md` §4 "Storage orphan sweep"): (1) `node scripts/sweep-storage-orphans.mjs --target prod` — the dry run: orphans + the two review lists; (2) `… --target prod --rescan-review` (dry run: scans and lists flagged files), then `… --target prod --rescan-review --apply` if anything is flagged (asks for production's CRON_SECRET: it hides the cards, swaps the avatars/banners, clears the deck covers and removes the pips that use a flagged file through the app, then removes the file; rows listed only are yours to decide about); (3) `… --target prod --private-renders`, then `… --target prod --private-renders --apply` (asks for production's CRON_SECRET: purges the removed renders' CDN copies through the app); (4) `… --target prod --apply --backup-dir ~/.pipglyph/sweep-backups/<date>` — the orphan sweep last: its `--backup-dir` copies what it deletes to your disk, so flagged files and private cards' renders go first, uncopied.
    - [x] (done 2026-09-29 — fix/moderation-cdn-followup, #412, no migration; owner answers 2026-09-29) **(d) the rescan acts on the rows that use a flagged file; going private purges the render's CDN copy.** **Rows.** `--rescan-review --apply` now acts, before removing a flagged file, on every row the app DRAWS it from — through the app, with the app's own code paths (`POST /api/admin/storage-sweep`, `lib/moderation/flagged-file.ts`): a card (art, second-face art in `back_face`, set icon, the watermark's icon, its bake/thumb) → HIDDEN by the one moderation hide, now `lib/moderation/hide-card.ts` (private + render pointer cleared in one update, both render objects removed, pending reports actioned, pages + CDN purged — the admin's "Hide" (`resolveCardReportsAction`) calls the same function; one change: the purge now also runs when marking the reports failed, since the card IS hidden); an avatar / banner → a random built-in of that kind (`randomDefaultMedia`, the settings "Remove" pick, checked by `isDefaultProfileMedia`; `revalidateProfileMedia`); a deck cover → cleared (`revalidateDeckPaths`, moved to `lib/decks/revalidate.ts`); a custom pip → removed like the owner's "Remove" (`lib/pips/remove-pip.ts`, shared with `deleteCustomPipAction`: row, `{owner}/{SYMBOL}.png`, caches, the after-response re-bake of the owner's cards that draw it — their list read with the service role). Each action re-reads its row and acts only while it still draws THIS file (our storage host, the file's bucket, its exact key — case-sensitive, like storage: `photo.JPG` beside `Photo.jpg` is another object; the script's search is bucket-agnostic, case-blind and prefix-matching, right for listing, wrong for acting) with a compare-and-set write; a row that no longer draws it is "skipped"; afterwards every stored URL that named the file and its bare public URL are purged from Vercel's Image Optimization cache (`purgeImageSources`, `dangerouslyDeleteBySrcImage`; kept 31 days and across deployments). A row naming the file anywhere else (a message, a notification, a job payload, a challenge's hero image, a deck entry, a card's text) is listed only. A FAILED action keeps the file (exit 1; a re-run retries — the app re-checks each row); the app not answering stops the run. Every action and its result goes into the manifest (`rowActions`, `listedOnly`). **CDN.** `/render-cdn/<owner>/<card>.png|.thumb.webp` (one-year immutable) now carries `Vercel-Cache-Tag: card-<id>` — the tag the share image already had — and serves ONLY a bake's two names (anything else in card-renders is a 404: it has no card to tag, so it could never be purged; production 2026-09-29: every public/unlisted card's render pointer is bake-shaped); `Cache-Control` is unchanged. Every CDN MISS also reads the card first (cookie-free anonymous read: public or unlisted, that owner) and answers 404 otherwise, 503 uncached when the read fails — the purge alone didn't hold: Supabase's CDN serves a removed object for up to 60 s, and a request in that window could refill ours for a year (Supabase docs, Smart CDN: "up to 60 seconds"); it also covers objects that outlived their card (skeptic review 2026-09-29; the first cut ran the read beside the storage fetch, and cancelling the refused storage body hung the request under Next's fetch — found in a local smoke test, so the read now comes first). Every existing go-private/hide/delete path already purged `card-<id>` after removing the objects (`purgeHiddenCard(s)`: single + bulk visibility, single + bulk delete, the moderation hide); added: account deletion (every card id read before the cascade, purged after the response), the re-bake that loses its race to an unpublish (it uploads and removes again), the frame-preview delete, and `--private-renders --apply` (through the endpoint: `purge-cards`, after storage confirmed each card's objects gone; a card is noted in `purgePending` in the state file before its remove and taken off once purged, so a crash or a refused purge is retried first by the next `--apply`). `purgeCardCdnCache` now sends at most 16 tags per call (Vercel's documented limit per purge request; an account deletion can name hundreds) and delete, not invalidate (Next 16's `revalidateTag(tag, "max")` / `invalidateByTag` would serve the private image once more while refetching). **The endpoint** takes `Authorization: Bearer <CRON_SECRET>` (fails closed, 503 without the service role, no dev bypass), a strict zod body (`whoami` / `purge-cards` ≤100 uuids / `flagged-file` with ≤50 actions), and names the database it talks to in every answer; the script (`scripts/lib/app-endpoint.mjs`) refuses an app on another database than its `--target` (production's two hosts count as one), refuses redirects, never prints the secret. Production: `https://www.pipglyph.com`, its CRON_SECRET only at a hidden prompt (`--app-url` refused); dev: `--app-url` (https, or http on localhost) + `CRON_SECRET` from the env file. Both modes ask the app BEFORE "yes", so a run never deletes what it can't finish. Why an endpoint and not an owner step: the hide has to be the app's code path anyway, and the purge needs a function on Vercel — one authenticated route covers both. Not changed: browsers keep their own immutable copy (can't be recalled); a new production deployment starts with an empty CDN cache for function responses (Vercel's docs, "Purging Vercel CDN Cache": the cache key includes the unique deployment URL), so copies cached before this ships, untagged, go with its deploy. Tests: `tests/unit/cards/render-cdn-route.test.ts`, `cache-purge.test.ts`, `rebake-batch.test.ts`, `frame-signoff-actions.test.ts`, `tests/unit/moderation/hide-card.test.ts`, `flagged-file.test.ts`, `tests/unit/api/storage-sweep-route.test.ts`, `tests/unit/pips/remove-pip.test.ts`, `tests/unit/auth/account-deletion.test.ts`, `tests/unit/devops/app-endpoint.test.ts`, `sweep-rescan-review.test.ts`, `sweep-private-renders.test.ts` (a fake app in `helpers/fake-app.ts`); each change was reverted once to see its test fail.
    - [x] (done 2026-09-29 — fix/sweep-storage-concurrency, no migration) **(e) storage calls capped and retried (incident 2026-09-29).** The owner's first production `--apply --batch-size 100 --backup-dir …` deleted 193 objects, then a batch failed: 7 objects "couldn't confirm the delete (Too many connections issued to the database)". Each batch fired every storage lookup at once (the pre-delete lookups, then the confirms — 100 each), and every Storage API request takes a connection from storage's own database pool. Nothing was lost (copies + manifest + the pending state, settled by the next run). Now every storage call of the script — listing pages, lookups, downloads, removes, confirms, in all three modes (and `reconcilePending`) — goes through ONE limiter shared by the run (`scripts/lib/storage-calls.mjs`, `limitStorage`): at most `--storage-concurrency` in flight (default 4, max 8; FIFO, a finished call hands its slot straight to the next); a call storage answers "busy" ("Too many connections", a pool timeout, 408 / 429 / 5xx, no answer at all) is retried — 4 tries, about 1 s / 2 s / 4 s apart with jitter, keeping its slot while it waits — before it counts as failed; a 4xx about the object fails at once. A REMOVE is never simply re-sent (skeptic review 2026-09-29): a re-send seconds later would lean on the stale pre-delete re-check (a bake of a card just made public, a pip re-uploaded at its fixed name), and after a first try that went through with its answer lost it would delete whatever landed at the name since — so `remove` is one try and `removeRechecked` sends a busy one again only for the objects a fresh re-check still clears (the orphan sweep's step-3 lookup rule; `--private-renders`: the lookup AND the visibility read; `--rescan-review`: the scanned eTag); what the re-check finds gone is recorded by the confirm with its copy. The adapters keep storage-js's HTTP status (`storageCallError`) so "busy" can be told from "no". The helpers wrap whatever storage they are given (idempotent), so a raw storage never runs uncapped. Batch semantics unchanged (one full database scan per batch). The `--batch-size 100` advice is gone from the script (header + prompt), `docs/ENVIRONMENTS.md` §4 and (b) above: the full read takes about 2 s on production (36 tables, 6.6k rows), the default 25 is fine and keeps each batch's re-scan-to-delete stretch short. `scripts/strip-upload-metadata.mjs` is strictly one call at a time — unchanged. Tests: `tests/unit/devops/storage-calls.test.ts` (limiter, retry rules against real storage-js errors, backoff, listing pages), and in `sweep-storage-orphans.test.ts` / `sweep-private-renders.test.ts` / `sweep-rescan-review.test.ts` a fake storage whose pool refuses a 5th concurrent call with "Too many connections…" (in memory, and over HTTP for the real CLI running `--apply --batch-size 100`): the old code loses most of a 100-object batch to "lookup failed", the new one deletes and confirms all with a peak of 4; a busy remove (refused, or gone through with its answer lost) while bytes change, a pip is re-uploaded or a card is published during the wait keeps them (each also fails against a plain retry of the remove).
    - [ ] (owner, in progress 2026-09-29) **Production run of (b)–(d).** Dry run: 450 orphans, 129.6 MB reclaimable; the review list is empty (nothing for `--rescan-review` to scan); `--private-renders`: no render of a private card. The first `--apply` deleted 193 before storage ran out of database connections ((e) above; the 7 unconfirmed deletes were left pending in the state file, which the next run settles first). Re-run in progress with `--batch-size 5` as the workaround until (e) is live; after it, the default batch size is fine.
    - [ ] (deferred — owner decision 2026-09-29) **Purge Next's Image Optimization copies of a card's old render when it goes private.** Going private (bulk + single visibility, the moderation hide, delete, `--private-renders`) removes the render objects and purges tag `card-<id>` (the `/render-cdn` bake and the share image), but not a `/_next/image` copy of the render's URL (Vercel keeps those up to 31 days, across deployments; (d) purges them for flagged files with `purgeImageSources`, `lib/cards/cache-purge.ts`). Latent path: no live page sends a render through `/_next/image` today (owner, 2026-09-29) — do it (the card's render URLs through `purgeImageSources` in `purgeHiddenCard(s)`, `lib/cards/revalidate.ts`) if one ever does.
- [ ] **3.15 [P2] One symbol resolver for both renderers** (Card Conjurer audit 2026-09-25) — Two inputs render differently in preview and bake:
      - A reversed hybrid (`{U/W}`) is a blank grey disc in the preview (`components/cards/card-preview.tsx`:1690; mana-font has no `.ms-uw`) but a correct split disc in the bake (`lib/cards/rules-text.ts`:261-267).
      - An unknown code (`{FOO}`) is a blank disc in the preview and disappears in the bake (`lib/render/card-image.tsx`:885, `components/cards/mana-cost-glyphs.tsx`:112).

      Canonicalise hybrid order in rules text in the shared tokenizer, as `normalizeManaCost` already does for the cost (`lib/cards/actions.ts`:309; `lib/cards/pip-runs.ts`:19 accepts either order). Render unknown codes as literal text in both renderers. CC tries the code and its reverse (`creator-23.js`:3741-3747).

      Acceptance: a unit test that every suffix the tokenizer can emit has a mana-font codepoint.
- [ ] **3.16 [P2] Modal bullets: hanging indent, tight gap** (Card Conjurer audit 2026-09-25) — Printed modal spells hang-indent each '• ' mode's wrapped lines after the bullet, with no ability-sized gap between modes or after 'Choose … —' (DTK Kolaghan's Command). PipGlyph makes one paragraph per source line (`lib/cards/rules-text.ts`:174-233) and puts the 0.45 em gap between every one (`lib/cards/typography.ts`:66-72, `lib/render/card-image.tsx`:1052-1120).

      Fix: the tokenizer marks paragraphs starting with `•` (and spree `+`) as `hanging`. Both renderers indent their wrapped lines by the bullet width and use a small gap between consecutive bullets. The fit estimate counts the indent. CC does this with {indent}/{lns} (`creator-23.js`:3546-3551,3677-3682).

      Acceptance: a parity test with a 4-mode Command.
- [ ] **3.17 [P2] Flat inline pips (shadow only in the cost band)** (Card Conjurer audit 2026-09-25) — Printed cards, and CC (`packM15RegularNew.js`:54 vs :57), shadow only the mana cost; inline rules symbols are flat (DOM Llanowar Elves). We shadow every rules, loyalty, saga and second-face pip: the preview uses `ms-shadow` (`components/cards/card-preview.tsx`:1690), the bake's ManaGem always sets `boxShadow` (`lib/render/card-image.tsx`:826,843,897), and override pips are shadowed too (:1008-1021).

      Add a `shadow` flag on ManaGem and the rules pip items, on only in the cost band. Parity test; bundle with 3.12.
- [x] **3.18 [P2] Stat values shrink to fit their plate** (Card Conjurer audit 2026-09-25) — P/T, loyalty and defense render at a fixed `slot.sizePct` (StatBake in `lib/render/card-image.tsx` ~1422, `components/cards/card-preview.tsx` ~1112), while each side allows 16 characters (`lib/validation/card.ts`:121-126). `100/100` overflows the M15 plate; '15/15', '*/1+*' and 'X/X+1' fit.

      Done (wf/r5-stats-final): `lib/cards/stat-fit.ts` models where each renderer inks a value from Beleren Bold's metrics (advances, side bearings, the GPOS kerning between stat characters — Satori centres the unkerned advance box and draws the kerned run from its left edge; the browser centres the kerned run) and both renderers print it at `fitStatSizePct()`: the profile size, unchanged, while its ink stays on the face the frame draws for it (`StatSlot.inkSpanPct`, measured on the digits' rows: M15 plate 1185–1395.4 px, Alpha strip 1236–1404, planeswalker shield 1239–1389, Retro strip 1125–1410, Modern plate 1143–1373, flip band 1235–1403 / 104–257.5, Dragon Wing 1193–1388, Draconic 1187–1398, Ghostfire ribbon 1153–1404; else the rect or the drawn badge); smaller when not; flip second faces too (mirrored, upside down). A value is always one line and centred (`white-space: nowrap`; `flexShrink: 0` on the bake's span): Satori used to squeeze a value wider than its rect to the rect, so `X/X+1` and `+4/+4` wrapped after the slash and `40/40` ran off to the right. `statLayoutChanged(row)` is the layout-bump scope (0 of 724 public production cards).

      Run stat values through `fitSingleLineSizePct` against the plate width (4.18's plateRect once it exists), capped at the profile size, in both renderers. CC's P/T is oneLine with shrink (`packM15RegularNew.js`:58).

      Acceptance: tests with `100/100` and `*/1+*`.
- [ ] **3.19 [P2] Card-relative flavour bar** (Card Conjurer audit 2026-09-25) — Both renderers draw the flavour divider as `borderTop: 1px` (`lib/render/card-image.tsx`:1151, `components/cards/card-preview.tsx`:1730). That is about 0.2% of card height in the preview but about 0.05% in the 1500×2100 bake, so it is too thin in the stored PNG and differs between the two. CC draws `bar.png` at 96% of the text width (`creator-23.js`:3552-3567).

      Replace it with a bar about 0.2% of card height and about 96% of the text width, with faded ends (an SVG linear gradient in both renderers). Measure against three M15 scans (Serra Angel DOM). Bundle with 3.12.
- [ ] **3.20 [P2] Metric-based text fitting** (Card Conjurer audit 2026-09-25) — Fitting uses fixed average advances: `CHAR_W` 0.5 em (MPlantin measures ≈0.43) and `DISPLAY_CHAR_W` 0.56 em (Beleren 0.41–0.61), with a 0.96 safety factor (`lib/cards/render-tiers.ts`:30-35,106). So rules text steps down half a point early, and all-caps titles run about 8% wider than estimated.

      Fix:
      - Generate `lib/cards/font-metrics.json` (advance widths + kerning for MPlantin, MPlantin Italic and Beleren) from the committed TTFs with a script. Regenerate it after 4.8's Beleren2016.
      - Replace the constants with a deterministic word-wrap simulation in `fitRulesSizePct`/`fitSingleLineSizePct`, shared by preview and bake and reused by 3.10 (titles), 3.18 (stats) and 3.13 (rows).

      Acceptance: unit tests against line counts measured on a few Scryfall scans. CC measures real glyphs (`creator-23.js`:3825-3833,3897-3903).
      **Status 2026-09-25 (layout v29):** a first table exists — `lib/cards/display-metrics.ts` holds Beleren Bold's advances (font units) and the kerning pairs it sets APART, held to the TTF by a test; the detached-cost name fit (3.10) and aftermath's bars (0.22) measure with it, and `lib/cards/stat-fit.ts` has its own per-glyph ink model for stats (3.18). The rules estimate still counts average widths (capitals at 0.74 em for planeswalker rows only). **2026-09-26:** `lib/cards/rules-metrics.ts` holds MPlantin's regular + italic advances (held to both TTFs by a test; neither master kerns) and `wrapRulesText`, the greedy wrap both renderers run over the same runs (the bake's gap after every run, and a hair wider for its whole-pixel type). Only the planeswalker last-row shield check (4.19) uses it; the size fits still count averages.
      **Status 2026-09-28 (layout v33, 3.29):** the RULES half is done — `CHAR_W`, `CAPS_CHAR_W`, `RULES_FIT_SAFETY`, `fitRulesSizePct` and `wrapRulesText` are gone; `lib/cards/rules-layout.ts` breaks every rules, flavor, walker-row and saga line with MPlantin's own advances (`lib/cards/rules-metrics.ts`, each face's glyph through Latin Extended-A, held to both TTFs) and both renderers draw those lines. Still open here: the display face (`DISPLAY_CHAR_W` on the frames outside the measured M15 family, and Beleren2016's table after 4.8).
- [ ] **3.21 [P3] Larger hybrid cost pips** (Card Conjurer audit 2026-09-25) — Printed hybrid and two-brid cost pips are about 1.2× a mono pip (UMA Murderous Redcap), and CC loads them at 1.2 (`creator-23.js`:326-328). We draw every cost pip at one size (`lib/render/card-image.tsx`:822-872, `components/cards/mana-cost-glyphs.tsx`:259).

      Scale split discs ×1.2 in the cost band only, keeping the row's vertical centre. Check Phyrexian against a scan first. Parity test.
- [ ] **3.22 [P2] m15land/m15snowland title band ends too early** (Card Conjurer audit 2026-09-25) — After 0.12 folded the name's left edge to 8.4% W, `widthPct` stayed at 77.5. The title band now ends at 85.9% W (m15snowland: 86.6%), so long land names shrink early on two verified templates. The comment still says '14 + 77.5 = 91.5' (`lib/cards/template-layout.ts`:343-376). CC's box ends at 91.28 (`packM15RegularNew.js`:55), and land frames have no cost.

      Set `widthPct` to 83.8 / 83.1 and fix the comment. Ship as a platform correction (0.20). (Still open at `267f46c`: M15LAND, now ~line 488, still has `widthPct` 77.5 and the old comment; the v24 swap didn't touch it.)
- [x] (done 2026-09-26 — feat/new-frames: opt-in per profile, in both renderers; every existing card bakes byte-identical (production's 731 public cards at 750 px and at HD, and a 1,501-card template × kind × colour × finish matrix: only fullartland's rows change, under its v30 sweep). Shipped: the brand mark's dark pill (`brandMark.pill`, preset `BRAND_MARK_ON_ART`, `BRAND_MARK_PILL`) and the outlined footer on the art (`footerOnArt`: the footer draws its own `shadowCss`, else the em-based `ON_ART_OUTLINE` — 3.8's fix, for profiles that opt in). The bake draws a multi-layer zero-blur outline as offset copies of the footer under it (`textShadowCopies`, `FooterBake` in `lib/render/card-image.tsx`): Satori writes one feDropShadow per layer and merges them, and sharp/librsvg keeps only the last, so the first cut baked a one-sided up-left shadow where the browser draws a ring (new-frames review 2026-09-26). A real HD bake now rings every side, the copies sit under the light line, and each copy clips to the artist line's box as the browser clips a text-shadow to the ellipsizing span. The art framing is carried across a frame switch the user makes (`lib/cards/art-framing.ts`, `components/creator/use-treatment-switch.ts`: the image point under the window's centre stays there, same zoom; real bakes land it within 1.6 px wherever the new window can pan — where the covered picture exactly spans the new window on an axis at that zoom, e.g. m15borderless → m15 at zoom 1, the focal resets to the centre on that axis, by design and documented there). Etched is shown disabled in the Finish picker on a frame whose art reaches the card edge (`artReachesCardEdge`: fullartland, m15borderless, m15borderlessartifact) and dropped with a toast by a switch onto one. `frameAssetPathsFor` lists the basic-symbol images and the borderless P/T plates (bakes with public/frames withheld, as on Vercel, are identical). **Corner radius, measured** on Scryfall's PNGs (FDN #311, M21 #315, DMU #435, FDN #1, MH3 #326; throttled, named User-Agent): 32.2 px on the 745 px image on every corner of every card, borderless and black-bordered alike — Scryfall's one standard cut, 4.32 % of the width, ≈ 65 px at 1500 (3.09 % of the height). Today: CSS 52.5 px, the CC masters 39 px (the bake fills the cut with #101015), 6.18 proposes 43.5; now that art reaches the top corners (m15borderless) and all four (fullartland), the 52.5 px CSS round shows. The recommendation is its own item, 3.26 (open for the owner). Split out: multi-layer shadows on the frames that already declare `OUTLINE_SHADOW` (3.25); floating crowns and the holo stamp as overlays (4.6 / 4.9 — the stamp sits in an arch of the rules-box pinline, see 4.9); 3.11's CI visual harness) **3.23 [P1] Edge-to-edge frames in both renderers (before 4.32)** (borderless research 2026-09-25) — Only `fullartland` puts art on the card edge today (`lib/cards/template-layout.ts`:1776). Nothing verified does, so these gaps are invisible. CC's borderless masters bake the translucent bars and box into the PNG (α128 box, `m15/borderless/*.png`), so 4.32 needs no new box capability. It does need:
      - **One corner radius.** Display rounds with CSS `.card-corners` at 3.5 % / 2.5 % = 52.5 px at HD (`app/globals.css`:335-340, used by `components/cards/baked-card-thumbnail.tsx`:82,99). The CC masters are cut at 39 px (`lib/cards/frame-sources.json`:7), and 6.18 proposes about 43.5 px. On a black border the difference is hidden; on borderless the art sits in the corner and shows it. Measure the printed radius on FDN #311 and use one constant for CSS, OG, 6.18's rounded download and the CC importer's corner cut.
      - **Brand mark on art.** `BRAND_MARK_PLACEMENT` (`template-layout.ts`:318, bottom 1.8 %) sits inside M15's black border. On 4.32 it still lands in the CC bottom bar (92.24–100 % H), which is fine. On treatments without a bar (4.36, 4.37 tokens, `fullartland`, `bloomanime`) it lands on the art: 82 % white plus a 1 px shadow (`lib/render/card-image.tsx`:850-878). Set these profiles' placement through `FrameProfile.brandMark` (per-profile since #381, 3.6) and add an optional dark pill, identical in preview and bake. The watermark policy still requires the mark on every display surface.
      - **Art framing survives a treatment switch.** focal/scale are relative to the slot, so moving between a 1.37 window and the 0.77 full-bleed slot re-crops the art. Carry the visible centre across the switch in the shared maths (with 3b.13).
      - **New overlays in `frameAssetPathsFor`** (`lib/render/card-image.tsx`:2083): borderless P/T plates, floating crowns and the holo stamp. Otherwise they bake as a transparent pixel on Vercel.
      - **Finishes.** Foil masks by art luminance and works. Etched masks by the frame PNG's luminance (`lib/cards/etched-finish.tsx`:11-20), so it nearly vanishes on a mostly transparent frame. Hide Etched on borderless treatments until 4.28.
      - **Footer outline on art** for bar-less treatments (3.8's `shadowCss` fix).

      Acceptance: parity cases in 3.11 for a full-bleed profile (a corner pixel, brand-mark position, art centre after a template switch).
      **Full-art research 2026-09-26:** the overlay bullet also covers the basic-land symbol discs 3.24 draws (CC `textless/2022/s?.png`, ZEN `s?.svg`). They must be in `frameAssetPathsFor`. `fullartland` has art below its bottom bar (84.5–90.3 % H), so its footer and brand mark land on the art; it is already on the bar-less list.
- [x] (done 2026-09-26 — feat/new-frames: all three capabilities in both renderers, opt-in, tested on real bakes and the preview DOM. `FrameProfile.basicSymbol` {rect, style disc | glyph | none, assetPathTemplate with `{symbol}`} — `lib/cards/basic-symbol.ts`, presets `BASIC_SYMBOL_CC_2022`, `BASIC_SYMBOL_MSE_SOCKET` (the old fullartland socket, measured) and `BASIC_SYMBOL_ZEN_MEDALLION`; a basic draws its symbol there and skips the rules-box watermark, an explicit mana watermark swaps the symbol (the disc keeps the frame colour) at the watermark's own opacity, a preset / custom image is contained; the disc is painted under the frame, the symbol above it. `type.split` {leftRect, rightRect, leftAlign?, rightAlign?} split at the em dash (`splitTypeLine`), one size (`fitSplitTypeSizePct`), set symbol only in `symbolRect`; preset `TYPE_SPLIT_ZEN`. `FrameProfile.textless` hides the type line, rules, flavour and every rules-box layer, skips the rules fit, and the Text step says “This frame prints no rules text — it's kept and shows on other frames”. In use: fullartland (v30 sweep) and m15fullartland (new) take `basicSymbol` = CC's disc box with the bucket's `s?.png` (4.39); `type.split` waits for 4.40 and `textless` for 4.35(a)'s m15textless* re-source, each with its own scoped sweep. The bake-side details the review found pinned only by the preview (the split's right half centred and each box its own half, the pill's radius, an explicit watermark's opacity, the glyph halo, CC's disc box) are now pinned on real bakes and literal numbers) **3.24 [P1] Full-art renderer pieces: basic-land symbol slot, split type line, textless flag (before 4.39)** (full-art research 2026-09-26) — 3.23 makes edge-to-edge art work. Full-art frames need three more capabilities, in both renderers, with parity:
      - **Basic-land symbol slot.** Today a basic's symbol is the automatic `{mana, large}` watermark (`resolveWatermark`, `lib/cards/watermark.ts`:210-217). It is drawn centred in the rules rect at 0.92 of that rect's height, in the dark `watermarkInk` at 0.85 opacity (`lib/render/card-image.tsx`:640-693, `components/cards/card-preview.tsx`:959-1015).
        - **The problem.** On `fullartland` that rect is 16/15/70×62 % (`template-layout.ts`:1785-1790). So the HD bake paints a dark glyph about 1,200 px tall across the art, while the frame's own symbol socket (x 3.9–15.5 %, y 83.25–91.5 % H; α 0 there, measured) stays empty. Compare bakes A and J with ZNR #266 and UST #212 in `today/bakes-vs-real.jpg`.
        - **The slot.** Add an opt-in `FrameProfile.basicSymbol: { rect, style: "disc" | "glyph" | "none", assetPathTemplate? }`. When a profile sets it, a basic land (`basicLandManaKey` ≠ null) draws its symbol there and the rules-rect watermark is skipped.
        - **Seeds.** The CC 2022 disc at 4.13/83.43/11.2×8.0 % (`packTextlessBasics2022.js`, 168 px `s{w,u,b,r,g,c}.png`); the CC ZEN medallion at 42/78.67/16×11.43 % (`packZendikarBasic-1.js`, `s?.svg`).
        - **Explicit watermarks.** A mana watermark swaps the glyph inside the disc, and a custom image is contained in it. Nothing is drawn centred on the art.
        - **Everything else stays put.** Profiles without the field (m15land, modernland, alphaland …) are untouched. The 13 production basics are all on the verified `m15land` (anonymous read, `today/prod-land-cards.json`) and must bake pixel-identical.
      - **Split type line.** Zendikar-style basics print "Basic Land" on the left and the subtype on the right, with the medallion between them (BFZ #250 and BRO #278, checked by eye). Add `type.split: { leftRect, rightRect }`, splitting the text at the em dash. CC's boxes sit at y 81.96 %: left from x 8.54 at width 33.47 %, right from x 58 at width 28 %, centred (`packZendikarBasic-1.js`:46-47). 4.40 uses it.
      - **Textless flag.** `FrameProfile.textless: true`:
        - hides the type line, rules and flavour, plus the set symbol unless the profile places it;
        - keeps title, cost, P/T, footer and brand mark;
        - makes the fit estimate skip rules;
        - on the Text step, the form keeps the text and says "This frame prints no rules text — it's kept and shows on other frames".

        Today M15TEXTLESS and M15TEXTLESSLAND spread FULLART (`template-layout.ts`:1803-1813), so they print a type line at 73.6 % H and cream rules at 78.6–92.1 % H straight on the art (bakes E and F). Real textless printings print neither (SCH #3, P07 #1, PF19 #1). Used by 4.35(a)'s `m15textless` re-source, 4.37's textless variant and 4.42.
      - **Cross-referenced here, built elsewhere:**
        - Outlined rules ink: both renderers ignore `rules.shadowCss` today (the rules div at `card-image.tsx`:716-745 sets no textShadow). Build it once in 4.36 with `OUTLINE_SHADOW`.
        - The footer outline on art: 3.8.
        - The brand mark on art and the corner radius: 3.23.
        - The symbol discs as overlay assets in `frameAssetPathsFor` (`lib/render/card-image.tsx`:2083): 3.23's overlay bullet.
      - **Rollout.** This is a renderer change. Bump `CARD_LAYOUT_VERSION` (28 today) template-scoped to `fullartland`, `m15textless` and `m15textlessland` (`lib/cards/layout-version.ts`:196-221) with `VERSION_ROLLOUT: "sweep"`. Production has 0 public cards on them. Count private rows with an admin query first, since anonymous reads can't see them (as 0.25 does).

      Acceptance: 3.11 parity cases:
      - a full-art Plains: the disc sits in the socket and nothing is drawn over the art;
      - a Zendikar-style Forest: split type line plus centred medallion;
      - a textless creature with 4 lines of rules: only title, cost and P/T print;
      - an `m15land` Plains that bakes identical to today.
- [ ] **3.25 [P2] Multi-layer text shadows bake one-sided on the frames that declare `OUTLINE_SHADOW`** (new-frames review 2026-09-26) — Satori writes a multi-layer `text-shadow` as one feDropShadow per layer merged in one filter, and the bake's rasteriser (sharp → librsvg) keeps only the last layer; Chromium draws all four. Measured on the footer (3.23 fixed it there with `textShadowCopies` / `FooterBake`: offset copies under the text, clipped to the text's box). The same 1 px × 4 `OUTLINE_SHADOW` is declared on m15pw, alphatoken, battle, aftermath, lotr, lotrscroll and tarkirghostfire (title, type, P/T, loyalty — `lib/cards/template-layout.ts`), so their bakes should show only the up-left shadow (inferred from the probe, not measured on those templates). Measure one bake per template against the preview, then draw those bands with the same copies (Band, StatBake) in one template-scoped sweep; production has cards on m15pw.
- [x] (done 2026-09-27 — feat/card-corners, layout v31, "sweep", verification-neutral: `lib/cards/card-corner.ts` = 0.043 of the SHORT side (64.5 px at HD in both orientations); display `.card-corners` 4.3 % / 3.0714 % and `.card-corners-landscape` swapped; every bake cut round in its alpha (`applyCardCornerMask`), so thumbs and raw OG are round and the share composite clips at 18 px (22 px kept over a pre-v31 bake until the sweep); the CC masters re-cut 39 → 64.5 px (bucket, `frames:promote`); Phase B normalised the paper corners of 13 MSE templates + expeditionland w/u/r/c/m (`docs/FRAMES.md`); print and the Square PNG are the round render squared in the border's colour (`lib/frames/square-corners.ts`: #000, #101015 on the rings, the art/design where it runs into the corner); 6.18's Rounded/Square switch for every viewer, `/png` defaulting to square. Owner steps: `frames:promote`, the frame-swap sign-off, the v31 sweep with failed = 0 or the ids reported. **Owner, round 7 (2026-09-28):** adventure joins Phase B's allow-list — its 1–2 px grey paper rim just inside the arc (all 7 keys, luma ≤ 97) is repainted and cut like the others, so it leaves the edge contract's known failures, and `build-adventure-frame.mjs` runs the same hook (no bump: v31 already re-bakes it, 0 public adventure cards); Bloomburrow, LOTR and Tarkir draconic keep their drawn top corners in square outputs and print, as built; the small Phase B edge steps that show only at 6× contrast are accepted. Follow-ups: 6.18 (JPEG), 6.22 (landscape PDF), 7.8 (a limiter for anonymous live Square renders), and the aftermath, era, flip and `convert-mse-frame.mjs` builders' `effort: 10`, which quantises a rebuilt master to a palette after the gate and moves the cut's alpha (the adventure builder writes truecolour; `docs/FRAMES.md`).) **3.26 [P1] One corner radius for display, OG, downloads and the importer** (3.23's measurement, 2026-09-26) — Scryfall's PNGs cut every card at 32.2 px on 745 (4.32 % W, 3.09 % H, ≈ 65 px at 1500), borderless and black-bordered alike. Today: `.card-corners` 3.5 % / 2.5 % = 52.5 px (`app/globals.css`), the CC masters 39 px (the raw bake fills the cut with #101015 against a pure-black bar), 6.18 proposes 43.5 px. It shows now that art reaches the corners (m15borderless top corners, fullartland all four). **Recommendation:** one constant, 4.3 % W / 3.07 % H (65 px HD), for `.card-corners`, the OG image, 6.18's rounded download and the importer's corner cut, shipped together in its own batch with a sweep (it changes every card's display and the CC masters' cut, so a re-import and `frames:promote`). **Owner approved 2026-09-27 (round 6):** 4.3 % W, its own batch with a sweep, after #389 (4.32 / 4.39) ships; then 4.20.
- [x] (fixed 2026-09-27 — fix/mplantin-woff2: `public/fonts/mplantin.woff2` is now the `.woff`'s own sfnt re-encoded, `python3 -m fontTools.ttLib.woff2 compress -o public/fonts/mplantin.woff2 public/fonts/mplantin.woff` (fontTools 4.60.2, brotli 1.2.0; deterministic, 39,808 bytes). The old file was a WOFF2 of `mplantin.ttf`, whose cmap subtables say language 1: Chromium 148's sanitiser logged "OTS parsing error: cmap: Languages should be 0 (1)", so every page that drew rules text fetched the 25 KB woff2, dropped it and fetched the 49.7 KB `.woff` (75 KB, now 40 KB). Every table is byte-identical to the `.woff`'s (CFF outlines, cmap, hmtx, OS/2, name…) except the two `head` fields a WOFF2 encoder rewrites (checkSumAdjustment and flags bit 11); every character keeps the bake master's advance; Chromium draws it pixel-identical to the `.woff` it used before (0 differing pixels in a specimen line, loaded alone and through the real `@font-face` rule). `mplantin.ttf` is untouched and is still mana-font's file, the one the bake reads. OTS rejects it as well (the same cmap, plus a bad table-directory rangeShift), but it is the rule's third source and is never reached. Guards, both red on the old file: `tests/unit/content/mplantin-web-font.test.ts` (WOFF/WOFF2 decoded with node's zlib; table for table against the `.woff`, language 0 in every web font's cmap, advances against the master, master and `.woff` = mana-font's) and `tests/e2e/web-fonts.spec.ts` (each `@font-face` rule's first source loads in Chromium; MPlantin fetches its woff2 and nothing else). No card changes, no layout bump.) **3.27 [P2] Rebuild `public/fonts/mplantin.woff2` from the working `.woff`** (owner approved 2026-09-27, round 6) — Chromium rejects the woff2 (OTS cmap, 4.31) and silently falls back to the `.woff`, which renders correctly. Re-encode the woff2 from the `.woff`'s font data only (same glyphs, metrics and cmap), check Chromium loads it without an OTS error, and leave `MPlantin.ttf` (the bake's master) untouched. No card changes.
- [ ] **3.28 [P2] Battle: the name starts under the title bar's left ornament** (corner round-7 evidence 2026-09-27) — On the `battle` frame (landscape) the card name is drawn from the title rect's left edge, so its first letters sit under the name bar's left ornament ('…ity Probe' for 'Sanity Probe'), the same on main and in v31 (sheet 4a/2b). Move the title rect's left edge past the ornament (measure on the master and a printed Siege, e.g. MOM), both renderers, with its own template-scoped bump. 0 public battles today.
- [x] (done 2026-09-28 — feat/rules-text, layout v33, "sweep", card-scoped `VERSION_SCOPES[33]` (every card that prints rules, flavor, loyalty or chapter text, the saga intro included; never a textless frame's nor a basic land's), verification-neutral (owner decisions 2026-09-28). ONE pure module, `lib/cards/rules-layout.ts`, decides the size, every line break (rules AND flavor, walker rows, the saga rail) and every vertical position; both renderers only draw its lines (nowrap rows, `flexShrink: 0` runs, word gaps as `marginLeft`, every preview word in its ceiled box, U+2212 as a hyphen). The fit: MPlantin's own advances, no safety factor, lines checked at BOTH bakes (750 and HD, each its own whole px); the prints' spacing (0.98 em pitch, a fixed 24 HD px between abilities, 30 + 1 + 30 around the flavor bar, 42 without); the even HD-px ladder `RULES_SIZE_PX` 76 / 68 / 64 → 42; M15's print margins 4 / 0; keep-outs = the stat badges the card draws (P/T plate ink from `lib/cards/plate-ink.ts` via `scripts/measure-plate-ink.mjs`, the walker shield, the battle disc), judged glyph by glyph; a text too long even at the floor is set from the box's top. Walkers: ceiling 64 (`loyaltyRows.maxSizePct`; any other card on m15pw keeps 68), the row anatomy at one size (`LOYALTY_ROW_SIZE_PX` 46 — text from x 275, the prints' 274–276), no overlapping rows. Saga: correctness only (owner) — real pips (DOM #122's {R}{R}), reminder italics, U+2212, at v32's size, rows and badges; an all-intro saga is clipped inside its rail. Tokenizer: 54 of 731 public cards had a word glued to a pip or bracket ("{b}equal", "(remix)deals"), 16 more a split "({T}:". Measured on real bakes of the 731 cached public cards + an 800-card template matrix at 750 and HD (sha-verified frames): main-box median 58 → 72 HD px; 569 of 706 grow ≥ 0.5 pt, 463 ≥ 1 pt, 292 ≥ 1.5 pt; 336 at 76 px; none smaller at either bake; 21 still clip at the floor (15 token lands, 6 long M15); public walkers 5 → 5.5–6.7 pt (Jace 7.5 → 7.6); EOE #30 60 px (print 59.85), Serra Angel 76 (print 75.5); the only size drop anywhere is a synthetic walker whose only ability is static (Ajani, the Steadfast rows 67 → 64, the walker ceiling). Review round (parity, print, scope): preview word positions = the HD bake's (was up to 9 HD px of drift), the preview's flavor bar advances 1 HD px at every editor width, the MPlantin `@font-face` rules carry hhea metric overrides (Windows no longer sets rules text 0.046 em low), plate-ink pinned to the bucket plates' manifest hashes, the saga's combined-marker badge back on v32's exact box. Fix round (the evidence pass's two gaps): split's halves pad past the textbox border their rects hold (33 / 38 px measured on every colour master, `SPLIT_TEXTBOX_BORDER_PX`, then the MSE split style's 24 / 16; both halves 18 px above and below) — the first cut set an italic "f" on the gold and into the black frame — and a lone em dash after a word breaks with its word (vow-63 now "choose up to" / "one —", like the print); real bakes vs the first cut: 0 public cards change, only the 16 split matrix rows with text (none below v32), the dash fix changes no card. Owner steps: the round-9 sheet sign-off; merge only after the v32 sweep reports 0 failed and (the auto re-bake on main) knowing that merging queues the v33 sweep; confirm no `frame_profile_overrides` row exists. Follow-ups: 3.30.) **3.29 [P1] Rules text fitted by its real wraps and the prints' leading** (4.20 readers, 2026-09-28; **owner 2026-09-28: rules text stays untouched in v32; this is next, as its own round (v33)**) — The prints confirm the 9 pt ceiling: short text sets at 9.04–9.14 pt at 63 mm (CC 9.1 pt), and on the short-text controls (SPM #88, SPM #119, TLA #71, FIN #18) the printed lines are as tall as ours (64–65 px vs 65 px at HD). Cards look emptier for other reasons:
      - The fit is conservative: `fitRulesSizePct` counts an average width (`CHAR_W` 0.5 em × `SAFETY` 0.96, `lib/cards/render-tiers.ts`), not MPlantin's advances. From about 160 characters the prints stay at 9 pt (64–67 px lines) up to about 250 characters while ours drops (FDN #325, same text: the print is 9 pt and fills the box, ours about 7 pt).
      - The leading: prints set 0.95–0.975 em within a paragraph; ours is 1.155 em (`RULES_TEXT.lineHeight`, `lib/cards/typography.ts`).
      - The point basis: `ptToPct` uses 63.5 mm, so our 9 pt is 8.93 pt at 63 mm (prints 9.1 pt).

      Model on the public cards (a real-wrap height from `wrapRulesText`, `BAKE_WRAP_WIDE`): 482 of 658 cards with text grow ≥ 0.5 pt, 148 ≥ 1 pt, and 187 reach 9 pt (90 today); EOE #30 5.5 → about 7.3 pt, Serra Angel 8.0 → 9.1. Raising the ceiling to 9.5–10 pt instead was rejected: only 59 short-text cards change, and they end up bigger than the prints.

      Fix: `fitRulesSizePct` measures with `wrapRulesText` (the MPlantin wrap both renderers already run); re-measure the line pitch in px on known 9 pt prints before changing `lineHeight` / `wrapGapEm`; settle 63 vs 63.5 mm; profiles reference `RULES_TEXT.standardPt` instead of the `ptToPct` literals. It needs a render-checked no-clip test on every template (the rules box and the planeswalker rows share the fit). Its own layout bump (v33) on every template. **[decide]** a sweep or opt-in badges (the v22 precedent).

- [ ] **3.30 [P2] Rules text: follow-ups from the v33 rounds** (3.29 design + review, 2026-09-28) — each its own decision, most its own bump:
      - **Walker text** (with 4.19): the walker prints set their text condensed at 0.91–0.93 em leading; v33 sets it uncondensed at the rules standard's 0.98 em, so each of BFZ #29, DOM #1 and AKH #97 takes one line more than its print (9 / 10 / 9 vs 8 / 9 / 8). The rows already honour a slot `lineHeight`.
      - **Word space**: prints space words at ≈ 0.32 em on a wider column; v33 keeps 0.26 em (the exact-advance wrap already matches print line counts to within 1 %). Sheet evidence only so far.
      - **Hanging bullets** (VOW #63): modal bullets hang on print; ours wrap flush.
      - **A tall token text box** for long token text: 15 public token lands clip at the 42 px floor in the 12 %-high token box.
      - **The no-bar flavor gap** (42 px, from pre-bar M15-era prints) against a 7th / 8th Edition and a modern-frame print on `retro` / `modern`.
      - **Centring on ink**: a centred block is placed by its line boxes (0.07 em of air above the ascenders, 0.2155 em below the baseline), so it sits ≈ 5 px lower than print; centring on the ink would lift it.
      - **750 px positions**: each bake rounds its own px (the 750 pitch 0.962–0.974 em, 1.0 at 42–50 px; lines up to 6 HD px, a later word up to 20 HD px from HD's halved). Deriving the 750 positions from HD's is possible, but re-fits every card at 750.
      - **Scope**: `VERSION_SCOPES[33]` over-reaches on synthetic combos only (a back face's text on a template with no adventure page or second face, face_content saga/loyalty text on a template that never draws it, flavor on the saga rail): those re-bake byte-identical. No public card is affected; narrow it on the next text bump if the re-bakes matter.
      - **Fallback characters in the preview**: a character MPlantin lacks is budgeted a full em; the preview's word box takes that width while Satori sets the fallback glyph at its own, so on such a line the later words sit a little apart between the two.

### Phase 3b — Creator wizard bugs (1 week, parallel with Phases 1–3)

- [x] (shipped in feat/creator-reliability) **3b.1 [P1] Wrap the save actions in try/catch** — a failed request must
      not unmount the editor (`components/creator/card-creator-form.tsx`:1726).
      Shipped: the create/update calls catch, set the inline error + toast and keep the form (neutral copy: "The save didn't go through… if it keeps failing, copy your text and reload the page" — a 5xx or a stale action id after a deploy isn't a connection problem); a deck / back-face link that throws after a successful save says "Saved, but couldn't link…" and still moves on. Found in review and fixed with it: a save from the leave dialog on `/create?deckCard=` / `?backFor=` returned before the link step (card saved, never linked) — the link now runs first.
- [x] (shipped in feat/creator-reliability) **3b.2 [P1] Ideas dialog routes `card_type` through
      `applyKindProgrammatic`** (`card-creator-form.tsx`:981,
      `lib/ai/card-ideas-select.ts`:122).
      Shipped: colour first, then the kind change, unless the current kind already prints the idea's type (a creature on Adventure, an enchantment on Saga, a creature on a snow frame keeps its frame). Locked while revising, as in the AI fill.
- [x] (shipped in feat/creator-reliability) **3b.3 [P1] Clear `loyalty_abilities`/`saga_chapters` after folding** into
      `rules_text`; fold before the early return
      (`card-creator-form.tsx`:783,809,887,1606).
      Shipped: `carryStructuredRows` folds (a saga's intro too), empties and re-seeds on both paths of `applyKindPatch`.
- [x] (shipped in feat/creator-reliability) **3b.4 [P1] Dual lands** — the basic-land fallback applies only to exactly
      one basic subtype (`lib/cards/watermark.ts`:201,
      `lib/creator/card-kinds.ts`:447).
      Shipped: `basicLandManaKey`'s no-supertype/no-text fallback needs exactly one distinct basic type; card-kinds' seed helpers already dropped only a lone seed subtype. Renderer-shared, but it only changes a land with no supertype, no rules text and 2+ basic types: 0 of the 736 public production faces (all 6 public duals carry text), bakes of all 731 public cards byte-identical. Private rows can't be counted anonymously — **open (owner):** count them before merge (`select id, title from cards where card_type='land' and coalesce(trim(supertype),'')='' and coalesce(trim(rules_text),'')='' and (select count(distinct lower(trim(s))) from unnest(subtypes) s where lower(trim(s)) in ('plains','island','swamp','mountain','forest','wastes')) >= 2;`, plus the same test on `back_face->'subtypes'`); any hit keeps its old big-symbol PNG until re-baked (no badge, no layout bump).
- [x] (shipped in feat/creator-reliability) **3b.5 [P1] Inline-frame second-face name** — add to `saveMissing`, open
      the collapsed details on error, clear the leave-guard pending state only
      after a successful save (`card-creator-form.tsx`:584,949,2360,
      `lib/creator/form-schema.ts`:132, `panels/layout-panel.tsx`:109).
      **[decide]** allow a draft without it.
      **Decided 2026-09-26 (owner: "go with your recommendation"):** a draft may save without the second-face name; publishing requires it (`DRAFTS_MAY_OMIT_SECOND_FACE_NAME`).
      Shipped: one switch, `DRAFTS_MAY_OMIT_SECOND_FACE_NAME` in `lib/cards/second-face-name.ts` (its header names the 6 tests a flip rewrites), drives the form schema, the Save hint, the helper copy and the server gates (create, update as the patch over the stored row, bulk publish — all-or-nothing, naming up to 3 cards; bulk "make private" is never gated). `MoreOptions` opens on an error inside (`openWhen`, scrolls) and, without scrolling, while the Save hint asks for the missing name (`expandWhen`); the leave dialog stays open ("Saving…") until the save succeeds and shows why one failed.
- [x] (shipped in feat/creator-reliability) **3b.6 [P2] Edit save resets only when `!isDirty`** so keystrokes during
      the refresh survive (`card-creator-form.tsx`:538,1885).
      Shipped: the save baselines the sent values and marks clean only if nothing was typed in flight; the keyed reset rebases (server defaults, on-screen values and dirty state kept) for the same card while dirty. Another card always resets.
- [x] (shipped in feat/creator-reliability) **3b.7 [P2] Remove the history sentinel after a save**
      (`components/creator/unsaved-changes-guard.tsx`:88).
      Shipped: `release()` replaces `disarm()` — stops guarding and pops the sentinel, resolving on the popstate so the post-save navigation can't race it; also on "Leave without saving" (a test pins the pop before a link's navigation). A Back press while clean now re-arms a fresh sentinel for the next dirty spell.
- [x] (shipped in feat/creator-reliability) **3b.8 [P2] Split/aftermath second half defaults its type from the
      kind**, not "creature" (`lib/creator/form-types.ts`:128).
      Shipped: `blankSecondFaceFor(kind)` (`lib/creator/card-fields.ts`): split → instant, aftermath → sorcery, flip → creature; Adventure stays creature until 3b.14 (**open**: real adventures are instant/sorcery). Used on a kind change onto a blank second face, by "Clear second face", and when a stored inline-frame card has none.
- [ ] **3b.9 [P2] Mount one preview** (media-query hook) and memoise preview
      props (`card-creator-form.tsx`:549,1940,2643,2665).
- [ ] **3b.10 [P2] ChipGroup accessibility** — disabled chips reachable with
      their reason announced, roving tabindex + arrow keys
      (`components/ui/chip-group.tsx`:117).
- [ ] **3b.11 [P3] Remove `LayoutPanel`'s unreachable empty state**
      (`panels/layout-panel.tsx`:68).
- [ ] **3b.12 [P2] Copy pass** on every "Soon" / "awaiting verification" /
      substitution message so the creator never claims a frame it didn't apply.
      (partly done in #371: every programmatic substitution — kind change,
      import, AI fill — now toasts the frame and colour it used, and frame
      tiles say "Not verified in <colour> yet — picking it switches to …".
      Still open: the rest of the "Soon" copy, e.g. the Showcase finish chip
      (Foil/Etched shipped with 6.5), and the import dialog's "matched to
      this printing's border era" line (`scryfall-import-dialog.tsx`:843,
      rewritten by 1.5).)
- [ ] **3b.13 [P1] Art positioner matches the card's art window** (Card Conjurer audit 2026-09-25) — The pan surface is a fixed `aspect-[5/4]` (`components/creator/art-uploader.tsx`:42), and drags divide by that box's overflow (:282-336), while the card crops to `layout.artSlot`. On M15 (1.37) this is mild. On saga (0.41) and full-art (0.71), a horizontal drag sweeps the whole focal range in about 38 px. On aftermath/split (2.7) vertical drag does nothing; only the arrow keys work.

      Fix:
      - Size the surface from `resolveFrameProfile(template).artSlot` (the second face uses `secondFace.artSlot`, landscape-aware). Better: add drag-to-pan and Shift-wheel zoom on the live preview's art slot, with the window outlined while dragging, as CC does (`creator-23.js`:4200-4256).
      - Use one scale range everywhere. Today the uploader uses 0.5–3 (:39-40), the renderers 0.5–4 (`components/cards/card-preview.tsx`:573, `lib/render/card-image.tsx`:210) and zod 0.1–4 (`lib/validation/card.ts`:205).
      - Make the size hint template-aware (:635-639), showing slot px at the HD and 800 ppi exports, with a warning under 300 ppi.

      Acceptance: unit tests of the pan maths for the saga, aftermath and full-art slots.
- [ ] **3b.14 [P3] Layout kinds keep a card-type choice** (Card Conjurer audit 2026-09-25) — The adventure kind hard-codes creature (`lib/creator/card-kinds.ts`:156-161,539-560), so the 23 non-creature adventures (e.g. WOE Virtue enchantments) can't be typed correctly and always show the P/T editor. In CC the P/T plate is an optional layer (`packAdventure.js`:13-21).

      Adventure (and Prepare from 4.27, and flip) offer creature / enchantment / artifact / instant-sorcery on the Identity step. Stats and the P/T plate follow `card_type` (`lib/cards/card-display.ts`:142-156). Import keeps the front face's type for layout `adventure`.
- [ ] **3b.15 [P1] Token type picker: Creature, Artifact, Enchantment (and Emblem), with "Token" first on the type line** (token research 2026-09-29; owner request; owner decisions 2026-09-29; takes over 6.4's "automatic Token prefix" and 1.20's token half) — The token kind has no type choice today:
      - Its only type words are the free Supertype field under "More options — supertype, subtypes" (placeholder "Legendary", `components/creator/panels/identity-panel.tsx`). So tokens print no type word: none of the 5 public tokens with a P/T has one (2026-09-25 snapshot).
      - The Artifact look is a frame variation unrelated to the type.
      - An enchantment token can't wear Nyx, and there is no emblem.
      - The AI makes every token a 2/2 creature.

      The picker ships first, on today's frames:
      - **Picker.** The token kind gets:
        - toggles Creature · Artifact · Enchantment. Creature is on for a new token. None on is allowed (owner 2026-09-29): it prints the bare "Token" of the Copy token (TFDN #26);
        - Legendary;
        - an "Emblem" choice that switches to the emblem kind (6.23). **Owner 2026-09-29:** Emblem sits here, inside the Token kind next to Creature / Artifact / Enchantment, not as its own entry in the kind picker; an emblem is still stored as its own card type.

        Each toggle writes and removes only its own word in `supertype` (the pattern of 1.7's borrowed variation), in printed order: Legendary, Snow, then Enchantment, Artifact, Creature ("Token Legendary Artifact Creature — Construct", TNEO #14; "Token Enchantment Artifact Creature — Golem", TEOC #13). An import sets the toggles from its type line and keeps any other words (Land, 1.23).
      - **Frame follows the type.**
        - Artifact → the artifact templates (4.50; `m15tokenartifact` today).
        - Enchantment → Nyx when its toggle is on (4.51; on by default).
        - Both → artifact bars with the Nyx pill.
        - No colour → `c`.

        The "Artifact Token" frame chip stops being a separate choice (stored cards keep it).
      - **Stats.** P/T only with Creature or a Vehicle/Spacecraft subtype. `showsPowerToughness` (`lib/cards/card-display.ts`:49) is true for every token today, so a Treasure offers P/T inputs. It gains the supertype. Update every caller (at `2d488b5`): `components/cards/card-preview.tsx`:655, `lib/render/card-image.tsx`:455, `lib/cards/stat-fit.ts`:197, `lib/creator/steps.ts`:115, `components/creator/card-creator-form.tsx`:2046. A stored token with a P/T and no type word keeps printing it (and gains "Creature", below).
      - **AI.** `lib/ai/mtg-rules.ts` treats every token as a creature, so an AI-made Treasure or Shard gets a 2/2 whatever the picker says:
        - the lint at :286 ("Creatures and tokens need both power and toughness.");
        - `autofixCard` at :407, which sets a missing P/T to 2/2.

        Both must read the Creature word or a Vehicle/Spacecraft subtype, as `showsPowerToughness` does. The AI fill and ideas dialogs (`components/creator/ai-fill-dialog.tsx`, `components/creator/card-ideas-dialog.tsx`) write the same words for a token.
      - **Type line.** Print "Token" first, then the words: "Token Creature — Soldier", "Token Artifact — Treasure", "Token Enchantment Creature — Glimmer", "Token Legendary Creature — Wolf", and a bare "Token" for a Copy (the M15-on wording; MTG wiki "Token"). Today `buildTypeLine` prints the supertype, then the card type: "Creature Token — Soldier", "Token — Soldier" with no words, and "Emblem Token" when someone types Emblem.
      - **Rollout (its own sweep, not 4.49's).** A renderer change on stored cards:
        - a `CARD_LAYOUT_VERSION` bump, template-scoped to `m15token` / `m15tokenartifact` (and `alphatoken` until 4.54 retires it);
        - card-scoped (a `VERSION_SCOPES` predicate, as v29) to the token rows whose printed line changes: a word in `supertype`, plus the P/T rows that gain "Creature" (below);
        - `VERSION_ROLLOUT: "sweep"`, which the automatic re-bake (0120) picks up after deploy;
        - the before/after sheet of the changed public cards goes first.

        **Verification (owner 2026-09-29):** only the wording changes and no slot moves, so the bump joins `VERIFICATION_NEUTRAL_VERSIONS` and the 14 token ticks stay. If 4.49 is ready the same week, the two share one bump; a shared bump follows 4.49's rule and resets the ticks.

        **Stored tokens (owner 2026-09-29):** "Token" goes first on every stored token. The ones with a P/T and no type word (the 5 public ones; count private rows first) gain "Creature" in `supertype`, written in the same release before the sweep re-bakes them, so they print "Token Creature — Soldier" and the picker shows the toggle on. The 22 public cards typed "Basic" on the token frame will read "Token Basic — Wastes".
      - **Name.** Printed tokens are named after their subtypes ("Soldier") unless they have a proper name (TMKM #13 Voja Fenstalker). Fill the name from the subtypes until the user types one.
      - **Rarity (owner 2026-09-29).** Tokens print a black set symbol and a T in the collector line (4.9); emblems print an E. New tokens and emblems default to common, and the token and emblem kinds hide the rarity chips. Stored rarity is kept, so no bake changes for it: 14 of the 29 public tokens are uncommon (10) or rare (4), and 12 of those are one account's land cards on the token frame.
      - **Seeds and copy.** A token of each type (creature, Treasure, enchantment creature, Copy) in `supabase/seeds/*.sql` for previews; the FAQ of `content/articles/designing-custom-mtg-tokens.mdx`.
      - **Depends on:**
        - 1.20: this item does its token half;
        - 4.50 / 4.51 for the dresses;
        - 6.23 for the Emblem choice.

      Acceptance: unit tests for the words each toggle writes and removes, and for the printed line of 1.23's token fixtures (TFDN #26 prints "Token"). A Treasure shows no P/T input, and the AI lint and autofix leave it without one. E2E: an artifact token and an enchantment creature token.

      **Status 2026-09-29 (`feat/token-v34`): built, except the Emblem choice; ships in layout v34, one bump with 4.49 (so the 14 token ticks reset, owner decision 7).**
        - Picker (`components/creator/panels/card-setup-panel.tsx`, model in `lib/creator/card-kinds.ts`): Creature · Artifact · Enchantment + Legendary, each writing only its own word (`withSupertypeWord` / `withoutSupertypeWord`, printed order); none on = "Token". A new token gets Creature and common rarity, the chips hidden; leaving the kind takes its type words.
        - Type line: `buildTypeLine` prints "Token" first everywhere (both renderers, Card details + JSON-LD, OG, My Cards, locked summary, AI fill pin, ideas chips); 1.23's 23 fixture lines round-trip.
        - Stats: `showsPowerToughness(cardType, subtypes, supertype)` for inputs / steps / the AI; `printsPowerToughness` for both renderers, stat-fit and Card details (a stored word-less token keeps its P/T).
        - Frame follows the Artifact word (`typeWordFrameFor`; real edits only, never an unverified combo — a toast instead); the "Artifact Token" chip is gone from the setup panel, the AI fill dialog, random frames and the kind-change fallback. Enchantment stays on `m15token` until 4.51.
        - AI: lint + autofix read the word (a Treasure keeps no P/T; a given one is an error and autofix drops it; a word-less P/T token gains Creature; Vehicles keep their P/T); the design prompt teaches the words.
        - Migration `0128_token_creature_word.sql` (written as 0124; renumbered past main's 0125 and the queued 0126 / 0127): a token with a P/T and no Creature/Artifact/Enchantment word gains "Creature" (8 public rows; idempotent; no grants) and a null render stamp on the same rows, so the automatic re-bake draws them with the word whichever of the migration and the deploy lands first (skeptic pass 2026-09-29; the 0117 pattern). Seeds: a Treasure, a Glimmer and a Copy (dev_pro). FAQ in `designing-custom-mtg-tokens.mdx`. E2E `tests/e2e/token-types.spec.ts`.
        - The v34 scope reaches a token's wording on EVERY template (not the template list above: a token can sit on alphatoken, a showcase or flip, and a list would AND them away). Public production: 32 tokens, all on `m15token` (30 change their words, all 32 their frame).
        - AI jobs that save a designed card directly (random card, deck generation: `runGeneratedCardStep`) save a token as common too (skeptic pass 2026-09-29; the token kind hides the chips, so a rare one could never be set back). A remix keeps its source's rarity. The import dialog's Type row reads a token Token-first (`importPatchTypeLine`), and the walk-through's sample content for a token frame is a creature token of the frame's own words (`sampleFramePreview`: "Creature", "Artifact Creature" on the artifact frame) — without them the re-verification walks of m15token/m and m15tokenartifact w/b/r/g/m showed no P/T plate and the artifact ones landed on `m15token`.
        - One control per word (`feat/token-v34-polish`, 2026-09-29): on the token kind the Identity step's free Supertype field shows and edits only the words the picker doesn't own ("Snow", "Basic", an import's "Land"; `tokenOtherWordsOf` / `withTokenOtherWords` in `lib/creator/card-kinds.ts`, `TokenSupertypeInput` in `components/creator/panels/identity-panel.tsx`); it writes them back merged in printed order with the picker's words. A picker word typed there ("Legendary") is not written while the user types; on blur — or Enter, which saves the form (Save is its default button) without a blur — it turns its toggle on and leaves the field. Focusing and leaving the field writes nothing. Every other kind keeps the plain registered field. Round trip (skeptic pass): an imported "Token Legendary Artifact Creature — Construct", Enchantment on and Legendary off in the picker, "Snow legendary" + Enter in the field saves "Legendary Snow Enchantment Artifact Creature" (`creator-form-reliability.test.tsx`; also green on the merge with main's token import, #407).
        - Left: the Emblem choice (a code seam in `card-kinds.ts`; 6.23 + 4.52); the Nyx toggle (4.51); the artifact templates' text versions (4.50 / 4.49 (b)).

### Phase 4 — The frame factory (6–10 weeks, incremental)

4.1–4.3 are the machine, 4.4 the first product, 4.5–4.9 the capabilities the
rest of the catalogue needs, 4.10–4.11 the catalogue itself.

- [ ] (partly 2026-09-25: the pieces exist in three files, not one manifest — per-template provenance for the 9 CC templates in `lib/cards/frame-sources.json` (#378), bucket objects with width/height in `lib/frames/frame-manifest.json` (#377), reference printings in `lib/cards/frame-references.json` (#374). Still open: the per-template `frame.json` with kinds/slots/signature/profile, the codegen + "nothing hand-kept" test, and the CC-audit fields below) **4.1 [P1] Frame manifest** (`frames/<template>/frame.json`): source
      (pack/repo + commit + files), native resolution, conversion recipe,
      supported kinds + slots, Scryfall signature (1.4), reference printings
      (0.11), profile. Codegen for `FRAME_TEMPLATE_VALUES`/labels/sets/
      `ERA_TYPE_FRAME`/`TEMPLATE_SKIN_VARIANTS`/`FRAME_REFERENCES`/the seed
      block, with a test that nothing is hand-kept (`types/card.ts`,
      `lib/creator/card-kinds.ts`, `lib/cards/template-layout.ts`,
      `lib/cards/frame-reference-registry.ts`, `supabase/seed.sql`).
      **Card Conjurer audit 2026-09-25:** Per template AND per overlay, also record:
      - `nativeSize`. The in-progress 4.2 `lib/frames/frame-manifest.json` already stores width/height per file; carry that into the template manifest.
      - `ccGeneration` ('new' | 'regular'; their bands differ by 0.15–0.3 %).
      - A per-colour source map with `substitute: true` and a reason. CC has no `c` master for m15pw, tokens, saga, adventure, split, aftermath or snow nonland. The colourless land is `m15/new/l.png`; only the orphan packM15LandsNew's `ll.png` 404s. ABU `m` comes from Legends.
      - The source per family (CC / MSE / both).
      - `symbolStyle` (4.24).
      - The stamp, crown and plate overlays each treatment supports.
- [x] (infrastructure done 2026-09-25 — feat/frame-storage: migration 0116 `frames` bucket, content-addressed objects + `lib/frames/frame-manifest.json`, `frameUrl()` in preview + bake, hash-checked LRU in the bake, `frames:publish` (dev) / owner `frames:promote` (prod) / CI `frames:check`, docs/FRAMES.md; pilot proved a bucket render pixel-identical to git. Left for later: moving the existing MSE masters out of git (optional), picker thumbs, history rewrite = not doing. Since #380 the 9 CC M15 templates live only in the bucket (promoted to production; "Frames published" is a required check on `main`; Preview-scoped `NEXT_PUBLIC_FRAME_ORIGIN` is set)) **4.2 [P1] Storage move** — frame masters + WebP + small picker thumbs in
      a Supabase Storage (or Vercel Blob) bucket behind the CDN;
      `components/cards/frame-layer.tsx` and `lib/render/card-frames.ts` read a
      configurable frame origin; bounded LRU for the bake's in-memory frame
      cache; stop committing masters to git. **[decide]** history rewrite.
      Land before the first CC frame ships.
- [ ] (progress 2026-09-25 — feat/cc-importer (#378) + #380: `scripts/import-cc-frames.mjs` + `scripts/lib/cc-frames.mjs` build all 9 M15-era templates + P/T plates into `.frames-build/` with CC's exact layer recipe (mask ALPHA, CC draw order, native size, one downscale; coloured artifacts = artifact frame + colour interior; tokens from the textless bordered pack; SVG masks rasterised) and provenance in `lib/cards/frame-sources.json`; m15/c + m15devoid are no longer deferred — #380 imports them as see-through frames (4.17), plus the colourless see-through token and the planeswalker shield cut out through `maskLoyalty.png`. Still open: crowns / colour-indicator pips / DFC icons / half + page masks / holo stamps as overlay assets, CC bounds import into profiles (4.4 kept the hand-measured profiles + `costDy`/`plateRect`), the rule (i) test banning 'Wizards of the Coast' / 'NOT FOR SALE' / 'CardConjurer.com' (no such test exists), (j) known-composite scan tests, running it over the non-M15 packs (4.21), MSE mask generalisation; the plan's `scripts/import-cc-pack.mjs` name is `import-cc-frames.mjs`) **4.3 [P1] CC importer** (`scripts/import-cc-pack.mjs`) — clone the fork
      locally, flatten each pack's layers + masks per colour into exact-5:7
      1500×2100 PNGs with the art window at alpha 0, keep P/T plates, crowns,
      colour-indicator pips and DFC icons as overlay assets, import the bounds
      into the profile, write manifest provenance. Also generalise MSE mask
      compositing for the mainframe styles (`scripts/build-artifact-blend.mjs`,
      `scripts/build-adventure-frame.mjs` are the seeds).
      **Card Conjurer audit 2026-09-25:** Importer rules:
      (a) Composite in CC's own layer order (`creator-23.js`:1038-1110) at 2010×2814, then ONE Lanczos downscale to 1500×2100. Lands, artifacts, vehicles and two-colour cards are 6–10 masked layers, never just the per-colour PNG.
      (b) Rasterise SVG masks (`m15/new/vector masks`, token `frame.svg`/`pinline.svg`, `nyx/verticalMask.svg`) at the working size.
      (c) Replace `maskRightHalf.png` (744×1039, not 5:7) with 4.6's procedural ramp.
      (d) Fit plates and stamps to their declared bounds, not native pixels (`m15PTV` is 381×209 vs 377×206). Normalise the /2015 UB stamp bounds.
      (e) CC text sizes are fractions of card HEIGHT: `sizePct = size × 2814/2010`. Convert CC's box top + 0.7 em baseline into our centred band rects. M15 seeds: title 0.0533, type 0.0454, rules 0.0507, P/T 0.0521 W.
      (f) Import `artBounds` with their 1–4 px overshoot as `artSlot`, and assert each flattened frame is opaque outside it except the corners (7.6).
      (g) Check every referenced CC path against the pinned tree and fail on a miss. Dead refs: `new/fullart/c.png`, `new/ub/c.png`, and packM15TransformBackNew's double slash.
      (h) Keep as overlay assets: split/aftermath/adventure/flip half and page masks, holo stamps, colour-indicator pips, nickname plates, Nyx/companion inner crowns, miracle, and CC's margin-extension art (6.1a). Rotate CC's portrait split into landscape and measure the second art windows CC doesn't declare.
      (i) Never copy CC `bottomInfo` text: 31 packs carry '™ & © Wizards of the Coast' and 30 'NOT FOR SALE'. Add a test that no manifest or render contains 'Wizards of the Coast'.
      (j) One known-composite unit test per template (m15land/u vs Castle Vantress, m15artifact/u vs Phyrexian Metamorph).
      **Card Conjurer audit 2026-09-25:** (critic) The no-WotC-text test also bans "CardConjurer.com" and "NOT FOR SALE": CC's `setBottomInfoStyle` (`creator-23.js`:144-152) hard-codes them.
- [x] (shipped in #380, 2026-09-25: all 9 templates × 7 colours + plates from CC, bucket-hosted and promoted to production; owner side-by-side of all 721 production cards, rounds 1–2, instead of the auto-score → walk path; layout v24, template-scoped "sweep", no badges; `costDy` pip lift on the CC-framed profiles; planeswalker shield from the master. Left for later, each now its own sweep: the M15-family `artSlot` = CC artBounds (still 7.8/11.4/84.4×44.0) with the 7.6 coverage test; the token profile print-match in (1) — gold centred title, left type, symbol, P/T on the plate (M15TOKEN is unchanged); 4.19's rail and 4.20's sizes. Owner: the production `SCOPE=sweep` and a /news post — not verifiable from the repo) **4.4 [P1] Re-source the M15 base family from CC** — m15, m15land,
      m15token, m15tokenartifact, m15artifact, m15snow, m15snowland,
      m15devoid, m15pw → measured profiles → auto-score → walk → verify → ONE
      layout-version bump + rebake sweep + /news post. Changes every existing
      card's look; do it once, deliberately.
      **Card Conjurer audit 2026-09-25:** (1) m15token/m15tokenartifact come from CC token/m15/textless ('Textless (Bordered M15)'), NOT token/m15/regular as the scratchpad prototype has it. Its window (7.67–92.33 × 12.52–80.81) matches ours, so the art slot needs verifying, not re-measuring. Correct the verified token profile to match print (Soldier tdom):
      - title gold #fde367, Beleren small caps (4.8), centred;
      - type left-aligned from 8.54 W at 0.0454 W;
      - symbol right-anchored at 92.13, centred 84.39;
      - P/T on the M15 plate (4.18);
      - art ≥7.67/12.48/84.76×68.43.
      `c` keys: m15tokenartifact → a.png; m15token → l.png or keep MSE **[decide]**. (Resolved in #380: m15tokenartifact c = CC `a.png`; m15token c = CC's silver token frame, see-through with art under it, like printed colourless tokens — owner decision.)
      (2) M15-family `artSlot` = CC artBounds 7.67/11.29/84.76×44.29, which fixes today's hairlines on land, snow and artifact.
      (3) m15artifact per 4.16 (not the MSE blend, not the prototype's pinline-only recipe); m15devoid gets its own profile per 4.17; m15/c per 4.17's [decide].
      (4) m15pw, m15token and m15tokenartifact are 1500×2100 in CC too.
      (5) Correct the 2026-09-24 evaluation notes: token profiles don't need re-measuring, and CC does have a colourless land (`m15/new/l.png`).
      (6) 0.23, 4.16–4.20 and 7.6 land before, or in the SAME, layout bump.
      **Swap blockers (Card Conjurer audit 2026-09-25) — all must be handled in or before this item:**
      (Blockers 1, 2, 6 and the importer half of 7 are already done in the 4.3 importer, PR #378: CC's exact artifact recipe, the textless token pack, excluded see-through frames, native-size compositing. m15devoid is deferred to 4.17.)
      (Status after #380: 1–7 and 13 are done — 3 via 4.17's `underFrameArt`, 4 by redrawing the master's own shield above the stripes, 5 via `plateRect`, 13 = bucket + promote + the required "Frames published" check. 8 was avoided rather than solved: no CC text bounds were imported, the hand profiles stayed. 10: nothing from CC's bottomInfo is copied, but the test is still missing, and 0.23 is won't-do by owner decision. Open: 9 (artBounds + 7.6), 11 (4.19 rail, 4.20 sizes, M15 artSlot and the token profile fixes did not ride in v24), 12 (applies when 6.1b is built).)
      1. Coloured artifacts (4.16): build m15artifact with CC's recipe: artifact Frame + Border, and the colour's pinline, title/type bars, text box and P/T plate. The live MSE blend is inverted, and the scratchpad prototype (silver base + colour through the pinline mask only) is wrong too. Score every colour against Esper Sentinel, Phyrexian Metamorph and Embercleave before sign-off.
      2. Token source: m15token/m15tokenartifact must come from CC token/m15/textless ('Textless (Bordered M15)'), not token/m15/regular, which the prototype importer uses. The wrong pack shrinks every token's art window to 63.9 % and adds an empty text box to vanilla tokens.
      3. Translucent CC frames: m15/new/c.png ('Eldrazi') and every devoid frame are see-through (α 26–212). Without art under the frame (4.17), m15/c and m15devoid bake a flat grey text box and black side bands. Either keep an opaque c or ship 4.17 first; m15devoid already shows this today.
      4. Painted stat shields: CC's planeswalker (and battle) masters paint the loyalty/defense shield themselves. Drop our loyalty.png plate and the drawn defense badge for those masters, or two rims stack about 1.2 % apart. The badge rail and text x need 4.19's geometry in the same bump.
      5. P/T plate: CC's m15PT*.png has a native 2.04 aspect. Dropped into today's 23×5.8 rect, it stretches about 60 % like ours does. StatSlot.plateRect (4.18) must land in the same bump.
      6. Colour keys: CC has no `c` master for planeswalker, tokens, saga, adventure, split, aftermath or snow nonland. The colourless land is m15/new/l.png; only the orphan packM15LandsNew's ll.png 404s. new/fullart/c.png and new/ub/c.png are dead references. The manifest needs a substitution map with provenance and a per-colour auto-score, and the importer must fail on a missing path rather than write a blank.
      7. Compositing: CC builds lands, artifacts, vehicles and two-colour frames from 6–10 masked layers. Flatten in CC's layer order at 2010×2814, downscale once, and rasterise the SVG masks. Don't use the 744×1039 non-5:7 half mask. Fit plates and stamps to their bounds, not native pixels.
      8. Units: CC text sizes are fractions of card HEIGHT (multiply by 2814/2010 for our width-based sizePct), and CC places text on a 0.7 em baseline inside a box rather than centring it. A naive bounds import makes every text slot about 30 % small or offset.
      9. Art window: import CC artBounds with their 1–4 px overshoot, and assert the frame is opaque outside the slot AFTER the 2010→1500 downscale, which anti-aliases the window edge. Run the 7.6 coverage test so no clipped art ever exposes the #101015 background.
      10. Legal text: never copy CC bottomInfo strings ('™ & © Wizards of the Coast' in 31 packs, 'NOT FOR SALE' in 30) into manifests or renders; add a test for it. Rewrite the ~13 'original frames / no copyrighted assets' marketing and FAQ lines (0.23) before the first CC frame ships.
      11. One bump: 4.16–4.20 (artifact recipe, art under the frame, P/T plate box, planeswalker rail, title/type sizes), the M15 artSlot = CC artBounds change and the token profile fixes all change published pixels. Ship them in 4.4's single platform-correction sweep (0.20), not as separate 'newer look' badges. Re-measure title/type after Beleren2016 if 4.8 rides along.
      12. 800 ppi: only 6 of 4.4's 9 templates get 2010 px masters; m15pw and both token templates are 1500×2100 in CC too. Don't announce 6.1b as sharp for them; gate the option on manifest nativeSize, and on 6.10 for the art. (Note at `267f46c`: the swap published every master at 1500×2100 (the importer downscales once) and the P/T plates at 377×206, so no 2010 px master exists anywhere yet; 6.1b needs a second, native-size master set.)
      13. Storage: 4.2 is still in progress on feat/frame-storage (lib/frames/frame-manifest.json is empty; migration 0116 creates the bucket). CC masters must reach the production `frames` bucket through frames-promote before 4.4 merges, and must never be committed to the public repo. (Done: #377 merged; the manifest lists the 9 CC templates; "Frames published" is green on `main`.)
      **Token research 2026-09-29:** leftover (1) is the token print match. The P/T plate and the left-aligned type line and symbol are 4.49 (P0); the gold small-caps title and the art slot are 4.53.
- [ ] **4.5 [P1] Treatment × kind overlay model** — per-kind overlays (P/T
      plate, vehicle plate, loyalty rail + shield, defense badge, chapter rail,
      class/leveler bars later) as separate assets composed at render time via
      a new profile capability, so borderless/extended/textless/full-art/
      showcase treatments work for every kind; restrict every frame to the
      kinds whose overlays exist (replace `SHOWCASE_KIND_RESTRICTION`,
      `card-kinds.ts`:227). Fixes planeswalkers/battles in showcase frames
      printing no stat.
      **Borderless research 2026-09-25:** `m15borderless` (4.32),
      `m15borderlesspw` (4.33) and `m15borderlessland` (4.34) are the first
      templates to fold into this model. Until then `SHOWCASE_KIND_RESTRICTION`
      carries them.
      **Full-art research 2026-09-26:** `fullart` (ZNR showcase),
      `m15textless`, `extendedart` and the full-art basics (4.39–4.41, basic
      lands only) join the overlay model. Until then 0.26's gates carry them:
      planeswalker and battle off, plus `basicOnly`.
- [ ] **4.6 [P1] Missing anatomy, M15 era** — legendary crown overlay (auto
      from the Legendary supertype, opt-out), colour-indicator pips (auto when
      a coloured nonland has no cost), vehicle P/T box, coloured-artifact
      blend, hybrid + two-colour frames via masks (colour model gains a
      two-colour identity → blended frame; 3+ stays gold). **[decide]** expose
      two-colour identity as a picker choice or derive it from the cost.
      **Print review 2026-09-26:** two-colour BORDERLESS prints split the pinline too — the first colour left, the second right, on the title and type bars (all 7 checked: FRA #376, FRA #377, HOB #213, TLA #306, BLC #86, MH2 #321, FRA #461). `m15borderless` `m` is referenced to three-colour prints until this lands, and `m15borderlessartifact` `m` stays unverified (its only references are two-colour).
      **Card Conjurer audit 2026-09-25:** Resolve the [decide] with CC's `cardFrameProperties` (`creator-23.js`:577-755), ported as a pure, unit-tested function over the ten pairs × {gold, hybrid, land, artifact, vehicle}:
      - Pair order WU WB UB UR BR BG RG RW GW GU via `lib/cards/mana-order.ts`.
      - Hybrid = a `/` pip in the cost, with an override chip.
      - 2-colour gold: m frame, border and bars, with the pinline and text box split.
      - Hybrid: split frame, border and text box, grey (l) title/type bars, colourless P/T plate.
      - 2-colour land: l frame and bars, with an lX|lY pinline and text box.
      - 3+ colours: m / lm.
      Generate the split mask procedurally at 1500×2100 (ramp ≈41→61 % of width, ≈1 % slope), never from the 744×1039 file.
      (Reusable since #382: `twoColorFrameKeys()` in `components/cards/frame-layer.tsx` already orders a pair WU WB UB UR BR BG RG RW GW GU, and both renderers can draw a frame in two halves — FrameLayer clip-paths / the bake's `FrameSlice` — so far only for Dragon Wing's hard seam. The creator and AI fill still collapse two colours to "multicolor".)
      **Card Conjurer audit 2026-09-25:** Also drive `modern`/`modernland` (and 1997 gold) with the same two-colour logic: CC's `auto8thEditionFrame` stacks pinlineRight/rulesRight/frameRight on pack8th, and the Ravnica, Shadowmoor and Alara hybrids and golds were printed on the 2003 frame (critic).

      Crown = a family keyed by treatment:
      - Standard: CC `crowns/new/{w,u,b,r,g,m,a,l,c}` at 2.19/1.88/95.62×17.52, plus a black border cover 0–4.87 % H clipped to our rounded corners.
      - Floating + lower-cutout + outline for borderless, extended and showcase.
      - UB crowns (4.25); transform/MDFC crowns (5.1); Nyx/companion inner crowns at 16.37/2.49/67.31×2.27.
      - Colour follows the pinline letter, split for two colours; auto from Legendary, with an opt-out.

      Vehicle is a full treatment, not just a P/T box: CC `v.png` as the Frame + Border layers (colour or artifact bars stay), the `m15PTV` plate fitted to 4.18's plate box, white P/T ink, auto from the Vehicle subtype. Reference: Smuggler's Copter (KLD).

      Colour indicator: base at 7.67/57.48/4.67×3.34, the type slot indented when shown, 2–3 colours via CC's half/third masks, 4–5 colours drawn by us, the base redrawn as vector for 800 ppi.

      'Coloured-artifact blend' is replaced by 4.16, because the current blend is inverted. (4.16 shipped in #380.)
- [ ] **4.7 [P1] M15-era variants from CC**, in request-log order — extended
      art + borderless (replace the contradicted profiles), textless, full-art
      lands (generic first, per-set later), Nyx (fix), class, prototype,
      mutate, leveler, spree/companion/miracle/lesson marks, tokens + emblems,
      4-ability + compleated planeswalkers. Each ships through 0.9 → 2.2 → 2.4.
      **Card Conjurer audit 2026-09-25:** - **Borderless:** → 4.32–4.38, 5.7 (borderless research 2026-09-25: CC FullArtNew, `m15/new/fullart` 2010×2814, has an opaque black ring, so it is a black-bordered full-art frame, not borderless; every CC borderless pack is 1500×2100).
      - **Extended art:** from CC `m15/new/extended` (2010 px, includes c and v; art 0/8.39/100×54.37).
      - **Nyx (fix):** (owner decision A4 2026-09-29: until it ships, the signature registry keeps the 2015 starfield printings `nearest` M15 with `blockedBy` 4.7, and THS's 2003 Nyx `nearest` nyx; since A3 a creature borrows `nyx` for an Enchantment Creature, so `m15nyx` should be borrowed the same way) a new `m15nyx` skin of m15 from CC `m15/new/nyx` (normal cream text box, dark ink; c → a.png). Auto for Enchantment Creature/Artifact and for `frame_effects: enchantment` on non-showcase printings. Add a saga Nyx and a Nyx inner crown. KEEP the `nyx` template as the THB 'Constellation' showcase, which matches its references.
      - **Tall walker:** `m15pwtall` from CC PlaneswalkerTall (type y 49.67, rows from 55.81 at 8.96 %, symbol y 52.34), auto at ≥4 loyalty rows; Compleated as a skin on it.
      - **Case and Fuse (new):** Case (MKM) as the class column with `face_content.case = {text, toSolve, solved}`; Fuse (DGM) as a split skin with a full-width fuse bar. Class stores `face_content.class.levels`.
      - **Leveler:** via a `tiers` capability (shared with Station, 4.27).
      - **Saga creatures:** a P/T slot plus CC saga/pt plates (64 cards).
      - **Seeds:** class art 7.53/11.24/42.47×72.53, rail x 50.93 w 40.4, header bars 4.81 % H; leveler bands 63.03/72.29/82.2 (lower two indented to 20.67), P/T 65.91/75.24/85.15; prototype band 8.6/63.57/69.4×9.19, mana 63.81, white pt2 69.35; mutate art to 75.63, rules 75.67–91.82; miracle overlay 4/2.86/92×53.24.
      - 'Tokens' moves to 4.22 and 'emblems' to 6.4.
      **Full-art research 2026-09-26:**
      - "textless" → 4.37 (borderless) and 4.42 (black border).
      - "full-art lands (generic first, per-set later)" → 4.39 (generic), then 4.40–4.41 and 4.11's per-set line.
      - CC FullArtNew / M15ClearTextboxes / UBFull (a translucent box over the art) match no printed family → 4.44.
      **Token research 2026-09-29:** "'Tokens' moves to 4.22 and 'emblems' to 6.4" is out of date. Tokens are now 4.48–4.51, 4.53 and 3b.15, and emblems are 4.52 and 6.23. The token kind's Nyx is 4.51's dress, not this item's `m15nyx`.
- [ ] **4.8 [P1] Era typography** — Magic Medieval for 1993–2002 titles, Matrix
      Bold for 2003–2014, Beleren Small Caps for the artist, a Gotham-class
      font for the collector line; `font` on the profile; registered in the
      bake + `@font-face` in the browser (self-hosted, licence check like the
      current Beleren/MPlantin); parity tests.
      **Card Conjurer audit 2026-09-25:** Swap `public/fonts/Beleren-Bold.ttf` (the 2013 DelveFonts build, which has no terminal alternates) for the Beleren2016 build, with the same licence check. Substitute word-final f/h/m/n/k → U+E006–E00A in a shared `displayText()` for title, type and second-face bands in both renderers; Satori doesn't run GSUB `fina`. Checked on DMR Shivan Dragon and FDN Vampire Nighthawk. Use Beleren Small Caps for P/T, loyalty and token names (4.4), not only the artist. Re-measure title/type fit after the swap, and regenerate 3.20's metrics.
- [ ] **4.9 [P1] Collector info line + holofoil stamp** — card fields for set
      code, collector number, language (default EN), rarity letter derived;
      footer redesigned to the M15 layout (number, set • lang, artist brush
      glyph, © line) with the brand mark relocated; stamp overlay by rarity
      (oval; UB triangle on UB frames); Scryfall import fills set/number;
      editor fields on the Set icon step; both renderers; bump + rebake
      (bundle with 4.4).
      **Card Conjurer audit 2026-09-25:** The © line is the creator's own ('© {year} {display name}') or the PipGlyph mark, never Wizards of the Coast. CC stores that line in 31 packs, and its converter stamps it.

      CC seeds:
      - rarity + number line at 6.47 W, 93.77–95.48 H;
      - set • lang + brush + artist at 95.48–97.19 H, at 0.024 W;
      - © right-aligned to 93.54 W, 1.72 % H lower when a P/T is present.

      **Print review 2026-09-26:** on a borderless rare or mythic (18 of the 25 borderless references carry Scryfall's `security_stamp: oval`) the rules-box pinline ARCHES up ~40 px around the centred oval — x ≈ 656–850, top ≈ 1905 px against the straight pinline at ≈ 1945 on 1500 × 2100 (FRA #447, FDN #292). Card Conjurer's borderless master has a straight pinline and no notch, so this overlay must draw the arch as well as the stamp; commons and uncommons (INR #301, FDN #311) print it straight. Until then 0.9's score leaves the box out on the borderless templates (`HOLO_STAMP_ARCH`, `lib/frames/align.ts`).

      Stamps per family:
      - M15 43.6/90.34/12.8×4.58 (oval 45.54/91.72/8.94×3.2);
      - PW 43.94/90.15/12.14×5.1;
      - saga 43.8/91.2/12.4×3.72;
      - battle vertical 4.9/43.8/4.43×12.4.
      The notch follows the frame letter. UB triangle bounds are over 2010 (CC divides by 2015). The stamp assets are 1500-scale, so redraw them as vectors for 800 ppi.

      Also add: ★ (foil) vs •, zero-padded NNN/TTT, pre- and post-ONE layouts, and remember set/lang per user (4.14). P3 follow-up: an optional serial plate ('n / total', our own plate art) and a gold date-stamp line.
- [ ] **4.10 [P1] Old borders** — check whether CC ships 1997/2003 frames at
      high resolution; if not keep MSE's 375 px for classic/retro/modern
      **[decide]**; complete their references (all seven colours, lands,
      tokens), apply 4.8 fonts, verify + publish. Future Sight stays "Soon".
      **Card Conjurer audit 2026-09-25:** Resolve the [decide]; this revises the owner's MSE-for-old-borders choice, which 4.10 left conditional. CC ships Seventh (1997) and 8th (2003) at 1500×2100 with real extra detail over our 375 px MSE (detail metric 7.67 vs 1.81 and 4.67 vs 2.33).
      - Source retro/retroland from CC Seventh and modern/modernland from CC 8th after an auto-score. CC's 1997 white frame is lighter than MSE's, so score it first.
      - Take the coloured lands, The Dark land and 8th's multicolour land from the same packs.
      - Keep MSE agclassic (CC ABU gains nothing), with CC Legends Multicolored for Alpha `m`.
      - Add a white-border option (Fourth/Fifth/Seventh) as a border overlay.
      - 1997 tokens come from CC `token/old` (has c).
      Needs 4.23 (text treatment) and 4.24 (original pips).

      P3: a 1997/2003 layout matrix — compare CC's community-made 1997 planeswalker/saga frames (`packPlaneswalkerSeventh`, `packOldSaga`; custom designs, not printings) with MSE's (critic correction): `magic-new-planeswalker(-4abil)`, `-split(-fuse)`, `-flip`, `-leveler`, `-doublefaced`, `-token`, `-emblem`, and `magic-old-split/-flip/-token`.
- [ ] (partly 2026-09-25: of the 12 contradicted profiles, tarkirdragon was re-measured on MUL #1/#60 with its own P/T plate (#381) and tarkirghostfire rebuilt with translucent boxes + P/T ribbon (#382); tarkirdraconic's white-on-parchment P/T now sits on MSE's serpent-ringed plates in black ink (4.31, wf/r5-stats). The other 9 profiles, per-set basics and new families are open) **4.11 [P1] Showcase families from MSE (744–750 px)**, in request-log
      order — re-measure the 12 contradicted profiles from scans (lotr,
      lotrscroll, avatar, bloomburrow, bloomanime, tarkir ×3, expeditionland,
      fullart, m15textless ×2), then per-set full-art basics and the
      most-requested families of the last three years (the pack holds 40+ at
      hi-res). Each family gets its own reference printings.
      **Card Conjurer audit 2026-09-25:** Reword to 'Showcase families from the best source': CC ≥1500 px where it exists, else MSE 744–750 **[decide]**; this revises the owner's MSE-for-showcase choice.
      - CC is sharper for lotr, lotrscroll (2010 px), the THB Nyx showcase, fullart (ZNR), extendedart, m15textless and expeditionland. The gain is large for ZNR, expedition and Nyx, small for lotr.
      - MSE stays for everything after June 2024 (BLB, Avatar, Anime, TDM) and for families CC lacks.
      - The backlog is the union of CC and MSE families, with the source tagged in 4.1. CC-only: Oil Slick, three Storybooks, Tarkir Sketch (MOM). In both: Ixalan coin, D&D.

      Re-measure seeds:
      - expeditionland: type 8.54/81.96/82.92×5.43, rules 9/59.96/82×20.72, symbol 92.14/84.39;
      - fullart: type in the M15 row at 56.43 (white), rules in the M15 box, art 6.2/11.29/87.6×80.96;
      - m15textless: type on the 81.96 row;
      - lotr: art ≥9.8/11.2/80.8×44.5;
      - lotrscroll: full-bleed.

      Per-set full-art basics: CC for ZEN/THB/SNC/NEO/UB/2022/snow/UST/UNH, MSE for DFT/AFR/LCI/ONE/UNF, with one shared full-art land profile per layout family. Borderless basics (89: SLD 39, UNF 15, FRA 15, EOE 10, UST 5, ONE 5) join this line; they are one-off designs, not a new frame (borderless research 2026-09-25).

      Masterpieces in request-log order, Mystical Archive first (CC 2010 px, plus JP); then Inventions, Invocations, nonland Expeditions, Praetors, Signature Spellbook and promo tall-art.
      **Borderless research 2026-09-25:** Borderless showcase families by volume (survey, per-set counts not re-verified): ONE ink 85, WHO 73, OTP 65, MUL 63, WOT #1–63 63, LTR 60, BLB 55, TDM clan 50 (→ 4.36), ECL 50, HOB 50, ACR 33. Also EOS Stellar Sights 180 (MSE `magic-m15-showcase-eternities-stellar-sights`) and Mystical Archive 321 (already listed above). The "re-measure the 12 contradicted profiles" step keeps the geometry work; 4.35 takes the border/edge half.
      **Full-art research 2026-09-26:** (the CC re-sources in (i) and (ii) follow this item's open CC-vs-MSE **[decide]** above; the owner's 2026-09-24 choice was MSE for showcase families.)
      - **(i) `fullart` (ZNR showcase).** The seed "type in the M15 row at 56.43 (white), rules in the M15 box, art 6.2/11.29/87.6×80.96" is CC FullArtNew's geometry, not ZNR's. Applied, it would push the art below the title bar.
        - Re-source from CC ZendikarRising (`packZendikarRising.js`, `groupShowcase-5.js`:42): `m15/zendikarRising/m15ZendikarRisingFrame{W,U,B,R,G,M,A,L,C,CAlt}.png` plus the Title, Crown and PT pieces; 1500 px; black ring.
        - Geometry:
          - art 4/2.86/92×86.48;
          - title y 5.22, white;
          - type 8.54/56.64, white with a shadow;
          - rules 8.6/63.03/82.8×28.75, white;
          - set symbol centred at y 59.10.
        - Why: today's profile prints the type at 73.6 % H, inside the box, and leaves the painted bar at 56.4–62.7 % empty (bake D vs ZNR #293).
        - Our MSE master also lacks the hedron layer: `build-variation-frames.mjs`:118-122 copies `{k}card.png` and never composites MSE's `back/{k}card.png`.
        - It is not full art. The set and label change in 0.26.
      - **(ii) `expeditionland`.** Every reference is ZNE 2020 (Ancient Tomb, Cavern of Souls, Grove of the Burnwillows, Creeping Tar Pit). But the master is MSE's 2015 BFZ design (375 px JPG ×4) with an opaque black box and light ink, while ZNE prints dark ink on a light translucent panel.
        - Re-source from CC ExpeditionZNR-1: `expedition/znr/expeditionNewFrame{W,U,B,R,G,M,L,C}.png`; art 4/6.67/92×74.91, rules 10/56.48/80×25.05, type y 81.96, set symbol centred at y 84.39.
        - Add EXP (BFZ 2015, 45 printings) as a skin from CC ExpeditionBFZ-1: art 7.54/11.1/84.94×69.91, rules 9/59.96/82×20.72. The seed listed above is this BFZ geometry, so use it for the EXP skin only.
        - Expeditions are masterpieces, never `full_art`. The b/g master defect is in the 4.35 amendment.
      - **(iii) Per-set full-art basics, with the sources found in the pinned CC tree:**
        - SNC → CC `packTextlessBasicsSNC` (used by 4.40);
        - NEO (10, Japanese only on Scryfall) → CC `packNeoBasics` (`neo/basics/*.svg`, vector);
        - UST (5) → CC `packUnstable`;
        - UNH (5 + PLST 1) → CC `packUnhinged` (`textless/unhinged/*`, 1500);
        - LCI (5), UNF (15 borderless + 5 black) and ONE #365–369 → MSE `magic-m15-ixalan-full-art-basics`, `-unfinity-full-art-basics`, `-phyrexia-full-art-basics` (744 px);
        - UGL / UND (5 + 5 + PLST 1) → MSE `magic-old-unland` only (333×465) → Soon;
        - MID/VOW dark bars (25) → derived from 4.40;
        - EOE (10) → per-set; nearest `m15textlessland` (1.17 amendment);
        - SLD black (112) and borderless (39) drops → `nearest`.
      - **(iv)** The seed "m15textless: type on the 81.96 row" is obsolete: textless frames print no type line (3.24).
- [ ] **4.12 [P1] Verification throughput** — auto-score every colour of a
      template in one job, batch by treatment (once the treatment PNG is
      aligned for one kind, kind overlays inherit the measured slots), sign-off
      per template.
- [ ] **4.13 [P2] Frame picker redesign for 35+ frames** — grouped by era/
      treatment, search, "recently used", "matches your import", thumbnails at
      the card's colour (small thumb variants from 4.2).
- [ ] **4.14 [P2] Frame + treatment presets** ("save this setup", last used per
      user).
- [ ] **4.15 [P3] Future Sight era; Un-set/acorn treatments; oversized
      Planechase/Archenemy.**
      **Card Conjurer audit 2026-09-25:** Add, in request-log order:
      - Vanguard (hand/life modifier slots);
      - Conspiracy (Draft Matters stamp as an m15 treatment);
      - Attraction (light row);
      - Scheme (MSE `magic-archenemy`);
      - Planechase with CC's six text heights chosen by rules length;
      - Dungeon (needs a room-graph editor) last.
      Future Sight: CC's art is also 744 px, so take whichever of CC and MSE scores better.
      **Card Conjurer audit 2026-09-25:** (critic, P3) Also: Playtest (Mystery Booster), Colorshifted / Planar Chaos, Full Text (no art), "The List" stamp, Nyx tokens, Jumpstart front cards. CC's Flesh and Blood and Pokémon groups are out of scope.
      **Token research 2026-09-29:** "Nyx tokens" is 4.51.
- [x] (shipped in #378 (recipe) + #380 (live, layout v24 sweep): m15artifact and m15tokenartifact are CC's artifact frame + border with the colour's pinline/title/type/rules and the colour P/T plate; checked against Phyrexian Metamorph and in the owner's side-by-side. Left for later: two-colour artifacts still use the gold `m` frame until 4.6; the stale "colour border + silver interior" descriptions remain in `types/card.ts`:272-274, the `m15artifact` note in `lib/cards/frame-references.json` and the `scripts/build-artifact-blend.mjs` header, now a dead script for this template) **4.16 [P0] Coloured artifacts: artifact outer frame, colour interior (CC's recipe)** (Card Conjurer audit 2026-09-25) — Every coloured `m15artifact` frame is inverted today (verified, all 7 colours in `supabase/seed.sql`). `scripts/build-artifact-blend.mjs` gives the colour's outer border with a silver title bar and text box: sampled `public/frames/m15artifact/r.png` has a red side (202,82,41) and a silver title (203,212,217). Real Embercleave (ELD) and Phyrexian Metamorph (2XM) scans have a silver artifact outer frame (side 209,226,246 / 167,173,195) with colour-tinted type bar and text box. Cursed Mirror and Esper Sentinel match. That is exactly CC's `cardFrameProperties` + `autoM15NewFrame` (`creator-23.js`:577-747,1038-1110).

      Build m15artifact in the 4.3 importer:
      - `new/a.png` through the Frame + Border masks.
      - `new/{colour}.png` through the Pinline + Title + Type + Rules masks.
      - The colour P/T plate.
      - 2 colours per 4.6 (split pinline/rules, gold bars unless hybrid); 3+ colours → m.

      Build m15tokenartifact the same way with the token masks. The scratchpad prototype importer (silver base + colour only through the pinline mask) is also wrong.

      Fix the wrong description in the build-script header, `types/card.ts`:272-274 and the `m15artifact` note in `lib/cards/frame-references.json`.

      Acceptance: re-score every colour against Esper Sentinel, Phyrexian Metamorph and Embercleave. Ships inside the 4.4 bump as a platform correction (0.20).
- [x] (shipped in #380, layout v24: `FrameProfile.underFrameArt` + `underFrameArtRect()`, both renderers; on m15devoid (all colours), m15 `c` (CC's see-through Eldrazi frame) and m15token `c`; m15devoid has its own profile and CC's devoid P/T plate; the [decide] went to CC's translucent colourless (owner). It uses one rect inside the black border (4/4/92×92) for all three, not CC's devoid bounds from 10.39 %H, as signed off in the side-by-side) **4.17 [P1] Art under the frame for translucent frames (devoid, CC colourless)** (Card Conjurer audit 2026-09-25) — The m15devoid frames (verified, live) are translucent: type bar α≈204, text box α≈188, sides α≈34. But art is drawn only inside the inherited M15 `artSlot` over the #101015 ground (`lib/render/card-image.tsx`:285,291; `components/cards/card-preview.tsx`:627-631; `M15DEVOID = …M15`, `lib/cards/template-layout.ts`:554). So the text box renders flat grey and the side strips near-black, where print shows the art through them (Kozilek's Channeler, Introduction to Prophecy). CC's `m15/new/c.png` ('Eldrazi') is equally see-through (α 212/179/26).

      Fix:
      - Add a profile capability `artUnderFrame`: colours 'all' on m15devoid. For m15, use ['c'] only if the owner picks CC's translucent colourless **[decide]**; otherwise keep an opaque c. It draws the art over CC's devoid bounds (4 / 10.39 / 92 × 89.61, clipped to the card) beneath the frame in both renderers, with `artSlot` kept as the crop/focus hint.
      - Give m15devoid its own profile and CC's devoid P/T plate (= m15PTC).
      - Check rules/type legibility in the compare tool and re-verify all colours.

      Ship before or with 4.4.
- [x] (shipped in #380, layout v24: `StatSlot.plateRect` in both renderers; the M15 plate 75.73/88.48/18.8×7.33 and value 79.28/90.2/13.67×3.72 with `valueDyEm` −0.04, inherited by every profile that spreads M15 (14 templates incl. adventure, extendedart, fullart, nyx), plus own plates on tarkirdragon/tarkirghostfire (#381/#382) and the planeswalker shield. Left for later: `plateRect` is NOT in the profile-override zod schema (`lib/cards/profile-override.ts`), so the compare tool can't nudge a plate; vehicle / token / saga-creature plates come with 4.6 / 4.4's token fixes / 4.7) **4.18 [P1] Separate the P/T plate box from the value box; CC plate geometry for the M15 family** (Card Conjurer audit 2026-09-25) — The M15 plate (540×304, core aspect 2.03) is object-fill stretched into `pt.rect` 73/89.3/23×5.8 (`lib/cards/template-layout.ts`:330-340; `lib/render/card-image.tsx` ~1389, `components/cards/card-preview.tsx` ~1147). Its core lands at 75.0–95.8 W × 89.3–93.9 H (aspect ≈3.2). The printed plate sits at ≈77.9–94.2 × 89.1–94.6 (DOM Serra Angel). Every profile that spreads M15 inherits the stretch, and CC's plate can't be dropped in without the same distortion.

      Fix:
      - Add `StatSlot.plateRect`, also in the profile-override zod schema.
      - M15 family: plate 75.73/88.48/18.8×7.33 (CC `packM15RegularNew.js`:3, m15PT*.png), value 79.28/90.2/13.67×3.72; retune `valueDyEm` on the Serra Angel scan.
      - The same field serves the vehicle plate (4.6), the token plate (4.4) and saga-creature plates (4.7).

      Ship as a platform correction bundled with 4.4 (0.20).
- [ ] (partly 2026-09-25: #380 draws CC's own shield cut from each master (`plateRect` 79.6/87.667/16×7.333, above the stripes, so no double rim) with the loyalty value in CC's box 80.6/90.2/14×3.72 at 0.052 W, white; #382 lowered the name (top 4.18) and pips (`costDy` 0.004) into CC's taller title bar and gave each stripe its own foil sheen. Layout v29: rows sized by their text (3.13) and the LAST ability wraps short of the starting-loyalty shield when its text, at the row's full width, would reach it (`loyaltyShieldRect`: the loyalty plateRect, else its rect; `lastRowInsetPct`, both renderers; the stripes and foil keep the full row). Otherwise the last row keeps the full width and wraps as before (owner decision 2026-09-26: Coden's −2 and Miner's −11 keep their lines, no word left alone). "Would reach" is read from where the lines really break — MPlantin's advances in the preview's and the bake's wraps (`lib/cards/rules-metrics.ts`, 3.20) — since the rows' height estimate puts every last row's text below the shield's top. Nothing sits under the shield on the 84 walkers checked (HD and 750 bakes, the Chromium preview); 31 of them narrow, and all 7 public walkers keep the full width. Still open: the badge rail (x 2.8, w 14.14, per-shape heights), ability text from 18.0 / 13.6 W, CC's row starts, neutral stripes with soft seams, title/type sizes (4.20), symbol, two-line footer, and the Gideon BFZ / Karn DOM parity check) (Layout v33, 2026-09-28: the rows' text is laid out by the rules layout at a 64 px ceiling with the anatomy — badge, rail, padding — held at one size, `LOYALTY_ROW_SIZE_PX` 46, so the text starts at the prints' x 275; the print re-source below still owes the badge shapes, CC's rail and row starts, and condensed walker text at ≈ 0.93 em leading — 3.30.) **4.19 [P1] Planeswalker anatomy on the profile (with 4.4)** (Card Conjurer audit 2026-09-25) — On m15pw (verified), the cost badges sit inside the rules rect at ≈10.3–20.5 W (`badgeW = 2.3×size`; `lib/render/card-image.tsx` ~1169, `components/cards/card-preview.tsx` ~1796), and every ability's text starts at ≈22.7 W. Print (Gideon BFZ) and CC straddle the frame edge (`versionPlaneswalker.js`:168-188, `packPlaneswalkerRegular.js`:37-41). `loyaltyRows` holds colours only (`lib/cards/template-layout.ts`:455-469).

      Put the rail on the profile, with CC's values:
      - Badges: x 2.8, width 14.14 W; heights + 7.24 / − 7.05 / 0 6.1 % H; numeral 0.04 W centred at 10.27.
      - Ability text from 18.0 W (static abilities 13.6) to 92.67; rows from 62.39 H in 9.72 % steps (or CC's per-count centres), heights from 3.13.
      - Stripes: neutral white α0.61 / #a4a4a4 α0.71 with soft 0.48 % H seams across 11.67–92.61 (today cream α0.78 with hard edges).
      - Title/type 0.0533/0.0454 W in 8.67/3.72 and 8.67/56.25 (82.67×5.48); symbol right edge 92.27, centred 58.91; two-line footer (artist line ≈96.3 H).
      - Loyalty value 80.6/90.2/14×3.72 at 0.052 W, white.

      When the frame paints its own shield (CC planeswalker), drop `plateAssetPathTemplate` (:478-487), or two rims stack.

      Acceptance: both renderers plus a parity test; verify on Gideon BFZ and Karn DOM.
- [x] (done 2026-09-28 — feat/m15-text-sizes, layout v32; **owner round 8, 2026-09-28: all four sections approved; planeswalker cost box 15 px right KEPT (matches prints), long names shrink to fit KEPT (whole name rather than "…"), set symbols ship as built with the per-set print-size table next (4.46)**; "sweep", template-scoped to the FROZEN `V32_M15_FAMILY_TEMPLATES` (every card on them re-bakes; no card predicate), verification-neutral (owner decision 2026-09-28: the round-8 print sign-off stands in for re-ticking): the 23 M15-era templates (`lib/cards/m15-family.ts`; split and battle are out, see 4.21) print names at `TITLE_SIZE_PCT` 0.0533 W (75 → 80 px at HD on M15) and type lines at `TYPE_SIZE_PCT` 0.0453 W (65 → 68 px), from `lib/cards/typography.ts`. Each grown front-face slot keeps its baseline (`TextSlot.dy`, the text only — rects, pips and the set symbol stay where they were verified; second faces and the adventure panel stay centred), and a line the fit shrank keeps its band's baseline too (`slotTextDy`); CC's type-line print correction (4.2 px up at HD) only on the CC-framed profiles on M15's bar; the planeswalker's type line takes M15's slot and its name stays centred on its plate (v27); the token's type band is centred on CC's pill (82.6 → 82.14 %H, its text's dy keeping the baseline) so the 86 px symbol sits in the pill, not on its bevel. Planeswalker, saga and flip pips at M15's `COST_DISC_PCT` 0.0485; the walker's cost box ends where the printed pips do (92.2 %W, 15 px right of v31's — a pip move for the round-8 sheet) and its name runs to one band gap before the first disc (`DETACHED_COST_GAP_PCT` = `BAND_GAP_PCT`, re-tuned against print): Chandra, Torch of Defiance 78 px like KLD #110, Gideon / Karn / Liliana / Kaya 80, Nissa (WAR #169) 75 and Tezzeret (WAR #275) 72 where the prints set ≈ 79 — our Beleren runs 4–7 % wider on those (4.8). Names and type lines fit the room their band really leaves (`fit: "measured"`: `fitTitleBand`; `fitTypeLineBand` at `MEASURED_LINE_FIT_SAFETY` 1.015 up to `TYPE_SYMBOL_GAP_PCT` — the prints' 20 px — before the set symbol's ink as drawn, the inline symbol pulled over the band gap by `inlineSymbolPullPct`, a planeswalker's `symbolRect` included); past 5 pt of the card's orientation the helper cuts the line with ONE "…" that both renderers draw, and the span carries the room as its max-width; the bake sets a shrunk line at `measuredLinePx` (the whole px below its fit, never below the floor's own px) and the preview shows the stored HD bake's px (`measuredLinePreviewPct`). Flip's upside-down face and the adventure panel fit too; the full-art basics keep their print-verified slots and the old fit. The set symbol sits in CC's box (`SET_SYMBOL_BOX_PCT` 0.0574 W = 86 px; 0.0533 on planeswalker and saga): the default mark and an uploaded icon 72 → 86 px, a Keyrune glyph fitted by its ink on the family only (`setSymbolFit: "ink"`, code-owned; `lib/cards/set-symbol-size.ts`, `lib/cards/keyrune-metrics.ts`) — compact and medium glyphs 0.83–1.07 of the print, wide ones 0.51–0.62 (4.46). On the full-art basics the mark and an icon go 97.5 → 86 px and compact glyphs refit to their ink (DOM 97.5 → 87 px font, ONE 94, ZNR 86); only a wide glyph (M20) bakes as before. The bake paints the rules backdrop under the title and type bands, as the preview layers it (on Expedition it dimmed the bigger symbol). Rules text is untouched (3.29). Review round (parity, print, scope; 2026-09-28): the one-pip walker name the bake cut with Satori's own "…" ("First Lig…") is drawn whole in both renderers at 750 and HD; floor-length type lines no longer run under a planeswalker's or devoid's symbol; all 19 mutations of the review fixes fail a test (`tests/unit/render/m15-fit-review-bake.test.tsx`, `second-face-fit-bake.test.tsx`). Scope proof (df4f3d7 vs v32: real bakes over the sha-verified bucket frames — the 731 cached public cards at 750 and HD, and a 1,519-card template matrix at 750 with the default mark, DOM, M20 and an uploaded icon): every card outside the family, split and battle included, is byte-identical; every family card changes only inside its title band (the cost box included), its type band and the set-symbol box, and the rules text is byte-identical everywhere. On the public cards 59 names shrink and none is cut (all 31 that ellipsized at HD print whole; the smallest, Vinnie 'Goldfang' Lupo, at 46 px of 80), and 77 type lines shrink (106 in the first cut; v31's estimate shrank 111), none below its v31 size. Owner steps: the round-8 sign-off (below); confirm in admin, right before merge, that no `frame_profile_overrides` row exists on any template (an anonymous read on 2026-09-28 returned none); the private-card count per family template; merge only after the v31 sweep reports done with 0 failed, then the v32 sweep. **Round 8 sheet** (things the owner decides by eye): the planeswalker pips 15 px right of v31 (onto the prints' 1380–1383 px) beside a print; Chandra at 78 px and Nissa / Tezzeret below their prints; 12 public names now print smaller than their own type line (Vinnie 'Goldfang' Lupo 46 px, Avatar Aang // Aang 47, Beanstalk Giant // Fertile Footsteps 51, Takeda 54, Tobirama Senju 56, Kragul 57…) — shrink, or a floor above the type size and then "…"; saga's type line on its old baseline sits top-heavy in its bar at 68 px (20 / 40 px of air vs the print's 22 / 31; the +0.0065 W print offset is 4.21's); a full-art basic with a DOM / ONE / ZNR glyph beside its print; the token symbol on the pill; Expedition's light name on its light title bar (unchanged, 4.21). The body below is the 2026-09-25 audit as it stood; its sizes are the v31 ones.) **4.20 [P1] One M15-era title/type size across layout templates** (Card Conjurer audit 2026-09-25; **owner 2026-09-27, round 6: schedule it as its own sweep after #389 ships, after 3.26**) — CC uses 0.0381/0.0324 of card height (= 0.0533/0.0454 W) on every M15-era frame. Our MSE-derived profiles print names 5–25% and type lines about 20% smaller than our own scan-measured m15 (0.05/0.0435 W):
      - m15pw/saga/flip: 0.0427/0.0347 (`M15PW`, `SAGA`, `FLIP` in `lib/cards/template-layout.ts`).
      - aftermath: 0.04/0.0347; second face 0.038/0.028 (`AFTERMATH`) — already stale at the audit: `AFTERMATH_TEXT` had been M15's 0.05 / 0.0435 since v29.
      - split: 0.0287/0.02; battle: 0.034/0.025, both landscape (`SPLIT`, `BATTLE`).
      - adventure panel: 0.032/0.0255 (CC 0.0414 W) (`ADVENTURE.adventure`).
      - token type: 0.034 (`M15TOKEN`).

      **Print review 2026-09-26** (35 borderless prints + 7 black-bordered M15 controls, FIN #18 · EOE #30 · TLA #71 · SPM #88 · SPM #119 · TLA #112 · DOM #33): on M15 and everything that spreads it the name prints 0.935–0.953 of the print's width with caps ~4 px short (baseline exact), the type line 3–5 px low and ~5 % narrow, and the set symbol at 0.66–0.75 of the printed height (`type.sizePct × 1.1`; fit it to `symbolRect`, CC's 0.12 W × 0.041 H box, or `symbolSizePct` ≈ 0.065). CC's sizes (title 0.0533 W, type 0.0453 W) with the type rect ~0.2 % H higher close it — the full-art basics took exactly that in 4.39. Do it for the whole M15 family in one sweep, never as a borderless-only override (bordered and borderless M15 would diverge).

      Add shared `TITLE_SIZE`/`TYPE_SIZE` constants, with landscape profiles scaled to the same absolute size and the fit ladder shrinking long lines. Re-check after 4.8's Beleren2016. (Bundling the bump with 4.4 was superseded: 4.4 shipped as v24, and round 6 made 4.20 its own sweep after v31.)
- [ ] (Saga, layout v33 — owner decision 2026-09-28, correctness only: the rail's intro and chapter text are drawn as the rules layout's lines at v32's sizes, rows and badges. Left for this re-source: the print anatomy — one hex badge per chapter straddling the rail's left edge, 7.5 pt chapter text, rows sized by their text — and a chapter text too long for its equal row, which still clips inside the row.) **4.21 [P1] Re-source the M15 layout templates (saga, battle, adventure, split, flip, aftermath) from CC** (Card Conjurer audit 2026-09-25) — All six are 241–375 px MSE sources (`scripts/build-split-frame.mjs`:28, `scripts/build-flip-frame.mjs`:18, `scripts/build-aftermath-frame.mjs`:20, `scripts/import-mse-profiles.mjs`:37-42). CC has all six at 1500×2100 (battle 2814×2010) with text bounds. The owner's 'CC for the whole M15 era' covers them, but 4.4 doesn't list them.

      Run the 4.3 importer over CC Saga, Battle, Adventure, Split, Flip and Aftermath:
      - Keep the split/aftermath half masks and adventure page masks as overlays (for 4.26).
      - Rotate CC's portrait split 90° CW into our landscape profile and measure the second art windows CC never declares (`packSplit.js`:19).
      - `c` has no CC master in Saga/Adventure/Split/Aftermath; substitute via the manifest.

      Seeds (CC → our %):
      - Saga: art 50.0/11.24/42.47×72.53, type 8.54/84.81/82.92×5.43, symbol right 92.27 / centre 87.39.
      - Battle: art 7.95–97.14 × 4.0–95.4, title 18.43–92.1 × 5.4–13.0, type 12.76–92.14 × 58.2–65.8, rules 12.95–92.05 × 67.2–94.8, grey back-P/T line 12.24–91.62 × 81.27–84.13, defense value 91.43/88/4.1×8.2. CC paints the shield, so drop our drawn badge.
      - Split: windows 10.24–48.95 / 55.9–94.57 × 15.93–53.0, rules 60.87–95.07.
      - Flip: the lower half is ≈4 % H higher, so re-derive FLIP from `packFlip.js`:37-55 (symbol right 78.4 / centre 26.0).
      - Adventure: name/type 0.0414 W at 63.91/68.39, both pages end at 88.58 H to clear the P/T.

      Interim fixes while still on MSE:
      - Battle's PNG has no border, so everything outside the art band shows #101015: make the artSlot full-bleed and move the title left edge to ≥17.4 %.
      - Split art top 14.7 → 13.4 (1.2 % H gap).
      (Neither interim fix is applied at `267f46c`: battle artSlot is still 13.6/4/92×43.6 with the title at 12.8 %, and split art still starts at 14.7. #381 only moved their brand marks.)

      Verification: saga is verified in production and must be re-verified. The other five get their first verification this way (0.9 → 2.2 → 2.4). Same bump as 4.4 if timing allows.

      **From 4.20 (layout v32, 2026-09-28):**
      - **Split and battle are not in v32** (owner decision): they bake byte-identical to v31 and take the family's sizes here, each with bar-centred checks. Split: title `displayPct(TITLE_SIZE_PCT, "landscape")` = 0.0381 L (80 px at 2100), type 0.0286 L (60 px, CC's thin split bar) on both halves, pips 0.0344 L as today, `fitLines` on the second face (and the bake's name–cost gap there). Battle: title 0.0381 L, type 0.0324 L, and pin `costSizePct` 0.034 L (today's 71 px disc — unpinned it follows the name to 80 px). Then add both to `M15_FAMILY_TEMPLATES` with the `fit: "measured"` flag, which also ends the portrait 5 pt floor that clamps their type lines UP to 58 px at 2100 wide.
      - **Their slots sit off the MSE masters' bars** (measured 2026-09-28): split's type rect (56.3 %, 844–907 px) centres 20–25 px below the painted bar (≈ 812–890, light interior 817–879), so 'Instant' sits on the bar's bottom edge — move its centre to ≈ 851 px (top ≈ 54.6 % L); split's title rect centres at 152 px against the bar's ≈ 127. Battle's title rect starts at 12.8 % L (269 px), about 90 px left of the painted pill (361 px): left ≥ 17.6 % L (3.28).
      - **Saga** kept its baselines in v32: the name is on the print's (184.7 vs 185 px at HD), the type line about 9.5–10 px above it (1846 vs 1855.5 px; DOM #21 / #90 / #122). Apply the measured +0.0065 W type offset (≈ +10 px) with the re-source: at 68 px on the old baseline the line sits top-heavy in its bar (20 / 40 px of air above / below vs the print's 22 / 31).
      - **Flip's** upside-down type bar (68 % W, beside the P/T) is short for the M15 type size: 'Legendary Creature — Spirit Monk' fits it at about 63 px, not 68.
      - **Tokens** (4.4): the DOM token type pill prints its baseline at 1799.9 px, ours at 1796.6 — 3 px higher; v32 kept ours, and centred the type band (and so the 86 px set symbol) on CC's pill (82.14 %H; interior 1716–1822 px at HD).
      - **Expedition** (MSE-framed): its name prints light ink on a light title bar (nearly invisible), and its type line's descenders cross the bar's lower edge — both as before v32.
- [ ] **4.22 [P1] Token text-length family (tokens with abilities)** (Card Conjurer audit 2026-09-25) — Our m15token/m15tokenartifact is CC's 'Textless (Bordered M15)', which CC files under 'Older Tokens' (`groupToken-2.js`:2-15). Token abilities are printed on a 50% black scrim over the art (`lib/cards/template-layout.ts`:518-528). No printed token looks like that, and 490 of 821 `t:token` cards have rules text (Treasure, Food, Clue, most UB tokens).

      Add CC's current full-art token family as `m15token` variants: token/textless, short, regular and tall, each with w/u/b/r/g/m/a/l + frameC + snow.
      - Pick the variant from rules length: none → textless, 1–2 lines → short, 3–4 → regular, more → tall. Manual override under Variations.
      - Seeds: art 4/2.86/92×89.53; type y 81.96 / 67.8 / 65.0 / 56.64; rules 71.43–91.91 (regular) and 63.03–91.78 (tall); P/T 79.28/90.2.

      Also add a bordered text-box variant from token/m15/regular, so today's arch look has an abilities version: art 12.48–63.91, type 65.0, rules 8.6/71.43/82.8×20.48, symbol centre 67.43.

      Delete the scrim. Import picks the variant from the Oracle line count. References: Treasure (txln) and Treasure (tmsh). **[decide]** which family is the default token look.
      **Full-art research 2026-09-26:** the 171 M15 full-art tokens (T2XM #4, TM20 #2) already resolve `exact` on `m15token` (CC 'Textless (Bordered M15)'), so there is nothing to build for them. The 80 2003-era full-art tokens are 4.43.
      **Token research 2026-09-29:** superseded by 4.48 (the full-art family) and 4.49 (`m15tokentext`, the bordered text-box variant). The pack mapping is off by one: CC's 'Short' pack is the printed regular box, and CC's 'Regular' matches no print (0 of 116 measured). CC's 'Regular (Bordered M15)' also sits ~3 %H above the prints (4.49). Its "Full-art research" paragraph is wrong: T2XM #4 and TM20 #2 are the M20 design, `nearest` on `m15token` until 4.48 (1.23). Its open decision (the default token look) is answered in 4.48: owner 2026-09-29, new tokens default to the full-art family once it is verified.
- [ ] (partly 2026-09-25: the mechanism shipped in #382 (layout v27) as `inkByColorKey` on TextSlot/StatSlot (`slotInk()` / `footerInk()`, both renderers; per-colour ink + shadow, emboss in em) and 4.31 extended it to the title and type line (`bandTextStyle()`); the 1993 half is done (below). Still open: 1997 retro/retroland white title, type line, P/T + artist with a black drop shadow and the centred `Illus.` footer, and the 2003 footer ink per colour (white on black, land and colourless)) **4.23 [P1] Era text treatment (1993/1997/2003)** (Card Conjurer audit 2026-09-25) — 1993 (Alpha) is done (v25/v27 and 4.31): agclassic letters the P/T and artist line in embossed silver on every frame colour but white, and the name and type line too on the black frame and the colourless artifact card (owner decision 2026-09-25; dark elsewhere, where the silver read no better), alphaland its P/T and artist line on every key (`ALPHA_INK` / `ALPHA_BAND_INK` / `ALPHA_LAND_INK` in `lib/cards/template-layout.ts`); alphatoken is ours (Alpha printed no tokens) and keeps its own light-on-dark name. The 1997 profile (RETRO) still prints title, type, P/T and artist in dark ink, and its comments claim printed P/T is dark, which is wrong. Real 1997 cards (LGN White Knight, SCG Enrage, TOR Shambling Swarm) print them white with a black drop shadow, even on white cards. The 1997 footer is a centred `Illus. <artist>` over the © line. The 2003 footer is white on black, land and colourless frames (CC `pack8th.js`:55-68), but ours (MODERN) is dark for every colour.

      Fix:
      - Use the per-frame-colour `inkByColorKey` Alpha already uses (a colour + shadow per key, honoured by `slotInk` on stat slots, `footerInk` on the footer and `bandTextStyle` on the title and type line, identically in both renderers) for the 1997 and 2003 profiles.
      - Apply these with 4.8's era fonts.
      - Check against the registry scans for retro and modern (agclassic is done).

      This blocks a correct 4.10 publish. The only published old-border combo (modern/w) is already right.
- [ ] **4.24 [P2] Per-frame pip style (`symbolStyle`)** (Card Conjurer audit 2026-09-25) — Add a profile/manifest field `symbolStyle` (`modern` | `original` | family-specific) that both renderers resolve for costs and rules text. No such field exists today (`lib/cards/template-layout.ts`:102-200; `lib/pips/override.ts` is owner overrides only).
      - `original` applies to agclassic/alphaland/alphatoken only. CC uses old symbols only for ABU/Legends (`packABU.js`:44,47); 1997/2003 keep modern pips, as now. Use mana-font's `ms-w-original` plus the era tap glyphs (`ms-tap-3ed`/`-4ed`/`-alt`) with no disc shadow. mana-font has no u/b/r/g originals, so redraw them or import CC's `img/manaSymbols/old` after a licence check.
      - Family styles (Future Sight, Oil Slick, Mystical Archive JP, outline) ship with their family in 4.11/4.15 as overlay pip sets.

      Ship `original` with 4.10.
- [ ] **4.25 [P2] Universes Beyond frame family from CC** (Card Conjurer audit 2026-09-25) — CC's Accurate UBNew (2010×2814) is the streaked UB frame printed 2020–2025 (e.g. the 40K Sister of Silence scan). It is a skin on m15/m15land geometry. CC also has UB full art, UB extended, UB saga, UB spree, UB crowns and floating crowns, and per-colour triangle stamps (`img/frames/m15/new/ub/stamp`). MSE has UB only at 375 px. No PipGlyph template exists (`types/card.ts`:296-337).

      - Import as `TEMPLATE_SKIN_VARIANTS` of m15 and m15land through 4.3. Treatments come via 4.5, crowns via 4.6, and the triangle stamp via 4.9 (which also applies to lotr/lotrscroll, since LTR is UB).
      - `new/ub/c.png` is referenced by CC but missing, so substitute it in the manifest.
      - Import signature: `security_stamp: triangle` + the UB set list (1.4).
      - From SPM (2025), UB prints on the default frame plus a copyright line (6.3).

      Order by the 1.6 log.
- [ ] **4.26 [P2] Per-part colour for split, aftermath, adventure and flip** (Card Conjurer audit 2026-09-25) — There is one colour key per card (`components/cards/frame-layer.tsx`:59,108; `scripts/build-split-frame.mjs`:6-9 calls it an 'accepted simplification'). So Fire // Ice and Cut // Ribbons print gold on both halves, and an adventure whose spell is another colour can't colour its page. CC colours each part through masks: split/aftermath Top/Bottom Half, adventure bookLeft/bookLeftMulticolor/bookRight, plus Left/Right Half and Middle Third (`packSplit.js`:2, `packAdventure.js`:2, `creator/index.html`:155-162).

      A second-part colour (`back_face.color_identity`, `types/card.ts`:193-210) composites the second colour's frame through those masks. The masks are overlay assets from 4.3/4.21, never pre-flattened 7×7 PNG pairs. Default the second colour from the second part's cost, on import and in the editor.

      References: Fire // Ice, Cut // Ribbons, Callous Sell-Sword // Burn Together. Needs 4.6's mask machinery.
- [ ] **4.27 [P2] Post-2024 layouts: Prepare, Room, Omen, Station** (Card Conjurer audit 2026-09-25) — CC's fork ends June 2024, so none of these is in CC.

      1. **Prepare** first: 70 cards, Secrets of Strixhaven 2026. It is in neither CC nor MSE, and the importer drops the spell half (`lib/scryfall/import-mapper.ts`:198). Build a `prepare` template like `adventure` (`scripts/build-adventure-frame.mjs`): the spell page is on the RIGHT with its own grey name/cost and type bars, and creature rules are on the left. Add new slot rects on the `adventure` capability (it already takes arbitrary rects) and a kind 'Prepare'. Reference: Abigale, Poet Laureate.
      2. **Room** (30 cards; MSE `magic-m15-split-fusable` rooms/): landscape like split, but with ONE shared illustration and ONE shared 'Enchantment — Room' type line carrying the unlock reminder, plus two door panels each with name/cost and rules. `back_face` holds the second door (1.3 already stops mapping Rooms to Split).
      3. **Omen** (MSE `magic-m15-adventure` omen pages) and **Station** (≈30 cards; MSE `magic-m15-altered`, using the tiers capability shared with levelers in 4.7) at P3.

      Order by the 1.6 log, and log each as 'unsupported' until it ships.
- [ ] **4.28 [P3] Foil-etched frame treatment** (Card Conjurer audit 2026-09-25) — Scryfall `frame:etched` returns 849 printings (CMR, MH2, commander decks and later). CC has Etched (29 frames incl. vehicle + holo stamp), Etched Nyx, Etched Snow and etched legend/inner crowns (`groupShowcase-5.js`:56-61, `packEtched.js`), with its own colour rule: two-colour lands use colour frames, 3+ colour artifacts use A (`creator-23.js`:606-608,671-677,705-714,1373). MSE has `magic-m15-showcase-etched-foil`. PipGlyph's 'etched' is only a finish shader (`lib/cards/etched-finish.tsx`), selectable since 6.5; it isn't the etched frame treatment.

      Ship it as a treatment through 4.5, with crowns from 4.6. Import signature: `frame_effects` contains `etched`. Keep 6.5's shader decision separate.
- [ ] **4.29 [P3] Public /frames catalogue (after 4.1)** (Card Conjurer audit 2026-09-25) — An ISR page generated from the frame manifest (4.1) and `frame_reviews`:
      - Verified frames only, grouped by era and treatment.
      - A sample render per frame, the supported kinds, and a 'Create with this frame' deep link (`/create?template=…`).
      - Added to `app/sitemap.ts` and the generated llms.txt, and noindex while thin (SEO contract).

      CC's `gallery/index.html` ('what they're called and where to find them') is the model. Today only the frame-eras article describes our frames, in prose.
- [ ] **4.30 [P2] Border colour overlay (black / white / silver / gold)** (Card Conjurer audit 2026-09-25) — Every CC group offers White/Silver/Gold Border (`packM15Borders.js`, `pack8th.js`): a 1×1 fill drawn through the Border mask. PipGlyph has no border colour anywhere. Add a per-card border colour drawn through the template's border mask in both renderers; the import maps Scryfall `border_color` white/silver/gold to an exact match (8ED/9ED white-border printings, Un-set silver with 4.15).
      **Borderless research 2026-09-25:** the first `border_color: white` fixture is the TDM ghostfire white run (#409–418, halofoil); the black run (#399–408) is 4.35.
      **Full-art research 2026-09-26:** full-art fixtures:
      - DFT #507–516: yellow box-topper basics. They are 4.39's bars in the dark (`inverted`) treatment plus a yellow border; confirm the bars by eye.
      - MB2 #121: a white-bordered snow basic.
      - The Japan showcase's white run (45; DSK #398, DFT #407): 4.36's treatment plus a white border.
- [ ] **4.31 [P2] Frame-review follow-ups** (owner review of every production
      card, 2026-09-25; the fixed half shipped as layout v25/v26 in
      fix/frame-review-followups (#381); the owner's decisions as v27/v28 +
      migration 0117 in feat/frame-review-decisions (#382); both merged
      2026-09-25. Status at `267f46c`: 7 of 14 sub-items done, three with an
      open tail. Round 5 (layout v29, one sweep) closed the Draconic and Alpha
      long P/T, foil through rules backdrops, the Alpha artifacts + lettering,
      display-font word spacing, aftermath's rotated art, planeswalker row
      parity and the long planeswalker name; every open one below is still
      open in code):
      - [x] **Dragon Wing two-colour cards split their wings** (owner decision):
        `FrameProfile.twoColorSplit`, both renderers, both keys preloaded,
        plates stay 'm'. Still open: frame_reviews gates a two-colour card as
        (tarkirdragon, 'm') — decide whether ticking 'm' certifies the split
        (the compare page now shows it for Taigam) or the gold 3+ colour look;
        the pips panel's cost-colour sync and AI fill collapse two colours to
        ['multicolor'], so a NEW card can't reach the split from the creator.
      - [x] **Dragon Wing sat under the set "Tarkir: Dragonstorm"** but is the
        2023 MUL frame. Owner decision (2026-09-25): it is renamed "Dragon Wing
        (Multiverse Legends)" and moved to its own `multiverselegends` frame
        set, still in the showcase era (`types/card.ts`). The template key
        stays `tarkirdragon` because it is stored in `frame_style`,
        `frame_reviews` and the frames bucket. Picker chips and toasts print
        the label once (`setQualifiedFrameLabel`), not "Tarkir: Dragonstorm —
        …".
      - [x] **Draconic P/T.** The gold TDM dragon frame people expect is
        `tarkirdraconic`. Its P/T is white on light parchment, so it can't be
        read, and it needs the same plate treatment Dragon Wing got. Done
        (wf/r5-stats-final): MSE's serpent-ringed pt/<c>pt.png plates
        (build-showcase-frames.mjs `plate`), black ink at MSE's pt field,
        matching TDM #321 Ureni and #301 Magmatic Hellkite; the ink may use
        the box's face inside the serpents (1187–1398 px).
      - [x] **Ghostfire rebuilt** (owner decision): MSE's translucent boxes at
        60 % + P/T ribbon (scripts/build-showcase-frames.mjs), white ink, type
        line inside its band.
      - [x] **Alpha frame re-cut** to the printed proportions from its MSE
        source (scripts/build-alpha-frames.mjs); P/T, artist line and mark
        re-fitted. Round 2 (owner: "thin"): the lines redrawn the print's
        way — one thin dark line per pinstripe / art-box / text-box edge on
        agclassic (MSE's light centre and coloured text-box ring cut, its
        bevel widened to the print's), the land print's dark · colour · dark
        lines on alphaland.
      - [x] **Alpha long P/T (pre-existing):** a P/T like `*+1/*+1` runs out of
        the strip across the pinstripe into the black border — the P/T rect
        spans 1207–1432 px and neither StatBake nor StatOverlay fits the
        digits (`10/10` fits). Fix: shrink-to-fit in both renderers and end
        AGCLASSIC.pt.rect inside the pinstripe (~1404 px). Done
        (wf/r5-stats-final) with 3.18: the rect keeps its centre (1320 px) and
        `inkSpanPct` keeps the ink to 1236–1404 px, so every value that fits
        stays byte-identical (moving the rect's edges would re-round its
        centring).
      - **Alpha bevel lighting:** MSE lights every colour's text-box bevel
        the same way (lit top + right); the print does that on white and
        artifact cards but lights blue and red ones from the left + bottom.
        Matching it means re-sourcing per colour — owner's call.
      - [x] **Alpha light lettering** on non-white frames: per-colour ink on
        StatSlot + footer in both renderers, with a lower-right emboss.
      - [x] **Aftermath's rotated second art (pre-existing, bake only):** the
        sideways window leaves an art-free strip in the Satori bake — the
        parent's rotate(270deg) combines badly with the child <img>'s scale()
        and percentage transformOrigin — and the foil sheen now paints over
        that strip. Fix: apply the scale in a non-rotated inner wrapper, or
        compute the cover + scale box in px as coverPlacement does. Found by
        the integration review 2026-09-25; 0 production aftermath cards.
        Fixed in v29 with 0.22: `RotatedArtBake` rotates an UNCLIPPED box
        about its centre and paints the art as a px-placed background
        (`artWindowPlacement`, from the art's size via `imageNaturalSize`),
        whole-px so a zoomed-out picture shows no line of its far edge; the
        foil sheen's rotated layer uses the same boxes. Split (rotation 0)
        keeps the object-fit path, byte for byte.
      - **Token P/T on the border (pre-existing):** since the Card Conjurer
        token master (v24) the m15token / m15tokenartifact P/T rect (MSE's
        88.6–94.8 %H) sits half on the black border below the cream band
        (production token 1e951489; 8 public tokens print a P/T). The
        alphatoken P/T prints white on the cream text box. Neither has an
        `inkSpanPct` yet — measure one when the rects are fixed (found with
        3.18, 2026-09-25).
        **Token research 2026-09-29:** "Token P/T on the border" is 4.49 (a). The 2026-09-25 snapshot has 5 public tokens with a P/T, not 8; 4.49 recounts. The alphatoken P/T goes away with 4.54 (retired, owner 2026-09-29).
      - [x] **Foil on planeswalkers** (owner decision, round-2 review): each
        ability stripe carries its own sheen (`FoilStripeSheen`, masked by the
        stripe colour) between the stripe and the badge + text, in both
        renderers — inside v28 (foil only; one production card, Coden).
      - [x] **Foil through rules backdrops** (v29, not v28): the translucent
        rules BACKDROP (`rules.backdropHex` — m15pw's non-planeswalker box,
        the token / Alpha token / Anime / Expedition scrims) hid the foil the
        way the stripes did; it now carries its own sheen
        (`FoilBackdropSheen`, masked by the backdrop colour, clipped to its
        rounded corners, under the watermark + text), both renderers. Foil
        only, on those six templates: a clear rainbow on m15pw's pale box, a
        level or two on the dark scrims (dark ink swallows the foil). 0 public
        production cards change (Coden's ability rows replace the box).
      - [x] **Planeswalker pips + name lowered** (owner note, round-3 review:
        "pips look a little high"): CC's pw title plate runs ~9 px lower at HD
        than the printed one (77–192 vs 73–183 on M15 walkers), and the
        MSE-tuned cost box and title rect left pips and name 42–43 % of the
        way down it; printed pips sit at 47–49 %, names at 49–51 %, the pips
        ~2 px above the name. `costDy: 0.004` (6 px) and title top 3.8 → 4.18
        (8 px) on M15PW, inside v27 (m15pw added to its template list; 6
        public production cards). The long name that ran under the
        detached cost (Miner the Miner) is fixed in v29: it shrinks to fit
        before the pips (3.10, `fitDetachedCostTitle`; Miner 7.69 → 7.29 pt,
        whole). Still open: the printed name's caps are ~20–25 % taller than
        ours (≈56 vs ≈45–47 px at HD).
      - [x] (fixed in v29 with 3.13 and 3.3: one shared row layout, whole-px
        shared edges in the bake, one 1.5 em badge; the editor's stripes land
        within 0.8 HD px of the saved image's) **Planeswalker row parity
        (pre-existing, preview only):** browser
        ability rows are content-sized (flex `min-height: auto`), Yoga's stay
        equal, so a walker with long or two-line abilities gets different
        stripe heights in the preview than in the bake (measured up to ~60 HD
        px); the preview's badge box is also 1.6× the text size tall against
        the bake's 1.5×. Aligning the preview to the bake (`minHeight: 0` on
        its rows, a 1.5× badge) moves no bake; the foil stripe sheen already
        follows either row height. In the bake, Satori rounds each row's top
        and height separately, so with 4 rows a seam can gain a 1 px gap or
        overlap and the last row can overhang the box by 1 px (clipped).
      - [x] **Alpha colourless ARTIFACTS** re-sourced (owner decision
        2026-09-25: the brown frame for colourless artifacts only): agclassic
        has an eighth master, `a.png`, MSE's artifact card (acard.jpg — dark
        warm-brown border, light crackle text box, like Sol Ring / Juggernaut)
        through the same re-cut, with the print's artifact-grey ink. A
        colourless card whose card type is Artifact or whose supertype says
        Artifact paints it (`FrameProfile.artifactMasterKeys`, resolved by
        `frameMasterKey` for the preview, the bake, the foil/etched masks, the
        preload and the creator's tiles); every other colourless card (Dawn
        Treader) keeps the grey `c.png` (ccard.jpg). The frame_reviews gate
        stays per colour — verifying agclassic/c publishes both masters.
        alphaland keeps one land frame per colour (Alpha printed no artifact
        land). An imported Artifact Creature still loses its Artifact word
        (1.7), so it paints the grey card until the user types the supertype.
        (Fixed by 1.7 on 2026-09-26: the import keeps the word.)
      - [x] **Alpha name + type line lettering:** silver with the lower-right
        emboss on the black frame (its dark name all but vanished: 1.15 : 1)
        and on the artifact card (1.44 : 1) only (owner decision 2026-09-25);
        dark on every other colour — the print is silver, but on our blue the
        silver read worse (2.4 against 4.1 : 1) and on red, green and the
        brown land frame it changed little. The ink rides on the text span
        only (`bandTextStyle`), so pips and set symbols inherit no shadow.
      - [x] **Display-font word spacing:** "Jester's Mask" rendered a 42 px
        word gap (17–25 px elsewhere) on every template. Not the font: Satori
        places each word after a space at the preceding characters' UNKERNED
        advances but draws each word kerned, so every gap grew by the kerning
        inside the words before it (Beleren kerns hard; ' + s is −224/2048 em)
        — names, type lines and the "ART:" line alike; the browser preview
        never had it. `displayLine()` (lib/cards/card-display.ts) joins each
        single-line display text with no-break spaces in both renderers, so
        the bake draws one kerned run; both now omit Beleren's space-pair
        kerns (space + T, comma + space…), which the bake never applied.
        Satori still SIZES the run unkerned, so the centred token title and
        type line (m15token, m15tokenartifact, alphatoken) take a negative
        margin of the run's kerning (`alignedText` in card-image.tsx, metrics
        in lib/render/satori-text.ts) and drop the filler span + gap the
        preview never had: production bakes token names 13–27 px left of the
        preview at HD. Still open, pre-existing: an overflowing line
        ellipsizes a character earlier in the bake (Satori fits unkerned
        widths); centred stat values keep the same half-kerning offset (P/T
        "4/4" kerns −271/2048 em: ~4 px left at HD); Satori never forms
        Beleren's ffi ligature the browser draws ("Office").
      - **Round-5 open tail (pre-existing, found by the v29 tracks; none is
        a v29 regression):** a walker whose abilities don't fit even at 5 pt
        still overprints or clips (warn in the editor);
        the rules estimate reads ALL-CAPS text as lowercase outside
        planeswalker rows; the preview draws cost pips at 0.95× the bake's
        disc with a narrower gap (3.4); flip / split bakes have no name–cost
        gap on the second face (aftermath has it); the bake ignores a
        transform-origin component of exactly 0 (focal point 0 with zoom ≠ 1,
        1 public card, c3379789); the foil mask over-draws the empty margin
        of zoomed-out art on normal windows; bloomanime's four-way white
        outline bakes as one shadow (its white name nearly vanishes over light
        art); a non-planeswalker on m15pw shows the shield notch; Chromium
        rejected `mplantin.woff2` (OTS cmap) and fell back to the .woff
        (fixed 2026-09-27, 3.27);
        rules text can wrap a word differently in the editor and the
        saved image at any size, not only at 5 pt. MPlantin has no kerning;
        the cause is that the bake gives every word run its gap as a right
        margin (a line must also hold its last word's gap) and sets its type
        at a whole-pixel size. So Cut // Ribbons' top half "Cut deals 4
        damage to target creature." is 1 line in the editor and 2 in the
        bake, and 0.22's compare-tool check will show that. Likewise the
        1 / 1 / 5 test walker's −8 is 4 lines against 5.
        (`lib/cards/rules-metrics.ts` `wrapRulesText` models both wraps; the
        fix is one gap rule in both renderers, which would re-wrap every
        card, so it needs its own sweep.)
        At aftermath's 5 pt floor each renderer places its own "…" in the
        sideways bottom name bar: "Memory of the Overgr…" in the editor and
        "Memory of the Over…" in the bake, whose pips sit wider (3.4).
        Cut the name in shared code, as `fitDetachedCostTitle` does for the
        planeswalker and Modern names (0 aftermath cards in production).
- [x] (done 2026-09-26 — feat/new-frames. **Owner, before merge:** `npm run frames:promote` with this manifest (the 4.32 / 4.39 objects are in the DEV bucket only); then verify per colour in /admin/frame-compare (list below). The masters are in the frames bucket (the importer's 'Borderless (Alt)' run, 39 px corners, provenance in `frame-sources.json`). `m15borderless` = M15 + art 0/0/100 × 92.24, white ink on title, type, rules and P/T, CC's cost lift, the pack's plate in `plateRect` 76.4/88.62/18.27 × 6.67 with the digits in M15's box and the ink span 1188–1394 px, brand mark and footer in the bottom bar. A preset set symbol wears the prints' white keyline on the dark type bar (`setSymbolKeyline` = `SET_SYMBOL_KEYLINE`: eight zero-blur layers 0.05 em out, Keyrune's own `.ss-border` width; the preview draws the text-shadow, the bake offset copies under the glyph — 3.25's finding): a common's #0f0f12 glyph all but vanished there (owner evidence 2026-09-26; owner round 6, 2026-09-27: keep it as built — the copies fill a symbol's thin inner gaps white, as Keyrune's own `.ss-border` does); every other profile draws the glyph as before, and an uploaded icon or the default mark are untouched. `m15borderlessartifact`: CC A for colourless, the colour frames for coloured artifacts (all 9 coloured-artifact prints baked in review wear their colour's bars; SNC #285/#288 and SLC #2011 print silver ones). Model: skins of m15 (and of m15artifact; an Artifact Creature borrows it like m15artifact) in a new M15-era 'Borderless' set; `SHOWCASE_KIND_RESTRICTION` creature/instant/sorcery/enchantment/artifact, refused by the server gate for every other kind; never premium; Etched hidden (the art reaches the edge). 7.7 passes on all 14 masters. Print review 2026-09-26 (35 well-registered prints): title bar, type bar, rules-box bottom, side fins and P/T plate within ±1 px (median), P/T digits 1–3 px, colourless C and the artifact A frames match. References revised there: r FRA #369 · #447, g FRA #374 · MSH #349, c FDN #292 · HOB #199, m SLD #2582 · #2689 (three-colour prints: the uniform gold pinline our master draws) — IKO #377 (Godzilla layout), CMM #697 (another treatment), SOS #294 (a Lesson emblem moves the name), MH3 #328 (a blue devoid card, not c), FRA #461 and TLA #306 (two-colour split pinlines) can't be scored against. Rares and mythics print the holo stamp in an ARCH of the rules-box pinline and our master's pinline is straight, so 0.9's score leaves that box out on both borderless templates (`HOLO_STAMP_ARCH`, `scoreExclusionsFor` in `lib/frames/align.ts`) until 4.9 draws the arch. Imports still land on the bordered frame; once a colour is verified the creator's notice offers 'Use Borderless' and the dialog names it. **Owner verification list:** m15borderless w/u/b/r/g/c/m; m15borderlessartifact c and w/u/b/r/g — leave m15borderlessartifact **m** unverified (its references print a two-colour split pinline, no three-colour borderless artifact exists; 4.6). Still open: the crown (4.6), the stamp and its arch (4.9), two-colour pinlines (4.6), 3.11's parity case, 1.17's `exact`, and the text sizes M15 hands down (name 5.6 % narrow, type line 5 px low — the same on black-bordered M15, so 4.20 with a sweep, never a borderless-only override)) **4.32 [P1] Standard borderless frame for regular cards (`m15borderless`) from CC 'Borderless (Alt)'** (borderless research 2026-09-25) — This is the 2019+ look: art to the edges, dark translucent bars and text box with white ink, and a black bottom bar holding the collector line. It covers 3,425 printings (2,177 without a crown), about 54 % of all borderless paper printings. Nothing ships today: the "borderless showcases" are MSE scrims with an inset art slot (4.35), and 4.7 named the wrong CC pack (its Borderless bullet now points here).
      - **Source.** CC `packBorderless.js` @2fcddba (`groupShowcase-5.js`:49), `img/frames/m15/borderless/m15GenericShowcaseFrame{W,U,B,R,G,M,A,L,C}.png`. All are 1500×2100 native: sides α0, box RGBA 0,0,0,128, opaque bottom bar from 92.24 % H with small fins up the side edges. There are 8 P/T plates, `m15/borderless/pt/*.png` (274×140, at 76.4/88.62/18.27×6.67). On FDN #311 the bars and pinlines line up within a few px. The frames are already flat per colour; the 4.3 importer copies them, cuts the corners to the 3.23 radius, and records provenance in `lib/cards/frame-sources.json` (bucket only, never git). Its mask list (Pinline/Title/Type/Rules/Border) is also what 4.34 and coloured artifacts need.
      - **Profile.** `{...M15, artSlot 0/0/100/92.24, ink #ffffff}`, spreading the M15 profile as 4.4 shipped it (v24, #380). CC's text bounds equal its regular M15 bounds (title y 5.22, type y 56.64, rules 63.03 h 28.75; `packBorderless.js`), so our measured M15 carries over (and 4.20's sizes when they land). Symbol right edge 92.13 / centre y 59.10. P/T value 79.28/90.2/13.67×3.72; the plate goes in 4.18's `plateRect` (shipped in #380) at the plate bounds 76.4/88.62/18.27×6.67, which keeps its native 1.96 aspect. Brand mark in the bar.
      - **Model.** For now a skin variant of m15: `TEMPLATE_SKIN_VARIANTS.m15`, a new frame set "Borderless" (like `extended`/`fullartset`, `types/card.ts`:432-472), and `SHOWCASE_KIND_RESTRICTION` (`lib/creator/card-kinds.ts`:246-251) limiting it to creature/instant/sorcery/enchantment/artifact. It becomes 4.5's first treatment when the overlay model lands.
      - **Colour keys:**
        - w/u/b/r/g/m come from CC W–M.
        - `c` from CC `C`: the see-through colourless, following 4.17's underFrameArt decision; full-bleed art already sits under it.
        - Colourless artifacts use CC `A` through an `m15borderlessartifact` skin, mirroring m15artifact.
        - Coloured artifacts follow 4.16's recipe with this pack's masks.
        - CC `L` is 4.34's.
      - **Stays free.** `PREMIUM_FRAME_TEMPLATES` must never hold WotC trade dress (`types/card.ts`:615-617).
      - **Depends on:** 4.2, 4.4's M15 profile and 4.18 (all shipped, #377/#380), the 4.3 importer (built for the M15 family; this pack is a new run of it), 3.23 and 7.7. The floating crown comes from 4.6 (CC `m15/crowns/m15Crown?Floating.png`, 1408×215) and the holo stamp from 4.9 (CC stamp at 43.6/90.34, in the bar notch). Without the crown, legendary imports stay `nearest` (1.17). The template is new, so existing cards are untouched: no layout bump, no sweep.
      - **References (0.11), 2 per colour, short + long text:**
        - W: Thraben Inspector INR #301 · The Eagles Are Coming! HOB #205
        - U: Flare of Denial MH3 #326 · An Offer You Can't Refuse FDN #311
        - B: Vengeful Bloodwitch FDN #325 · Grim Tutor M21 #315
        - R: Balefire Dragon CMM #697 · Improvisation Capstone SOS #294
        - G: Titanoth Rex IKO #377 · Earth's Mightiest Heroes MSH #349
        - M: Frostbite Pyromental FRA #461 · Dai Li Agents TLA #306
        - A (artifact): Jeweled Lotus CMM #702 · Sword of Hearth and Home MH2 #324
        - C: Sire of Seven Deaths FDN #292 · Ugin's Binding MH3 #328
        - Crown pair for 4.6: Arahbo FDN #294 · Sheoldred DMU #435
      - **Verification.** 0.9's auto-score must register on the name/type bars and the bottom bar, since the card edge has no pinlines. Use CC's Title/Type/Rules/Pinline masks as the scoring mask, then the 2.2 walk and 2.4 sign-off.

      Acceptance: 7.7 passes; a parity case in 3.11; the 1.17 fixtures resolve `exact` for FDN #311 and M21 #315. Once verified for a colour and kind, 1.16's import toast for a borderless printing gets a "Use Borderless" action.
- [ ] **4.33 [P1] Borderless planeswalkers** (borderless research 2026-09-25) — 245 non-showcase printings: 199 light box and dark ink (ELD #271 Oko, BRO #294), 46 dark (`inverted`: WOE #297 Ashiok, ECL #284).
      - **Source.** CC `PlaneswalkerBorderless` (3 rows, `groupPlaneswalker.js`:3; 8 colours with no C (survey, not re-verified), art to 91.53 % H, bottom bar from 91.52 % H) and `PlaneswalkerTallBorderless` (4 rows, `groupPlaneswalker.js`:6, 9 colours, type y 49.67). Both are 1500×2100.
      - **Profile.** m15pw's rail and rows (4.19, 3.13) with full-bleed art. CC paints the loyalty shield on its planeswalker masters, so drop `plateAssetPathTemplate` (4.19). The tall variant auto-selects at 4 or more abilities, like 4.7's `m15pwtall`.
      - **Colours.** `c` is substituted in the manifest. The dark look is derived (CC has none): the CC `m15/borderless` box treatment through the planeswalker masks. It needs owner visual sign-off and stays `nearest` until then. **Decided 2026-09-26 (owner: "go with your recommendation")**: map `inverted` walkers to the light look as `nearest` for now (46 dark vs 199 light printings); build the dark variant only if the 1.6 request log asks for it.
      - **Depends on:** 4.32, 4.19, 3.13, 4.3.

      References: Oko ELD #271 · Saheeli, Filigree Master BRO #294 (light); Ashiok WOE #297 · Ajani, Outland Chaperone ECL #284 (dark); Ajani, Sleeper Agent DMU #375 (long text, tall check).
- [ ] **4.34 [P1] Borderless nonbasic lands (`m15borderlessland`)** (borderless research 2026-09-25) — 665 non-showcase nonbasic printings (MID #281 Deserted Beach, OTJ #304 Spirebluff Canal, RVR shocks, MKM surveil lands).
      - **Frame.** CC's Borderless pack has a single `L` land frame. Coloured lands come from the 4.3 land recipe: `L` plus the colour pinline through the pack's `m15GenericShowcaseMaskPinline.png`, and a split pinline for two colours from 4.6.
      - **Profile.** `hideCost`, land type bar at the usual height, and the short box with vertically centred rules. Same colour keys as `m15land`, with the basic-land watermark fallback (3b.4).
      - **Depends on:** 4.32, 4.6 (two-colour pinline).

      References: Spirebluff Canal OTJ #304 · Deserted Beach MID #281; long text: Avengers Tower MSH #334.
- [ ] **4.35 [P1] Make "borderless" true in the existing templates (the border half of 4.11's re-measure, pulled forward)** (borderless research 2026-09-25) — Measured on the local masters (side band at 20–80 % H), five templates have a transparent outer ring plus an inset art slot: bloomanime, tarkirghostfire, tarkirdragon, lotrscroll and battle. They bake a flat #101015 "border" that is in neither the art nor the print. Two registries point at the wrong printings. None of these combos is verified (production `frame_reviews`: 71 combos, all m15 family + saga + modern/w), so fixing them is cheap now and must happen before 1.17 calls any of them `exact`.
      - **bloomanime.** `borderlessShowcase()` insets the art 2.5/3.5/93×92 (`lib/cards/template-layout.ts`:1571-1616). MSE's source runs the image 0/0/100×91.6, or 94.8 with a P/T (`magic-m15-showcase-bloomburrow-borderless-anime.mse-style/style`:401-407). Match MSE. The registry references Hop to It BLB #381 and Fell BLB #383, which are black-border promo-pack printings, not the anime run. Replace them with BLB #316–336 and #343–355. 0 production cards. **Signature registry 2026-09-28:** replaced, but by #343–355 only: #316–336 print the woodland frame (checked by eye), so bloomanime has references for g (Lumra #343) and m (Baylen #345, Alania #344) and no printing in w/u/b/r/c. The registry caps bloomanime, tarkirghostfire, tarkirdragon, lotrscroll and battle at `nearest` (`BORDER_PENDING_TEMPLATES` in `lib/scryfall/frame-signatures.ts`) — take a template out of that set when its border is true.
      - **tarkirghostfire.** The comment calls it "borderless" (`template-layout.ts`:1618). Scryfall: #399–408 are black-bordered, #409–418 white. The registry references #410, which is white. Paint a real black ring for the black run, register #399–408 references (e.g. Clarion Conqueror TDM #400), and leave the white run to 4.30. 1 production card, so ship it as a 0.20 platform correction.
      - **tarkirdragon.** The ring bakes #101015 (16,16,21), but the MUL references are black-bordered. Make it opaque black. 4 production cards; 0.20 sweep.
      - **fullartland.** The only true edge-to-edge master, but its references are HOB/BFZ black-bordered full-art basics. **Decided 2026-09-26 (owner: "go with your recommendation")**: keep it borderless (the alternative was adding a black border to match the current references). References revised the same day after the full-art research: FRA #382–396, not UNF #235 / EOE #262 (see the end of this item). 0 production cards.
      - **m15textless / m15textlessland.** Black-ring masters, but their references are borderless (MSH/TRK/TLA/FRA; EOE basics). **Decided 2026-09-26 (owner: "go with your recommendation")**: re-source them borderless from CC `TextlessGenericShowcase` (4.37), matching their references (the alternative was re-referencing them to black-bordered textless printings).
      - **lotrscroll and battle** are the same ring problem, already in 7.6/4.21. Cross-reference; don't duplicate.
      - **Owner decision A8 (2026-09-29):** the signature registry also caps the four templates 7.7's edge contract found (avatar, bloomburrow, lotr, tarkirdraconic: a transparent outer band at the bottom and lower sides) and expeditionland in black and green (3) — `BORDER_PENDING_TEMPLATES` / `BORDER_PENDING_COLOURS` in `lib/scryfall/frame-signatures.ts`. A test holds that list to `EDGE_CONTRACT_KNOWN_FAILURES` (but alphaland's invisible corner specks), so fixing a master here — which strikes it from the known failures — asks for its cap to go too.

      Acceptance: 7.7 passes for every template listed here.
      **Full-art research 2026-09-26:**
      - **(1) `fullartland`: the decision (a) stands — it stays borderless — but its references need a second look.** UNF #235 and EOE #262 print different bars from its master, so an auto-score against them fails on the bars (`survey/fullartland-vs-refs.jpg`):
        - UNF #235 has a name bar and a floating orbital symbol, and no type bar;
        - EOE #262 has one bottom bar with the name centred, and no title bar.

        **Decided 2026-09-26 (owner approved the full-art recommendations)**: (b) register FRA #382–396 instead of UNF #235 / EOE #262 (the alternative (a) kept them and accepted that the bar check fails against them). They are the only borderless printings with its title bar + medallion type bar, and they print dark `inverted` bars (see 4.39's [decide]). UNF #235–239 and EOE #262–266 are textless basics: they go to `m15textlessland`'s registry, which already lists EOE, and to 4.11's per-set line; UNF #235 and EOE #262 stay on as 7.7 edge fixtures only.

        4.39 re-sources the master from CC 2022 without the Border mask.
      - **(2) `m15textless` / `m15textlessland`: the decision (a) stands, but the re-source must ship with 3.24's `textless` flag.** Otherwise the profile keeps printing the type line at 73.6 % and cream rules at 78.6–92.1 % H on the art (M15TEXTLESS spreads FULLART, `template-layout.ts`:1803-1813). The black-bordered textless promos this leaves without a frame are 4.42.
      - **(3) The `expeditionland` b and g masters are broken.** `public/frames/expeditionland/b.png` and `g.png` lost the black ring and the black text box: edge α 0.00 and 78.4 % / 77.3 % clear, against α 1.00 and 39.6–39.8 % clear on w/u/r/c/m (measured 2026-09-25). The black flood fill leaked through the dark stone (`scripts/build-variation-frames.mjs`:27 `NEAR_BLACK` 60, :89-95).
        - The borderless research missed it because it sampled one colour.
        - Add `expeditionland` to 7.7's fail list.
        - Fix it through 4.11's CC re-source (preferred) or with a clamped flood.
        - 0 production cards, unverified.
- [ ] **4.36 [P2] Text-on-art treatment (no boxes): source material + TDM clan** (borderless research 2026-09-25) — Name, cost, type and rules are set directly on the art. Source material (`promo_types: sourcematerial`, 247; per-set split from the survey, not re-verified: MAR 100, FCA 65, TLE 61, PZA 20) uses white text with a black stroke. The TDM clan showcase (#327–376, 50) uses white text over darkened art. Both keep the black bottom bar.
      - **Source.** No frame art is needed. The master is CC `m15/borderless` through its Border mask only, leaving the bottom bar and fins. Derive it and confirm on TLE #1.
      - **Profile.** Full-bleed art. Outlined ink (`OUTLINE_SHADOW`) on title, type, rules and P/T. An optional bottom-half gradient scrim for the TDM look, which needs a gradient `backdrop` (today only a flat rgba box, `card-image.tsx`:624-633). This replaces `borderlessShowcase()`'s rgba(8,8,12,0.55) box.
      - **Depends on:** 3.23 (brand mark and footer on art), 1.17. Most of this is our own geometry, so the owner signs off visually.

      References: Winds of Change MAR #30 · Volcanic Torrent TLE #37 (source material); Anafenza TDM #327 · Taigam TDM #335 (clan).
      **Full-art research 2026-09-26:** the Japan showcase (`promo_types ∋ japanshowcase`; 62 black-bordered, 45 white) is this treatment inside a border:
      - anime art out to the ring;
      - white outlined rules on the art (FRA #403 adds a dark scrim);
      - a thin coloured type rule and a dark P/T plate.

      Derive it from CC `m15/borderless` plus a black ring through the `m15/new` Border mask; the white run comes via 4.30. `nearest` until then (1.19). References: DSK #389 · FDN #428 (black); DSK #398 · DFT #407 (white). The outlined rules ink built here is also the one 3.24 points to.
- [ ] **4.37 [P3] Borderless variants: light box, short box, textless, tokens** (borderless research 2026-09-25) — In request-log order:
      - **Light box, dark ink** (CC `GenericShowcase`, 'Borderless', `groupShowcase-5.js`:48; box α191–230; 8 colours, no C). 519 non-PW non-land printings, but only 12 in expansion/core/masters sets; most are specials. Example: The Soul Stone SPM #242.
      - **Short and mid boxes** (CC `IkoShort` type 70.2 % H and `PromoRegular-1` type 65 %, `groupPromo-2.js`:3-4). **Decided 2026-09-26 (owner: "go with your recommendation")**: a manual variation only — the import picks the variation the printing uses (1.17), and the creator never switches box size on its own as the text changes.
      - **Textless** (CC `TextlessGenericShowcase`, 8 colours). Also resolves 4.35's m15textless choice (a).
      - **Tokens** (CC `TokenTextlessBorderless`, 10 frames incl. C and snow, no bottom bar, art 0/0/100/100). Only 19 paper borderless tokens exist (WONE/WMOM JP promos, SLD); the real token work is 4.22.
      **Full-art research 2026-09-26:** the textless variant: CC `TextlessGenericShowcase` has W/U/B/R/G/M/A/C frames plus P/T plates (`packTextlessGenericShowcase.js`), and it needs 3.24's `textless` flag. The black-bordered textless promos are 4.42.
      **Token research 2026-09-29:** its tokens bullet becomes a borderless skin of 4.48 (CC `TokenTextlessBorderless`), still P3. Until then, 1.23 sends the 19 borderless tokens `nearest` to 4.48 textless.
- [ ] **4.38 [P3] Borderless layout cards (saga, adventure, room/class/case, mutate)** (borderless research 2026-09-25) — Paper counts: 71 sagas, 36 adventures, 11 class/case/room, 19 mutate. Examples: TDM #383 Awaken the Honored Dead, WOE #298 Kellan, DSK #334. Neither CC nor MSE has a borderless frame for these, and MSE's module masks `borders/744x1039/m15/{saga,walker}/borderless.png` are unused shape references only. Derive each from the CC layout frames (4.21) plus a 1500 px borderless border mask, with owner visual sign-off. Log each as `unsupported` (1.6) until it ships, and order by the log. Borderless battles: never; 0 have been printed.
- [x] (done 2026-09-26 — feat/new-frames. **Owner, before merge:** `npm run frames:promote` with this manifest; the private-row count on fullartland before the v30 sweep (below); then verify per colour. CC 'Fullart Basics (2022)' is in the frames bucket and `public/frames/fullartland` is deleted. `m15fullartland` (NEW, label 'Full-Art Basic Land'): art 3.94/2.81/92.14 × 89.29 inside the black ring, mark and footer in the border. `fullartland` (re-sourced, label 'Borderless Full-Art Basic Land'): borderless with light bars (the importer SUBTRACTS the Border mask's coverage — alpha × (1 − mask alpha) left the ring's anti-aliased inner edge as a 1 px line of α 10–14 at x 59 / x 1439 / y 60 / y 1933, up to 64 in its corners, a faint rounded rectangle over the art: owner evidence 2026-09-26; re-imported and re-published to the dev bucket, still v30), brand mark on the pill, footer in ON_ART_OUTLINE (drawn as copies in the bake, 3.23). Both put a basic's symbol in the frame's disc (`basicSymbol` = CC's box with CC's `s?.png`, bucket `<template>/symbol/*`), take CC's title and type boxes and sizes (title 8.54/5.4/80.46 × 4.6 at 0.0533 W, type 18.87/85.1/65.13 × 4.2 at 0.0453 W — the print review measured M15's inherited slots 7–9 px right and ~6 % small on the name, 10–12 px left, 6 px low and 5 % small on the type line; with CC's, both land within 1–2 px of 17 prints at their width), the set symbol right-anchored at 92.13 / centred 87.39 at the print's size (`symbolSizePct` 0.065; 78–91 px of ink printed, 57–60 before), and take basic lands only. Layout v30 (fullartland only, sweep): 0 public cards (anonymous read 2026-09-26, 736 public); **merged #389 + frames promoted 2026-09-27; the owner's admin count returned NO rows (no card of any visibility on fullartland), so the v30 sweep had nothing to re-bake and was skipped** — private rows needed the owner's admin count, by kind — a nonbasic or a pre-0.26 creature left on fullartland re-bakes with an empty disc and its rules on the art: `select visibility, card_type, coalesce(trim(supertype), '') as supertype, count(*) from cards where frame_style->>'template' = 'fullartland' group by 1, 2, 3 order by 4 desc;` (anything but basic lands → move those cards to m15land first). References (print review): `m15fullartland` = FDN #282/284/286/288/290 + TDM #272 · DSK #273 · DFT #274 · TDM #275 · DSK #276 (within 2 px, colours within 7 levels); ONE #262–266 and MOM #282–290 print an older (2023) bar geometry — 6–13 px off, colours up to 43 levels — and are `nearest` only; `c` = FIN #309, the one printed left-disc Wastes (black-bordered; its bars print darker than CC's `l`: owner sign-off on the tone); `fullartland` = FRA #382–396 (dark bars: `nearest`), no borderless Wastes. 7.7 passes, plus a two-bar fixture. Imports still land on `m15land`; once verified the creator offers 'Use Full-Art Basic' for a 2022-design basic only (`FULL_ART_BASIC_2022_SETS`, 4.39's set list, SPM/SOS excluded — ZNR/BFZ are 4.40, SPM/PLG25 4.41) and 'Use Borderless Full-Art Basic' for a borderless full-art basic that prints text (FRA #382–396, and 1.17's other borderless basics; `printing_detail` carries `full_art` / `textless` / set), never for a textless one (UNF, EOE: `m15textlessland`, 4.35). **Owner verification list:** m15fullartland w/u/b/r/g + c (Wastes; the bar tone), fullartland w/u/b/r/g (geometry only — the refs' bars are dark; c has no reference). Never verify the `m` keys (no multicolour basic). Still open: snow skins, 1.19's `exact` (fixtures FDN #282 and HOB #194 — ONE #262 is `nearest`), the UB triangle stamp (4.9), and the m key is still verifiable in the admin checklist (0.26's leftover)) **4.39 [P1] Full-art basic lands from CC 'Fullart Basics (2022)': a new black-bordered `m15fullartland`, and `fullartland` (borderless) re-sourced** (full-art research 2026-09-26) — Basic lands are the biggest full-art family and the likeliest full-art import:
      - 675 of the 2,325 paper full-art printings (29 %): 575 black-bordered, 89 borderless, 10 yellow, 1 white (re-checked live).
      - 586 of the 834 bordered, non-token full-art printings outside SLZ (70 %).
      - The import dialog's printings strip shows 30 printings, mostly the newest (`app/api/scryfall/printings/route.ts`:25,105-128). For Plains, 17 of the newest 30 are full art (FRA ×3, HOB ×9, MSH ×4, SLD ×1; checked 2026-09-25), and every one of them lands silently on `m15land` today.
      - Import by name is unaffected: Scryfall's default Plains is TRK #317, which is not full art.
      - Production has no full-art import yet (0 of 278 imported printings), so this order comes from volume, not from a request log.

      **The design.** A title bar, then a "Basic Land — Plains" bar with the mana symbol in a disc at its left end. It has printed since P23 (January 2023):
      - 263 black-bordered printings: ONE, MOM, LTR, WOE, MKM, OTJ, MH3, ACR, PIP, BLB, DSK, FDN, DFT, TDM, FIN, FIC, TLA, ECL, TMT, MSH, HOB, P23, PL24–26, PSS4, SLP. Bars checked by eye on ONE #262, LTR #272, WOE #262, MH3 #304, TDM #272, HOB #194 and FIN #294 (`verify/bottom-bars.jpg`).
      - the DFT yellow box-toppers (10) and MB2 #121 (white), both via 4.30;
      - the only borderless run with the same bars: FRA #382–396 (15; dark `inverted` bars).

      Our `fullartland` master is exactly these bars with the border removed. It comes from MSE `magic-m15-full-art-basic-land-symbol` at 744 px upscaled 2× (`scripts/build-variation-frames.mjs`:145-172). Bars measured at 4.9–10.7 and 84.5–90.3 % H.
      - **Source.** CC `packTextlessBasics2022.js` @2fcddba (`groupTextless-4.js`:5). Frames `img/frames/textless/2022/{w,u,b,r,g,m,l}.png`: 1500×2100 native, black ring α 1.00. Masks: Pinline, Title, Type and Border (`textless/2022/maskBorder.png`). Plus the 168×168 discs `s{w,u,b,r,g,c}.png` and `/snow/*`.
        - One pack gives both keys: `m15fullartland` is the full composite; `fullartland` is the same composite without the Border mask. This keeps the owner's 4.35 decision (a): `fullartland` stays borderless.
        - It replaces today's 744 px MSE master. Run it through the 4.3 importer into the frames bucket, with provenance in `lib/cards/frame-sources.json`, never in git. Delete the `public/frames/fullartland` masters in the same PR. CC declares no licence, so the bucket rule is not optional.
        - UB printings (144 of the 263) add the triangle stamp (seen on LTR #272 and FIN #294). It arrives with 4.9's stamp overlay; CC `textless/2022/ub/*` is the position reference. Don't gate `exact` on the stamp.
      - **Profile.** Spread today's FULLARTLAND. Its title (5.6/9/80×4.6) and type (85.4/18/66×4.2) are both within 1 % of CC's title y 5.22 and type x 18.87 / y 84.81.
        - `hideCost`; no rules slot for basics.
        - 3.24's `basicSymbol` disc at 4.13/83.43/11.2×8.0 %.
        - Set symbol right-anchored at 92.13, centred at y 87.39.
        - `m15fullartland`: art 3.94/2.81/92.14×89.29 (CC `artBounds`) inside the black border; brand mark in the bottom border.
        - `fullartland`: art 0/0/100/100; brand mark and footer on the art per 3.23, with 3.8's outline.
      - **Kinds and colours.**
        - Basic lands only (0.26's `basicOnly`).
        - Keys w/u/b/r/g.
        - `c` (Wastes) from CC `l` + `sc`, with owner visual sign-off. **Corrected 2026-09-26 (print review):** a left-disc Wastes WAS printed — FIN #309 (black-bordered, `m15fullartland`'s `c` reference); its bars print darker than CC's `l` (title 196,184,176 against our 208,200,196), so the owner judges the tone — **owner 2026-09-27 (round 6): accept CC's lighter bars.** CC's `l` matches the plain-bar PLG25 #2 within 3 levels.
        - No `m`: there is no multicolour basic, and `basicLandSeedForColorKey` returns null for it.
        - Snow-covered from `/snow/*`, as a skin when the 1.6 log asks.
      - **Decided 2026-09-26 (owner approved the full-art recommendations)**: the borderless `fullartland` keeps light bars, as today and as on the 263 bordered printings, so FRA #382–396 resolve `nearest`; a dark-bar colour treatment through the Title/Type masks (FRA `exact`) is built only when the 1.6 log asks.
      - **Depends on:**
        - 3.24 (symbol slot), 0.26 (basics gate);
        - 3.23 + 7.7 (the borderless key);
        - 4.3 (a new pack run), 4.2 (bucket);
        - 1.19 makes imports `exact`.

        One new template plus one replaced master with 0 production cards, so no badge. See 3.24's rollout note for private rows.
      - **References (0.11), 2 per colour:**
        - `m15fullartland`: W ONE #262 · MOM #282; U ONE #263 · MOM #284; B ONE #264 · MOM #286; R ONE #265 · MOM #288; G ONE #266 · MOM #290. MOM is in this family by the survey's grouping; confirm it by eye.
        - `fullartland`: W FRA #382 · #383; U FRA #385 · #386; B FRA #388 · #389; R FRA #391 · #392; G FRA #394 · #395. Under (a) these check geometry only (their bars are dark). They replace UNF #235 / EOE #262 (owner decision 2026-09-26, 4.35).
      - **Verification.** 0.9's auto-score registers on the two bars with the art masked; the 2.2 walk uses one basic per colour; 2.4 signs off each key.

      Acceptance: 7.7 passes (`m15fullartland` has a border on all four edges; `fullartland` has art on all four edges plus its two bars). 3.24's parity cases pass. 1.19's fixtures ONE #262 and HOB #194 resolve `exact` on `m15fullartland`. **Amended 2026-09-26 (print review):** ONE and MOM print an older bar geometry (bars 6–13 px off the master, colours up to 43 levels); the 2024–25 printings match within 2 px. Use FDN #282 and HOB #194 as the `exact` fixtures and resolve ONE / MOM `nearest`. Once verified for a colour, 1.16's import toast for a full-art basic gets a "Use Full-Art Basic" action.
- [ ] **4.40 [P2] Zendikar-style full-art basics (split type bar, centred medallion)** (full-art research 2026-09-26) — 127 black-bordered printings. The bottom bar reads "Basic Land" on the left and the subtype on the right, with a large medallion between them. Four looks:
      - **Stone ring** on the M15 frame: BFZ 25, OGW 2 (Wastes), AKH 5, HOU 5, MH1 5 (snow, "Basic Snow Land"), ZNR 15.
      - **Plain black ring:** SNC 10, BRO 10.
      - **Dark "Eternal Night" bars** (`inverted`+`showcase`): MID 10, VOW 15.
      - **The 2003 frame:** ZEN 20, J14 5.

      All checked by eye on SNC #272, MH1 #250, MID #268, AKH #250, ZNR #266 and BRO #278 (`verify/b1-check.jpg`, `verify/bottom-bars.jpg`).
      - **Source.**
        - Stone ring: CC `packZendikarBasic-1.js` (`groupTextless-4.js`:9). Frames `textless/zendikar/{w,u,b,r,g,m,l}.png`; masks pinline/type/frame plus the M15 Border; medallions `s?.svg`. Art 0/0/100×92.24; medallion 42/78.67/16×11.43; type boxes at y 81.96; set symbol at 92.13 right / 84.39 centre.
        - Plain ring: CC `packTextlessBasicsSNC.js` (`snc/basics/*`). Confirm by eye that BRO matches it.
        - MH1 snow: CC `textless/snowBasics/*` (`packFullartBasicRoundBottom`, 'Fullart Snow Basics'). Confirm it is the MH1 look.
      - **Profile.** Skins of `m15fullartland` (`TEMPLATE_SKIN_VARIANTS`), with 3.24's split type line and a `basicSymbol` medallion. Basic lands only.
      - **`nearest` only:**
        - ZEN/J14: 4.43, once 4.10's 2003 border exists;
        - MID/VOW dark bars: no CC or MSE master; derive when the 1.6 log asks.
      - **Depends on:** 4.39, 3.24.

      References: W BFZ #250 · ZNR #266; U BFZ #255 · ZNR #269; B BFZ #260 · ZNR #272; R BFZ #265 · ZNR #275; G BFZ #270 · ZNR #278; C (Wastes) OGW #183 · #184; snow MH1 #250 · #251; plain ring SNC #272 · BRO #278.

      Acceptance: 1.19's BFZ #250 and ZNR #269 resolve `exact`; 3.24's split-type parity case passes.
- [ ] **4.41 [P2] Plain-bar full-art basics (no symbol)** (full-art research 2026-09-26) — 31 black-bordered printings: THB 5, 2XM 10, DMU 5, SPM 5, SOS 5, PLG25 1. A title bar plus a "Basic Land — Plains" bar with no symbol. Checked by eye on DMU #277, 2XM #373, SPM #189 and SOS #267. SPM and SOS break any "2023 or later = medallion" date rule.
      - **Source.** CC `packTextlessBasics.js` ('Fullart Basics (THB)'): `textless/basics/{w,u,b,r,g,m,a}.png` with svg pinline/type masks. Art 3.94/2.81/92.14×89.29, type y 84.81, set symbol right-anchored, centred at y 87.39.
      - **Profile.** A skin of `m15fullartland` with `basicSymbol: { style: "none" }`. Basic lands only.
      - **Depends on:** 4.39.

      References: W THB #250 · 2XM #373; U THB #251 · 2XM #375; B THB #252 · DMU #279; R THB #253 · DMU #280; G THB #254 · DMU #281.

      Acceptance: 1.19's THB #250 and SPM #189 resolve `exact`; 7.7 passes.
- [ ] **4.42 [P2] Black-bordered textless promos (`m15textlesspromo`) from CC 'Magic Fest Promos'** (full-art research 2026-09-26) — 4.35's decision (a) re-sources `m15textless`/`m15textlessland` as borderless (CC `TextlessGenericShowcase`, 4.37). That leaves the black-bordered M15 textless promos with no frame. Owner approved building it (2026-09-26).
      - **Count.** `is:textless -t:basic border:black frame:2015` returns 59 (live, 2026-09-25). Take out TRK's 20 LCARS lands (1.19), the HOB #249 poster and the FRA #402 headliner, and 37 remain: SCH store championships, MagicFest PF19–PF27, SLD Command Towers, PL22, PLG24, PSPL, PW25, SLP #52 and FDN #718.
      - **Look.** A title bar with the cost, art down to the bottom ring, no type line and no text box, and a P/T plate on creatures (SCH #3 Dark Confidant, PF19 #1 Lightning Bolt).
      - **Source.** CC `packMagicFest.js` (`groupTextless-4.js`:14).
        - Frames `textless/magicFest/{w,u,b,r,g,m,a,l}.png`: 1500×2100, black ring α 1.00.
        - Translucent dark title bar with a white title (with shadow).
        - Art 6.2/4.96/87.6×86.39.
        - P/T plate 75.73/88.48/18.8×7.33, value 79.28/90.2 in black small caps.
        - Set symbol at the bottom centre, 50/95.24.
        - Recent promos print the dark bar whether or not Scryfall says `inverted`: SCH #50, PF26 #7 and FDN #718 are all dark (`sources/textless-tops.png`), and FDN #718 carries no flag. So key nothing on `inverted`. Light-bar PF19 #1 resolves `nearest`.
      - **Profile.** 3.24's `textless: true`; title and cost per CC; P/T through `plateRect` (4.18) with CC's plate; `hideCost` on the land key.
      - **Colours.** `c` comes from CC `a` through the manifest's substitution map, as for `m15tokenartifact`.
      - **Kinds.** Creature, instant, sorcery, enchantment, artifact and land (`l`). Not planeswalker, battle or saga (0.26, 4.5).
      - **The old MSE master.** Today's black-ring `m15textless` masters (375 px ×4, light title bar, `build-variation-frames.mjs`:124-137) are replaced by 4.35(a). Don't carry them over: they are soft, and CC is sharper. Revisit only if light PF19-style bars are asked for (1.6 log).
      - **Depends on:** 3.24 (textless flag), 4.3, 4.18, 0.26.

      References: W PF20 #1 Path to Exile · SCH #47 Ocelot Pride; U PF24 #1 Counterspell · SCH #50 Abhorrent Oculus; B SCH #3 Dark Confidant · SCH #23e Dauthi Voidwalker; R PF19 #1 Lightning Bolt · SCH #38 Goddric (legendary, so `nearest` until 4.6's crown); G PF25 #1F Avacyn's Pilgrim · FDN #718 Gigantosaurus; C PF26 #1 Wayfarer's Bauble · SCH #32 Void Winnower; M SCH #6 Omnath · SCH #12 Thalia and The Gitrog Monster (both legendary); L PF23 #3 Reliquary Tower · PW25 #17 Command Tower.

      Acceptance: 7.7 passes (border on all four edges). SCH #3 resolves `exact`. A parity case where rules text is present but hidden.
- [ ] **4.43 [P3] Old-frame full art: 2003 textless promos, 2003-era full-art tokens and basics, Future Sight textless** (full-art research 2026-09-26) — None of these has an M15-era CC source. Build them only after 4.10 (1997/2003 borders from CC Seventh/8th) and 4.23 (era text treatment), in 1.6-log order, and log each as `nearest` until then.
      - **Owner decision A9 (2026-09-29):** until this ships, the signature registry names the 2003 frame (modern) as these promos' nearest, and m15textless once it is verified in the card's colour (`onceVerified` on the `textless/old-frame` rule, swapped in by `withVerification`) — verifying m15textless is all it takes; point the rule at this item's frame when it exists.
      - **Player Rewards textless:** P05–P11 (48) plus PLST reprints (9) and 1 more. 2003 frame, textured colour ring, arched art to the bottom, no type line. Derive from CC 8th (4.10's 1500 px source) through its type/rules masks, using MSE `magic-new-textless` (375 px) for geometry, plus 3.24's `textless` flag.
      - **2003-era full-art tokens:** 74, plus 6 silver-bordered UGL tokens, 1998–2014. Name plaque, arched art over the text area, type bar and P/T. MSE (375 px) only.
      - **ZEN (20) and J14 (5) full-art basics:** 4.40's medallion bar on 4.10's 2003 border.
      - **Future Sight textless:** FUT 5, MB2 3 plus 1. MSE `magic-future-textless` (375 px) only. Park it with 4.15's Future Sight.

      References: P07 #1 Wrath of God · P10 #1 Lightning Bolt; TLRW #3 Kithkin Soldier · TZEN #3 Kor Soldier; ZEN #230 · J14 #1★ Plains; FUT #19 Blade of the Sixth Pride · MB2 #194 Kobolds of Kher Keep.
      **Token research 2026-09-29:** 1.23 sends every 1997/2003-frame token (303 printings) `nearest` `m15token` with `blockedBy` 4.43, as 1.4's `token/old-frame` rule (#396) does. `alphatoken` is retired (4.54, owner 2026-09-29), not rebuilt as an old-border token frame; the old-border tokens stay here and with 4.10.
- [ ] **4.44 [P3] 'Clear text box' full art: a PipGlyph look, not a printing** (full-art research 2026-09-26) — Card Conjurer's own 'Full Art' frames are the look its users know as "full art":
      - `packFullArtNew.js`: `m15/new/fullart/*`, 2010×2814, black ring; art 6.2/11.29/87.6×80.96 under a translucent type bar and box (α ≈ 0.60);
      - `m15/clearTextbox/*` and `ub/full/*`, both at 1500.

      No printed family matches them. The bordered, non-textless, non-land full-art printings are SLZ, SLD one-offs and the Japan showcase. So this frame would have no reference printing: it would be signed off visually, labelled "Clear Text Box", and never be an import `exact`. `new/fullart/c.png` is a dead CC reference, so `c` needs a substitute.

      **Decided 2026-09-26 (owner approved the full-art recommendations)**: send those users to Borderless (4.32) and text-on-art (4.36) now; revisit building it (as the one black-bordered "any card, full art, with rules" frame, after 4.39) when the 1.6 log or feedback asks.

- [x] (done 2026-09-27 — feat/edge-frame-thumbs, stacked on #389: `FrameThumb` (`components/creator/frame-pickers.tsx`, the one frame tile: the Card step's type, frame and colour chips; no admin list shows it, since the frame-review checklist shows reference scans and frame-compare full previews) draws a sample art in the profile's art slot with the master on a layer above it, for the frames `artFillsCard` names (`lib/cards/template-layout.ts`, from the profiles, no list): `artReachesCardEdge` (m15borderless, m15borderlessartifact, fullartland) or a full-art basic inside its ring (a `basicSymbol` slot on a window of 85 % or more each way: m15fullartland). The sample is the app's own built-in banner `/defaults/banners/banner-05.webp` (a misty valley; its centre slice is bright and low-chroma, so the frame's bars carry the colour; already in `public/`, 64 KB, loaded only by a tile that draws it). Every other tile is unchanged: across all 40 templates × 7 colours + the artifact dress + a split identity, 324 of 360 tile markups are byte-identical and all 576 other-template tile screenshots pixel-identical in both themes; the four's mean luma goes from 22–37 to 102–140 (dark theme). No card, preview or bake change, so no layout bump (a test pins that the card preview never draws the sample). Tests: `tests/unit/components/frame-thumb-sample-art.test.tsx`. **Widened by owner decision 2026-09-27** (feat/edge-frame-thumbs-six): the six other near-black tiles draw the sample too — Anime `bloomanime` (dark-theme mean luma 17.8), Nyx (24.7), M15 Textless (33.2) and Textless Land (33.8), the ZNR hedron `fullart` (37.6) and Ghostfire (39.1). No geometric rule picks exactly those (M15 planeswalker at 42.4, the two tokens at 42.7 / 46.8 and Expedition Land at 46.8 sit between them on window size and brightness), so they opt in by name: `FrameProfile.pickerSampleArt: true` on their `PROFILES` entries (not on the FULLART → M15TEXTLESS → M15TEXTLESSLAND bases, so nothing that spreads them inherits it), read only by `FrameThumb` (`artFillsCard(profile) || profile.pickerSampleArt`); `artFillsCard` still names the four. m15pw, m15token, m15tokenartifact and expeditionland keep their tiles as they are. The six go from 18–39 to 88–137 (dark theme); the 180 changed tile markups and 360 changed screenshots (of 1200 / 2400, both themes) are exactly the six's, every other tile is byte- and pixel-identical. No card, preview or bake change, so no layout bump; tests pin the exact 10 sampled templates of the 40 and that only the tile reads the flag) **4.45 [P2] Picker thumbnails for edge-to-edge frames** (owner approved 2026-09-27, round 6) — Borderless, Borderless Artifact and both full-art basic frames read as near-black tiles in the frame picker, because their masters are see-through where the art goes. Draw those tiles over a neutral sample art (both the picker and any admin list that shows the tile); no card changes.
- [ ] **4.46 [P2] Wide Keyrune set symbols at the print's size** (4.20 print check, 2026-09-28; **owner round 8: do it next, as a per-set table of printed symbol heights — it also fixes glyphs that print SMALL, e.g. FDN 88 px vs its 64 px print**) — Layout v32 fits a Keyrune glyph to CC's symbol box by its ink height, capped at box × `KEYRUNE_EM_PER_BOX` (0.065 W on M15; owner decision 2026-09-28). Compact glyphs print at 0.93–1.07 of the print's height (DOM, BFZ, KTK, TLA, SPM, IKO; against the keyline-inclusive height DOM #33 1.01, DOM #254 1.06, BFZ 1.03–1.08); medium-wide ones at FIN 0.88, EOE 0.83–0.85, MSC 0.86; wide ones at 0.51–0.62, capped by box × `KEYRUNE_EM_PER_BOX` at a 97.5 px font (M20 / M21 / SLD 39–41 px tall, DSK / NEO 47, OTJ / WOE 52–53, MH3 61, LTR 63 — the prints: M20 74–83 × 140–165 px, DSK 85 × 150, OTJ 83). Prints set a wide symbol against the box's width (0.12 W = 180 px), not its height: let the width cap drive a wide glyph (font = min(box ÷ ink height, 0.12 W ÷ ink width), dropping the box × `KEYRUNE_EM_PER_BOX` term for it — **[decide]**, it changes the owner's 2026-09-28 formula) and print-check per glyph class; the ink boxes are already in `lib/cards/keyrune-metrics.ts`. Measure a symbol over the whole bar interior: an inset window clips an M15 symbol at 84 px, and prints measure 84–88 px on compact glyphs. Only 19 public cards use Keyrune.
- [ ] **4.47 [P2] Planeswalker set symbol 16–20 px left of the prints** (4.20 print review, 2026-09-28) — `M15PW.symbolRect` (79 / 12 %W) puts the symbol's right edge at 1363–1365 px at HD; the printed walkers put it at 1379–1385. v32 didn't move it, but its type line now stops a print's gap before the symbol, so the offset costs type-line room (2 of the 7 public walker type lines shrink). Move the rect ≈ 1.1 %W right (left 80.1), re-measure the walkers' type lines, and show it beside a print (frame-swap sign-off) with its own template-scoped bump.
- [ ] **4.48 [P1] Creature tokens: the current full-art token frame (M20, 2019 → today) from Card Conjurer's token family** (token research 2026-09-29; owner request; owner decisions 2026-09-29; supersedes 4.22's full-art half) — Core Set 2020 (2019-07-12) moved tokens to a full-art frame (WotC's M20 token preview; MTG wiki "Token"):
      - About three quarters of token printings since 2014 use this look. Scryfall 2026-09-28 (`t:token game:paper`, unique=prints, include_extras): 2,484 printings have a black border, `frame: 2015` and a set other than The List, and 1,879 of them were released from 2019-07-12 on. The other 605 are the 2014–19 arch design, the only one PipGlyph draws (4.49).
      - Card Conjurer lists this family first and files the arch under 'Older Tokens' (`groupToken-2.js`).
      - MSE's M15 pack marks its arch-only `magic-m15-token` Deprecated and offers M20 in `magic-m15-mainframe-tokens`.

      The work:
      - **Anatomy** (checked on TFDN #6–#30, TMKM, TLCI, TBLB):
        - art to the black border (CC art 4/2.86/92×89.53);
        - name in a rounded pill at 4.5–11.0 %H, centred, in Beleren Small Caps. The pill is the token's colour; the ink is dark on white (and snow) and white on blue, black, red, green, gold and colourless. A few Universes Beyond sets print pale pills with dark ink (e.g. TPIP #8, TWHO #15); those are not a target;
        - type pill in a light tint of the colour: "Token Creature — Soldier", left-aligned from 8.54 %W, dark ink. The set symbol is right-anchored at 92.13 %W, in black (tokens print no rarity colour);
        - translucent text box tinted with the colour, dark ink, text vertically centred. ONE short line is centred ("Flying", TFDN #7; "This token can't block.", TFDN #30); two or more lines are left-aligned (4.49's `rules.alignSingleLine`);
        - P/T on the M15 plate (prints 78.1–94.0 %W × 89.5–94.5 %H): `plateRect` 75.73/88.48/18.8×7.33 with CC's m15PT* plates, value 79.28/90.2/13.67×3.72 (4.18);
        - collector line with a T (4.9); brand mark in the black border.
      - **Three printed heights.** The type-bar tops on 116 prints cluster at 81, 67 and 56 %H:
        - textless: type bar 81.4–87.7 %H, no box (TFDN #6);
        - regular: type bar 67.0–73.5, box to 92.7 (TFDN #7, TFDN #27). This is CC's **'Short'** pack (the master is opaque from 66.9 %H);
        - tall: type bar 56.0–62.2 (TLCI #17 Map, TBLB #5, TC19 #6). This is CC's 'Tall' pack (from 55.7).
        - CC's 'Regular' pack (from 64.0) matches no print (0 of 116), so don't ship it. 4.22's "1–2 lines → short, 3–4 → regular" mapping is off by one pack.
      - **Source.** CC `packTokenTextless-1.js`, `packTokenShort-1.js` and `packTokenTall-1.js` @2fcddba:
        - masters `img/frames/token/{textless,short,tall}/tokenFrame{W,U,B,R,G,M,A,L}{Textless,Short,Tall}.png` and `frameC.png` (`snow.png` in textless and tall only), 1500×2100, with the token Pinline/Type/Rules masks;
        - plates `m15/regular/m15PT*.png`;
        - a new run of the 4.3 importer into the frames bucket (never git), with provenance in `lib/cards/frame-sources.json` and corners cut at 3.26's radius;
        - 7.7 (`border` on all four edges) and 7.6 on every colour;
        - CC text seeds: title 8.54/5.22 at 0.0381 H (= `TITLE_SIZE_PCT` 0.0533 W); type 0.0324 H (= `TYPE_SIZE_PCT`); set symbol centre y 84.39 (textless), 70.24 (regular), 59.10 (tall); rules 8.6/74.24/82.8×17.67 (regular), 8.6/63.03/82.8×28.75 (tall).
      - **Colour keys.**
        - w/u/b/r/g from CC W–G; `m` (three or more colours) from CC M (TDMU #20, TTDM #15); `c` from CC `frameC` (charcoal pill, box α≈166: TEOE #1 Sliver, TMH3 #38 Eldrazi Spawn).
        - Two colours print a left-to-right blend of both across the pills, box and P/T rim, not gold (TMKM #10 UW, TVOW #15 GW, TFRC #11 GW). Build a gradient composite through the CC masks with 4.6's machinery; `nearest` `m` until then.
        - Legendary tokens (50 M20+ printings, 40 of them "Token Legendary Creature — …": TMKM #13, TFDN #13) take CC's floating crown (4.6); `nearest` until then.
      - **Model (owner 2026-09-29).** These are new templates for the token kind only. Heights are variations, like 4.37's box sizes, and artifact gets its OWN templates: suggested keys `m20token` (textless), `m20tokentext` (regular box) and `m20tokentall`, plus `m20tokenartifact`, `…text` and `…tall`. The keys live in `frame_style`, `frame_reviews` and the bucket, so fix them once. This matches `m15tokenartifact` on the arch and 1.4's registry pick (`token` → Artifact ? artifact frame : token frame), and lets the 0.13 gate withdraw a broken artifact template on its own. Nyx and snow (8 printings between them) stay dresses picked from the type words inside the colour's tick, and the 2.4 sign-off view renders them before the tick.

        Never in `PREMIUM_FRAME_TEMPLATES`.
      - **Renderer.** Both renderers, with parity:
        - 4.49's `rules.alignSingleLine: "center"`;
        - per-colour title ink is `inkByColorKey` (shipped, 4.31);
        - the textless height takes 3.24's `textless` flag;
        - small caps wait for 4.8 (Beleren Bold until then).
      - **Height (owner 2026-09-29): automatic, with a manual choice that sticks.** New cards and imports take the smallest printed height whose text fits at the rules standard size (3.29's real-wrap fit): no rules or flavour → textless; otherwise regular; otherwise tall (prints: ≤ ~178 characters regular, ≥ ~160 tall). The creator follows the text as it changes until the user picks a height; from then on their choice stays. (4.37's borderless box sizes stay manual-only: those are different printings, these one design.)
      - **Creator (owner 2026-09-29).** Once this family is built and verified, NEW tokens default to it: the token kind's standard (`ERA_TYPE_FRAME.m15.token`) becomes this family. `m15token` stays available as the "Token (2014–2019)" option, and existing cards keep their frame. The type picker is 3b.15.
      - **Import.** Verifying these templates turns 1.23's `token/m20` rule from `nearest` to `exact` (`onceVerified`).
      - **References (0.11), 2 per colour:**
        - W TFDN #6 Soldier · TFDN #27 Cat;
        - U TFDN #12 Ninja · TFDN #8 Drake;
        - B TFDN #15 Zombie · TFDN #30 Rat;
        - R TFDN #18 Goblin · TFDN #16 Dragon;
        - G TFDN #20 Raccoon · TDSK #12 Spider;
        - M TDMU #20 Sand Warrior · TTDM #15 Reliquary Dragon;
        - C TEOE #1 Sliver · TMH3 #38 Eldrazi Spawn;
        - tall TBLB #5 · TLCI #17;
        - first year TM20 #2 · TC19 #26.

        Move the M20+ printings out of `m15token`'s registry to here (TFDN #8, TSOC #12, TFRC #5, TBLB #5, Cadet TFRA #1, …; 4.49).
      - **Rollout.** New templates with no cards: no layout bump, no sweep. Owner `frames:promote` before merge; verify per colour (0.9 → 2.2 → 2.4).
      - **Depends on:** 4.3 (a new pack run), 4.2, 4.18, 4.20, 3.24, 7.7, 4.49 (`alignSingleLine`); 4.8 (small caps), 4.6 (two colours, crown) and 4.9 (T) for the last details; 1.23 for `exact` imports.

      Acceptance: 7.7 passes on every master. 3.11 parity cases: textless; one centred line; five left-aligned lines; tall. 1.23's TM20 #2 and TFDN #27 resolve `exact` once verified.

      **Status 2026-09-29 (`feat/fullart-tokens`, with 4.50's templates): built — six new templates, unverified, not yet the default; no stored card changes, no bump.**
        - **Masters** (`m20TokenTemplate` in `scripts/lib/cc-frames.mjs`; CC `packTokenTextless-1.js` / `packTokenShort-1.js` / `packTokenTall-1.js` @2fcddba, provenance in `lib/cards/frame-sources.json`): `m20token` / `m20tokentext` / `m20tokentall` from each pack's `tokenFrame{W,U,B,R,G,M}` + `frameC` (`c`), and 4.50's `m20tokenartifact` / `…text` / `…tall` (below) — 42 masters + WebPs = 84 objects in the DEV bucket and the manifest; 7.7's edge contract and 3.26's corner check pass on all 42. **Owner: `frames:promote` before merge.**
        - **Measure first** (Scryfall PNGs at 1500 × 2100, profile correlation per piece and dark-line edges; 63 M20+ prints — 28 textless, 19 regular, 16 tall): CC's 'Short' and 'Tall' pills sit +0.9 / +0.7 px from the prints, the name pill +1.3, the colour strip −1.0 — used as drawn. The textless pill prints 4.8 px below CC's (top outline +4.4, bottom +5.7; the 2023+ prints +4.1 … +4.9): **re-cut 5 px** (`M20_TOKEN_TEXTLESS_RECUT`: rows 1687–1844 down as one piece over the clear lower window, hard seams — only clear art and the black ring meet them), the profile riding it (`M20_TOKEN_TEXTLESS_RECUT_PX`, held by a test); after: −0.2 px median on the textless prints (the 2019–22 ones +2.4 … +4.8, their scans sit lower overall). CC's 'Regular' pack is not used.
        - **Profile** (`M20TOKENTEXT`, the other heights spread from it): art 3.9 / 2.8 / 92.2 × 89.6 (CC's bounds with 7.6's overscan: the clear window is 60–1439 × 60–1936 px on every master), hideCost; the name in CC's box, `TITLE_SIZE_PCT`, centred, white — dark on the plain white pill (`inkByColorKey`; the artifact templates' silver pills stay white) — Beleren Bold until 4.8; the type band = the pill's interior (`M20_TOKEN_PILL_INTERIOR_PX`), from 8.54 %W, `TYPE_SIZE_PCT`, measured fit; CC's 86 px symbol box, right edge 92.13 %W; rules in the box 7 px inside its top / 2 inside its bottom (regular) or 5 / 4 (tall), dark ink, 2 px padding, vAlign centre, 4.49's `alignSingleLine: "center"`, standard 76 px ceiling; M15's P/T slot (plate box and value box; `m15/pt` plates, `m15artifact/pt` on the artifact templates); M15's footer. The textless height sets 3.24's `textless` flag with a new code-owned `textlessTypeLine` (both renderers: `hidesTypeLine`; the Text step's note applies). All six joined `M15_FAMILY_TEMPLATES` without a bump (new templates).
        - **Onto the prints** (63 prints, medians, HD px; real bakes of each print's row, its set's Keyrune glyph, flat art): name baseline 190 (CC's box put it at 194: `M20_TOKEN_TITLE_PRINT_DY` −4 px); type baseline 1797 / 1496 / 1261 (the band put it 6 / 5 / 6 px lower: `M20_TOKEN_TYPE_PRINT_DY`); symbol centre 1775 / 1476 / 1241.5 (`M20_TOKEN_SYMBOL_CENTRE_PX`; CC's centres are 1777 (+ re-cut) / 1475 / 1241); the digits 3.5 px above M15's value box (`M20_TOKEN_PT_PRINT_DY_EM`); the plate where CC's box is (±1 px); the rules block 2 px lower than the regular box's middle (single lines and multi-line blocks, 15 prints), the tall box's 1 px. After, ours − print, median (range) per template (≥ 5 prints each; the extremes are glyphs, the 2019–22 scans and one-off layouts):
          - `m20token` (21): name +0 (−5 … +2), type −1 (the Universes Beyond long lines aside, −1 … 0), symbol 0 (−6.5 … +2.5), digits +0.5 y / +2 x, plate 0;
          - `m20tokentext` (12): name +0.5, type 0 (−2 … 0), symbol 0 (−2 … +2.5), digits +0.5 / +1.5, rules centre −0.5 (−1 … +4), plate +1;
          - `m20tokentall` (11): name 0, type 0 (−3 … +4), symbol −1 (−3 … +4), digits +0.5 / +2, rules centre +1.5 (6 comparable), plate 0;
          - `m20tokenartifact` (7): name 0, type 0, symbol +0.5, digits +0.5 / +0.5, plate 0;
          - `m20tokenartifacttext` (7): name 0, type −1, symbol 0, digits −6 / −3.5 (3 with a P/T: TDFT #12, TMH3 #18, TNEO #14's "10/10"), rules centre −0.5, plate +1;
          - `m20tokenartifacttall` (5): name 0, type 0, symbol +3.5 (−1 … +4.5: MKM / LCI / BIG / FRC glyphs), plate 0.
          `tests/unit/render/m20-token-bake.test.tsx` holds real HD and 750 bakes to the medians (±2 / ±1.5 px), `tests/unit/components/m20-token-preview.test.tsx` the preview (the same slots, the single line's indent from `rulesDraw`, no rules on the textless height).
        - **Height** (`lib/cards/token-height.ts`, `tokenHeightForText`): 4.48's rule as written — no text → textless; fits the regular box at the standard 76 px, clear of the plate → regular; else tall. It picks the height all 63 measured prints wear (fixture `tests/unit/cards/fixtures/m20-token-heights.json`). **Owner question:** on the research's 116-print survey it agrees on 103: 12 regular-box prints of 142–194 characters (TBLB #1/#16/#18, TINR #13, TMID #7, TNCC #18, TSOC #3, TM3C #22, TTSR #5, TBLC #23, TDRC #16, TSPM #1) fit our regular box only at 62–72 px, so the rule sends them tall — WotC sets them below 9 pt. Fitting at ≥ 72 px would take 6 of them back and keep all 19 tall prints tall (they fit the regular box at ≤ 70 px); one named constant in `tokenTextFitsAtStandardSize`. (T30A #9 prints a regular box with no text: not a rule's case.)
        - **Import (1.23):** `token/m20` names the height's template through `onceVerified` (new family `m20`) and is `exactOnceVerified`: the registry attaches `FrameMatch.onceVerifiedMatch`, and `withVerification` applies it with the swap — `exact` on the full-art template once it is verified in the card's colour, `nearest` with the gap's own reason, item and `gaps` for a crown (TMKM #13), two colours (TMKM #10 → gold `m`, 4.6) or the Nyx dress (TDSK #4, TEOC #13); until then the arch stands in as before. `templatesOfRule` counts `onceVerified`'s family. Every reference below resolves to its own template this way (`frame-reference-signatures.test.ts`).
        - **References** (`lib/cards/frame-references.json`, heights measured; mono-colour, no legend; m = three colours): `m20token` w TFDN #6 · TM20 #2 · T2XM #4, u TFDN #12 · TSOC #7, b TFDN #15 · TFDC #5, r TFDN #18 · TFIC #7, g TFDN #20 · TPIP #9, c TEOE #1 · TCMM #1, m TM3C #23 · TDMU #20; `m20tokentext` w TFDN #27 · TFDN #7, u TFDN #8 · TFDN #9, b TFDN #30 · TEOC #4, r TFDN #16 · TFDC #7, g TDSK #12 · TFDC #12, c TMH3 #38 · TFDN #26 (Copy), m TTDM #15 · TFIN #21; `m20tokentall` w TBLB #5 · TDRC #1, u TBLB #9, b TBLB #11, g TBLB #21 — r / c / m documented nulls (no non-legendary tall print found). The walk-through reaches every template from its reference (`creator-frame-walkthrough-fixtures`).
        - **Creator:** the six are variations of the token kind (`TEMPLATE_SKIN_VARIANTS.m15token`), labelled "Full-art Token…", each height's artifact template its Artifact-word dress (`TYPE_WORD_DRESSES`), their picker tiles on the sample art (`pickerSampleArt`, as 4.45's six — **owner:** keep?). **The default switch and the automatic height are built but NOT wired** (`lib/creator/token-frame-auto.ts`, tested): `newTokenFrame` (the full-art template the text asks for once verified in the colour, else the arch), `followTokenHeight` (follows the text until the user picks a height, `pinsTokenHeight`; never onto an unverified combo), and the switch's tables (`TOKEN_FRAME_LABELS_AFTER_SWITCH`: m20token "Token", m15token "Token (2014–2019)"; `TOKEN_SKINS_AFTER_SWITCH`). Round 11 (`feat/token-textbox-move`) ships the arch's textless ↔ text-box auto-pick first; this module extends that mechanism when it merges.
        - **No stored card changes:** PROOF_PLACEHOLDER
        - **Owner next:** `frames:promote`; verify each colour (0.9 → 2.2 → 2.4) against the references; then the default switch (wire `token-frame-auto.ts` into round 11's mechanism, relabel, `ERA_TYPE_FRAME.m15.token` → `m20token`).
- [ ] **4.49 [P0] Token P/T on the plate, a real text box, a left-aligned type line: today's token frame (the 2014–19 arch, `m15token` / `m15tokenartifact`)** (token research 2026-09-29; owner request; owner decisions 2026-09-29; takes over 4.4's leftover (1) with 4.53, 4.22's bordered text-box bullet and 4.31's "Token P/T on the border") — Our only token frame is CC 'Textless (Bordered M15)', the M15 (2014-07-18) → MH1 (2019-05-30) design: a black name bar with a gold rim, an arched art window and a cream type pill. Baked beside TDOM #3, TDOM #2, TXLN #10 and TFDN #8 (`tokens/reader-state/compare-ours-vs-print.png`), three faults put a wrong card on published pages today:
      - **(a) P/T on the frame's edge.**
        - There is no plate. The rect (MSE's 88.6–94.8 %H, `M15TOKEN.pt`) puts the digits at 1900–1946 px, the last rows of the colour band, touching the black border at ~1948 px (`tokens/final/verify/pt-crops.png`, W and U).
        - Prints use the M15 plate at 78.1–93.6 %W × 89.7–94.6 %H: `plateRect` 75.73/88.48/18.8×7.33 with CC's m15PT{w,u,b,r,g,m,a,c}, M15's value box (4.18) and dark ink.
        - 4.31 counts 8 public tokens with a P/T; the 2026-09-25 snapshot has 5. Recount live rows.
      - **(b) Abilities on a scrim.** Rules print white on a 50 % black box over the art at 60.5–72.5 %H (`rules.backdropHex`). No printed token does that, and long text clips: our TBLB #5 Warren Warleader (207 characters) loses its second mode, and the public Prize Pig and Ave carry 205 and 264. Prints shorten the arch and add a cream text box (TDOM #2 Knight, TM19 #1 Angel, TC17 #9 Cat Dragon, TXLN #7/#10 Treasure, TC16 #9 Thopter). The fix:
        - **New template `m15tokentext`** ("Token (2014–2019), text box"), from CC 'Regular (Bordered M15)': `packTokenRegularM15.js`, frames `token/m15/regular/{w,u,b,r,g,m,a,l}.png`; seeds art 7.67/12.48/84.76×51.43, type 65.0, rules 8.6/71.43/82.8×20.48, symbol centre 67.43.
          - `c` is built like today's see-through `m15token` c.
          - The artifact version (CC `a`) is its own template, `m15tokenartifacttext` (4.48's model, owner 2026-09-29: artifact tokens get their own templates).
        - **Measure first: CC's master sits ~3 %H above every print.** On the master, the art window ends at 63.9 %H and the type pill runs 64.6–70.2. TXLN #10, TDOM #2, TM19 #1 and TC17 #9 all end the art at ~67.0 and print the pill at 67.6–73.3 (Scryfall PNGs, 2026-09-29: `tokens/final/verify/cc-m15regular-ruler.png`, `arch-typebar-ruler.png`). This is the same offset as 4.48's CC 'Regular' pack. Prints win:
          - re-cut the master's lower band (window edge, pill, box) ~2.9 %H lower in the importer, as a PipGlyph composite of CC pixels (bucket, provenance);
          - score it against those four prints;
          - if that slips, CC's master as-is still ends the clipping; record the offset in the template's provenance note until the re-cut.
        - **One line is centred** (TDOM #2 "Vigilance", TM19 #1): add `rules.alignSingleLine: "center"`, both renderers, with parity. It centres the rules when the shared wrap (`wrapRulesText`) gives one line; 4.48 and 4.52 reuse it.
        - **Stored cards.** 28 of the 29 public `m15token` cards print rules text:
          - once `m15tokentext` is verified on production, move the stored `m15token` rows with rules or flavour text to it (the next free migration number — 0125 is #406's, 0126 / 0127 are queued, 0128 is the v34 token release's; no grants change; count private rows first);
          - delete the scrim in the same release, never before, or those cards lose their text;
          - new cards pick the variant by 4.48's height rule (automatic, a manual choice sticks).
        - **Tall box.** The arch's tall box (TAKH #1, TDOM #7, TC18 #10; type bar 56.1–62.2) has no CC source. **Owner 2026-09-29 (round 10): its own item, 4.55** (P3, by the 1.6 log). Until then, long text shrinks to fit (3.29). (2026-09-29, `feat/token-textbox-final`: the 21 tall-box printings are pinned — `TALL_BOX_TOKEN_PINS`, the `era/2015+tall-box` gap, `nearest` the regular box — so the log sees them; see the status below. Round 10: the gap's `blockedBy` names 4.55, not 4.49.)
      - **(d) Type line and set symbol.** The type line moves from centred to left, from 8.54 %W. The set symbol is right-anchored at 92.13 %W and black, centred at 84.39 %H (textless; CC's — the print pass below moved it to the prints' 84.78, and round 10's re-cut moves CC's pill onto the prints with it: 84.77, on the pill) and 67.43 (text box; re-measure after the re-cut — 70.48 after 4.49 (b)'s own re-cut, measured on its pins: the restack note below). The DOM pill prints its baseline at 1799.9 px, ours at 1796.6 (4.21's note).
      - **Registry (0.11): re-pin before anyone re-verifies** (this includes 1.4's owner step A6).
        - 16 of the 20 `m15token` references and all 13 `m15tokenartifact` references are M20+ prints; they move to 4.48 / 4.50.
        - The curated `m15token` `c` is an ARTIFACT (TXLN #7 Treasure).
        - So these combos were ticked against another design. A re-pin alone stales only the recorded 2.4 sign-off score, not the tick; this item's bump resets the ticks (Rollout).

        The pins, by template:
        - `m15token` (textless prints only):
          - W TDOM #3 Soldier · TM19 #6 Soldier;
          - U TBFZ #7 Octopus · TWAR #5 Wizard;
          - B TM19 #8 Zombie · TDOM #4 Cleric;
          - R TDOM #9 Goblin · TMH1 #8 Elemental;
          - G TDOM #11 Saproling · TM19 #12 Beast;
          - C TBFZ #1 Eldrazi · TEMN #1 Eldrazi Horror (the see-through grey frame over the art that our `c` draws);
          - M none: both 3+-colour arch tokens (TC17 #9, TWAR #16) have text. Own tick after a walk (2.4, decision 1).
        - `m15tokentext`:
          - W TDOM #2 Knight · TM19 #1 Angel;
          - U TM15 #4 Squid · TC16 #7 Bird;
          - B TM19 #7 Bat · TWAR #6 Assassin;
          - R TM19 #9 Dragon · TSOI #6 Devil;
          - G TM15 #10 Insect · TXLN #5 Dinosaur;
          - M TC17 #9 Cat Dragon · TWAR #16 Citizen;
          - C TBFZ #2 Eldrazi Scion · TOGW #1 Eldrazi Scion.
        - `m15tokenartifact` (textless): c TKLD #2 Construct · TMH1 #18 Golem; u TC18 #7 Myr.
        - `m15tokenartifacttext`:
          - c TXLN #7 Treasure · TSOI #11 Clue · TM19 #14 Thopter;
          - u TC16 #9 Thopter · TC18 #8 Thopter. These have a blue pinline on the silver frame: check the coloured recipe (colour through Title + Type + Pinline in `scripts/lib/cc-frames.mjs`) against them.
        - Artifact w/b/r/g/m have no printing: own tick after a walk.
      - **Rollout.**
        - A renderer and master change on existing cards: a `CARD_LAYOUT_VERSION` bump, template-scoped to `m15token` / `m15tokenartifact`, with `VERSION_ROLLOUT: "sweep"` (0.20), after the frame-swap before/after sheet of every combo existing cards use.
        - The 2026-09-25 production snapshot has 29 public token cards, all on `m15token`:
          - 23 are one account's land cards on the token frame (21 typed "Basic" with Wastes / Mountain / Swamp);
          - 1 more types "Basic — Wastes";
          - 5 are tokens with a P/T and no type word.
        - Count private rows first (admin query, by template).
        - **Verification (owner 2026-09-29): this bump RESETS the 14 `m15token` / `m15tokenartifact` ticks** (7 colours each; it does not join `VERIFICATION_NEUTRAL_VERSIONS`): slots move, and the old ticks were made against the wrong design. `lib/cards/frame-verification-state.ts` stales them on the bump; re-verify every colour in the walk-through (2.2 → 2.4) against the re-pinned references above.
        - Shares one bump with 3b.15's wording change or 4.53 when they are ready together (the shared bump resets the ticks).
      - **Depends on:** 4.18 (shipped), 4.3 (the Regular M15 pack run and the re-cut), 3b.15 for the words (not blocking).

      **Status 2026-09-29 (`feat/token-v34`): (a), (d) and the registry re-pin are built and ship in layout v34, one bump with 3b.15; (b) is open.**
        - (a) `M15TOKEN.pt` is M15's slot: CC's plate box, the 4.18 value box, its ink span, 0.05 W, dark ink. The plates are M15's own: `m15/pt/{color}` on `m15token`, `m15artifact/pt/{color}` on `m15tokenartifact` (CC m15PTa for `c`, the colour's plate otherwise, as TC18 #7 prints). The plate draws only when the face prints its P/T (`printsPowerToughness`, 3b.15).
        - (d) The type band runs from 8.54 %W to 92.13 %W, start-aligned, with the measured fit, and its baseline moves 1796 → 1800 px (`TOKEN_TYPE_PRINT_DY`; 15 prints: 1797–1803, mean 1800.4). The set symbol has its own `symbolRect` (80.13 / 82.72 / 12 × 4.1: right edge 92.13, centre 84.77 — CC's 82.34 / 84.39 moved down with the re-cut pill, round 10 below; 84.78 after the print pass). The symbol colour stays the card's rarity (3b.15's rarity decision).
        - Measured against the prints (HD px, ours − print). The P/T digits' centre is within ±2 x and −1.4 y on average (15 prints). The plate sits 8–9 px above the prints (TDOM #3 −9, TKLD #2 −8, TM19 #6 −8) and within 1.5 px horizontally. The type line starts +4 px (129 vs 124–126). The symbol's right edge is within ±1 px (DOM, KLD); other sets differ by glyph. The symbol's centre is 3–11 px above the prints (CC's 84.39 %H vs the prints' ~84.76).
        - **Print pass 2026-09-29 (`feat/token-v34-polish`, on `2b9c4c2`).** Re-measured on all fifteen textless pins (TDOM #3/#4/#9/#11, TM19 #6/#8/#12, TBFZ #1/#7, TWAR #5, TMH1 #8/#18, TEMN #1, TKLD #2, TC18 #7; Scryfall PNGs at 1500 × 2100) against real HD bakes of each print's row (its set's Keyrune glyph, frames sha-checked), ours − print:
          - Set symbol (ink centre): −8.3 px on average (−2.9 to −11.6; the bake's glyph box from Satori's SVG, the print's by pixels). CC's `symbolRect` centre 84.39 %H is its own pill's centre, and CC's pill sits ~8 px above the printed pill (interior 1716–1822 vs ~1726–1828 px on TDOM #3 / #4, TKLD #2). `TOKEN_SYMBOL_CENTRE_PCT` = 84.78 %H (box 82.73; right edge still 92.13 %W): −0.3 px on average after (−3.6 to +5.1, the prints' own spread).
          - Plate: the "8–9 px" above was the plate's TOP read on light plates, where CC's white / silver rim meets the frame's light band and the edge scan found the frame's line instead (−9.0 / −8.4 / −8.9 on TDOM #3 / TM19 #6 / TKLD #2; −1 to −4 on the dark plates). Each print's plate profile (rim, inner line, bottom bevel over x 1255–1335) aligned to the bake's by correlation: CC's plate sits 2.7 px above the prints on average (median 3.75; −5.5 to +3.5 as the prints are cut). `TOKEN_PLATE_PRINT_DY_PCT` moves the token's `plateRect` 88.48 → 88.61 %H: +0.3 px on average after. The value box stays M15's: the digits did not move (+0.6 x / −1.3 y vs the prints' 1291.0 × 1929.8).
          - Tests: `tests/unit/render/token-frame-bake.test.tsx` holds the plate top, the digits and the symbol centre to the prints' means ±2 px at HD (±1.5 at 750) on real bakes; the preview test pins the same boxes.
          - Re-bakes (the stored bake's contract, frames sha-checked; 2b9c4c2 vs this branch, HD and 750): the 32 production token rows (0128 applied in memory) and the 70-row combo matrix (14 combos × creature / Treasure / enchantment creature / Copy / legendary) — every bake changes (every one draws a symbol), and only inside x 1136–1418 × y 1728–2015 at HD: the symbol +8 px (+4 at 750, Satori's whole px), the plate +3 (+1), the digits, type line, title, art, rules and footer untouched; type-line fit and rules layout identical on every row.
          - **Stack note:** `feat/token-textbox-final`'s `M15TOKENTEXT` derives its `symbolRect` from `M15TOKEN.symbolRect`; merged as is, its symbol drops 8 px off TDOM #2 / TXLN #10 (its re-cut pill moved with CC's centre, and its bake test pins 70.48 %H). Derive it from `TOKEN_CC_SYMBOL_RECT` on that merge. It also inherits the plate's 2.7 px move (not measured on the text-box prints). (Done on `feat/token-textbox-polish`: the symbol from `TOKEN_CC_SYMBOL_RECT`; the plate's move kept, measured on the text-box pins — 4.49 (b)'s restack note.)
          - Skeptic re-measure (own method, same fifteen pins): the bake's glyph by difference against a bake with an invisible icon, the print's by ink rows inside its pill's interior; the plate by 2-D correlation of edge maps over the whole plate (digits masked) and by its bottom edge on the black border; the digits by 2-D correlation. Symbol centre −7.9 → +0.1 px (median −9.5 → −1.5); plate −2.5 → +1.3 (whole-plate correlation) and −4.2 → −1.2 (its bottom edge alone) — the two bracket the prints; digits +0.6 x / −1.0 y, unmoved. The pill: CC's interior 1716–1823 px, the prints' 1725–1828 on average (centre 7.4 px lower). Preview (Chromium, the tree's compiled CSS) ≡ bake at 1500 / 750 px: plate and digits within 0.2 px (the "1/1" digits 1.2 px in x at 1500, as on 2b9c4c2), symbol box within 1 px at 1500 and 2 px at 750 (3 px on 2b9c4c2).
          - **Owner question:** on CC's master the moved 86 px box reaches 1823 px, 1 px past its pill's interior (1822): tall glyphs (DOM, BFZ, C18, an uploaded icon) now reach 1–2 px into the pill's bottom bevel. The prints' ink stops short of theirs — 3–4 px on the DOM prints (their white keyline meets the bevel), 6–15 px on the other sets — so the print position in absolute px is not the print's look inside CC's pill. It is the placement 4.20's round-8 review moved away from ("the 86 px symbol sits in the pill, not on its bevel"). Keep the print position, or keep CC's 84.39 and re-cut the textless master's lower band ~8 px lower (a PipGlyph composite of CC pixels, as 4.49 (b) re-cut the text-box master) so pill and symbol both land on the prints? **Answered 2026-09-29 (round 10, decision 1): re-cut** — see "Round 10" below.
        - Registry: re-pinned as listed. `m15token/m` and `m15tokenartifact` w/b/r/g/m are documented nulls, and the allowlist row `m15token/c#0` is retired.
        - Public rows (anonymous read, 2026-09-29): 32 on `m15token`, 22 of them typed "Basic", and 0 on `m15tokenartifact`. 8 print a P/T, not 5. Private rows still need the owner's count.
        - Ticks: all 14 production ticks are legacy (`verified_layout_version` null, 2026-07-08), and a legacy tick never went stale. `LEGACY_TICK_LAYOUT_VERSION` (33, `lib/cards/frame-verification-state.ts`) judges them at v33, and v34 lists the two token frames in `VERIFICATION_TEMPLATE_SCOPES`, so all 14 show "needs re-verification" after the deploy (still verified: the creator keeps offering them) and no other template's tick moves. **Owner:** re-verify the 14 in the walk-through against the new pins.
        - v34 (the shared bump, `lib/cards/layout-version.ts`): `VERSION_SCOPES[34]` = every card on `m15token` / `m15tokenartifact` OR a token whose printed line changes on any other template (3b.15), no template list; "sweep"; not verification-neutral. Real HD bakes, v33 (main `02fe649`) vs v34: all 731 cached public cards → exactly the 32 on `m15token` change, the same 32 the scope selects; the 32 fresh production rows (26 stamped v33 bake pixel-identical to their stored PNG) change only below y 1725 (type band, symbol, plate); no title, art, rules or footer pixel moves; all 8 P/T values land inside the plate's ink; no type line is cut ("Token Creature — bokoblin et squelette" fits at 63.4 px). The template matrix (40 templates × 27 rows, 7 of them tokens): 244 of 1,080 bakes change, exactly the 244 the scope selects — all 54 on the two token frames and, on the other 38 templates (alphatoken included), only the token rows whose words change; no non-token row, no word-less token without a P/T.
        - **Before the sweep (owner):** the private-row count on `m15token` / `m15tokenartifact` / `alphatoken` and of private tokens on other templates (the anonymous read sees 0 outside `m15token`); the frame-swap before/after sheet of the 32 public cards is in the PR.
        - **Owner question (skeptic pass 2026-09-29):** a stored token with a P/T and Artifact or Enchantment but no Creature (hand-typed "Artifact" on a 1/1 Thopter, or an AI Treasure the old autofix gave a 2/2) STOPS printing its P/T at v34 — 3b.15's rule (P/T only with Creature or a Vehicle / Spacecraft subtype) — and 0128 leaves it alone; 0 public rows (all 8 public P/T tokens have an empty supertype). Count them before the merge (admin SQL: `select visibility, supertype, count(*) from cards where card_type = 'token' and (coalesce(power,'') <> '' or coalesce(toughness,'') <> '') and supertype ~* '(^|\s)(artifact|enchantment)(\s|$)' and supertype !~* '(^|\s)creature(\s|$)' and not exists (select 1 from unnest(subtypes) t where lower(btrim(t)) in ('vehicle','spacecraft')) group by 1, 2;`). If any are real creature tokens, a follow-up migration can give them "Creature" as 0128 does. **Answered 2026-09-29 (round 10, decision 2): 0128 itself gives them "Creature"** (unreleased, edited in place) — see "Round 10" below. The count query above still stands before the merge (0 public today).
        - **Round 10 (owner-approved 2026-09-29, all five sections "looks right"; `feat/token-v34-recut` on `e26d1a9`):**
          - **(1) Re-cut the textless masters** (`TOKEN_TEXTLESS_RECUT` in `scripts/lib/cc-frames.mjs`, all 14 m15token / m15tokenartifact masters, dev bucket; the owner promotes). Measured edge by edge on the fifteen pins, CC's window edge, the strip under it, the pill and the pill's shadow print as ONE piece 8.2 px higher than the prints (window edge −8.9, pill outline top −8.6 / bottom −7.9, shadow −6.4), while the title bar (−0.3), the texture under the pill and the border (+1.8) sit where CC draws them — so the window edge moves too. Rows 1640–1856 move 8 px down over the top 8 rows of the texture (top seam cross-faded over 24 rows in the window's straight sides, only the shadow's last 2 rows faded into the texture — a hard cut left the texture's step at the seam up to 2.5× CC's own); only rows 1640–1864 change. After: −0.9 … +1.6 px by edge; alignment score over the pins 94.47 → 94.99 % (a 6–10 px sweep peaks at 8–9). Profile (`TOKEN_RECUT_PX`, held to the importer's shift): the art slot 8 px taller (69.38 %H; the art's cover fit +0.55 %), the type band on the moved pill with the text where it was (baseline 1800 on all fifteen bakes, prints 1800.4; `TOKEN_TYPE_PRINT_DY` = 0.0027 − 8/1500), the symbol box back on the pill's centre (CC's + 8 px, 84.77 %H; ink centre −0.1 px from the prints' mean, −3.5 … +5.5). The symbol no longer touches the bottom bevel: ink-to-bevel room DOM 7, BFZ 5, C18 6, KLD 9, M19 30, the default mark 9, an uploaded icon 8 px (was −1, −3, −2, +1, +22, +1, 0), 13–18 px under the top outline. The plate keeps `TOKEN_PLATE_PRINT_DY_PCT` (the prints still put it 2.7 px below CC's box; ours − print +0.7 mean, −0.5 median after); the digits did not move (+0.6 x / −1.3 y).
          - **(2) 0128 also gives "Creature"** to a stored token with a P/T and Artifact or Enchantment but no Creature and no Vehicle / Spacecraft subtype ("Artifact" → "Artifact Creature"), nulling its stamp like the rest, so it keeps its P/T; `formSupertypeOf` reads the same word. Public rows re-read 2026-09-29: 33 tokens (one new), 9 with a P/T and no type word, 0 of the new kind; the owner's private count still stands.
          - **(3) A token's remix saves as common**, like a new token and an AI token (the creator's save and preview).
          - **(4)** Imported tokens that print text land on the text-box frame as nearest — built on `feat/token-textbox-polish`, no change.
          - **(5) The tall text box is its own item, 4.55**; the registry's `tall-box` gap (`era/2015+tall-box`, on the text-box branch — `feat/token-textbox-recut`) names it in `blockedBy`.
          - Re-bakes, `e26d1a9` vs this branch, HD and 750, frames sha-checked: the 33 public tokens (0128 applied in memory), the 70-row combo matrix and the fifteen pins all change, only inside x 59–1441 × y 252–1865 at HD — the art window (its scale) and the window edge / pill / shadow band; title, type-line text (left, right, cap top and baseline identical on all 118 HD bakes), rules layout, plate, digits and footer untouched (only the moved shadow shows through the plate box's clear top rows, 1861–1864), type-line fit and rules layout identical on every row. No other card changes: the 731-card public art cache was pruned, so 200 public non-token rows (13 templates, stand-in art) are byte-identical at HD and 750, and of the 800 non-token rows of the 40-template matrix at 750 the 760 on the other 38 templates are byte-identical (the 40 that change sit on m15token / m15tokenartifact).
          - **Stack note (round 10):** `feat/token-textbox-polish`'s `M15TOKENTEXT` spreads `M15TOKEN.type` and adds its own offsets; the re-cut moved `M15TOKEN.type.rect` 8 px down and its dy 8 px up, so the text-box token's type text stays put on the merge but its band rect sits 8 px lower in its pill — derive it from `TOKEN_CC_TYPE_TOP_PCT` there. Its `recutBand` is this branch's without `blendBottom` (take this one), and its importer test "No other template is re-cut" must allow the textless tokens. (Done on `feat/token-textbox-recut`: the text box's band from `TOKEN_CC_TYPE_TOP_PCT` and its dy from `TOKEN_CC_TYPE_PRINT_DY`; this `recutBand`; the importer test allows each pair only its own band — 4.49 (b)'s round-10 restack note.)
        - Open: (b) the bordered text box (`m15tokentext` / `m15tokenartifacttext`, the re-cut master, `rules.alignSingleLine`) — built on `feat/token-textbox` (below), unverified; until its stored-row move the 15 public token lands still clip their rules at the 42 px floor in today's 12 %-high box, unchanged by v34; the tall box (4.55); 4.53 (gold small-caps name, art slot).

      **Status 2026-09-29 (`feat/token-textbox`, a separate PR stacked on the v34 token release — `feat/token-v34-final`, restacked on its print pass `feat/token-v34-polish-final` as `feat/token-textbox-polish`, and on round 10's re-cut `feat/token-v34-recut-final` as `feat/token-textbox-recut`): (b) is built — the templates, not yet verified and not yet on any stored card.**
        - **Masters.** `m15tokentext` / `m15tokenartifacttext` from CC 'Regular (Bordered M15)' (`packTokenRegularM15.js` @2fcddba, `token/m15/regular/{w,u,b,r,g,m,a}.png`, its Pinline / Frame / Title / Type / Rules / Border masks), a new run of the 4.3 importer. `c` is built like `m15token`'s see-through `c` (CC's silver frame at 35 %, the pill and the box at 80 %, over the art: BFZ #2 / OGW #1). A coloured artifact keeps the silver box (base: Border + Frame + Rules from `a.png`) and takes the colour through Title + Type + Pinline — checked against TC16 #9 / TC18 #8 (blue pinline and pill on the silver frame and box). 14 masters + WebPs = 28 objects published to the DEV bucket and listed in the manifest; the edge contract (7.7, all four edges `border`) and the corner check pass on all 14. **Owner: `frames:promote` before merge.**
        - **Re-cut (measure first).** The importer moves the band from the window's straight sides through the top of the text box (rows 1240–1559) **64 px (3.05 %H) down** as one piece, the rows it opens filled from the window's sides, each seam cross-faded over 24 rows (`TOKEN_REGULAR_RECUT`, `recutBand`; provenance in `lib/cards/frame-sources.json` records `recut` and `transforms`). Measured after the re-cut (Scryfall PNGs at 1500 × 2100, title bars aligned ±1 px): the pill's top outline 1420 (prints 1420–1422), bottom outline 1538–1541 (1538–1540), the window edge ends 1408 (1404–1409), the box's top edge 1553–1558 (1553–1556). Alignment score (`lib/frames/align.ts`, score-combo's pipeline, default bake, no brand mark): over the 19 reference prints **94.5 % mean (93.1–95.6)**, on the four ruler prints (TXLN #10, TDOM #2, TM19 #1, TC17 #9) **95.0 %**; CC's master as-is 92.8 % (93.1 %), today's `m15token` scored against the same prints 93.9 % (93.9 %); 56 / 59 / 61 / 62 / 63 / 65 px score 93.9 / 94.3 / 94.4 / 94.5 / 94.5 / 94.4 on the 19 (62 ties 64 there; 64 wins on the four and on the ruler).
        - **Profile** (`M15TOKENTEXT`, both templates; the artifact dress on `m15artifact/pt`): M15TOKEN's title, footer and P/T slot (M15's value box; the print pass's plate box, 0.13 %H lower); art slot 12.0 / 6.5 / 87 × 55.2 (the window 111–1389 × 259–1408 px, 3 px of 7.6 overscan below); the type band on the pill (292 px above the textless one's), left from 8.54 %W, the text 8 px higher than the textless relation: baseline on the prints' 1500 px (our "Token" ink ends 1499–1500 on 15 references, the prints 1497–1505, mean 1501.5); set symbol right edge 92.13 %W, centre 70.48 %H (CC's 67.43 moved with the band — CC's own box `TOKEN_CC_SYMBOL_RECT`, not M15TOKEN's print-moved one); rules 8.6 / 74.48 / 82.8 × 18 (1564–1942 px, 5 px inside the drawn box at both ends — CC's rect ended at 1930 and set a centred line 5 px high), dark ink, 2 px padding, `vAlign: center`, standard 76 px ceiling, NO scrim. Single lines now centre at y 1721–1787 (prints 1718–1786); multi-line texts start at x 129–131 (prints 130–132) and y within 1–3 px of the prints.
        - **`rules.alignSingleLine: "center"`** (TextSlot, code-owned; set only on these two): when the layout is ONE rules line (no flavour, no blank, no second paragraph) `lib/cards/rules-layout.ts` indents it by `floor((column − line) / 2)` whole px at each target (`singleLineIndentPx`), the keep-outs are judged where it lands, and `rulesDraw` hands the indent to both renderers (`RulesBoxLine` / `RulesBoxLineBake` draw it as the line's `marginLeft` only when > 0, so every other card's DOM and SVG are unchanged). 4.48 and 4.52 reuse it.
        - **Creator / import.** New templates in the M15 set and the M15 family (`M15_FAMILY_TEMPLATES`; joined without a bump — no card was baked on them); `m15tokentext` is a skin of `m15token`, `m15tokenartifacttext` the Artifact type-word dress of it (`TYPE_WORD_DRESSES`). The walk from the real references lands on both (TDOM #2 Knight on `m15tokentext/w`, TXLN #7 Treasure on `m15tokenartifacttext/c`: `creator-frame-walkthrough-fixtures`). The signature registry resolves a 2015-frame token that prints rules or flavour text to them (`printsTokenTextBox`, exact); until verified in the card's colour that is `nearest` "not yet verified" (a `frame_requests` "unverified" row), and the import lands on the textless dress it landed on before (`TEXT_BOX_TOKEN_FALLBACK`: `m15token`, `m15tokenartifact` for a Treasure). The walk-through reaches them (`/create?previewFrames=m15tokentext`).
        - **References** as listed above, except `m15tokenartifacttext/c`: TSOI #11 Clue prints the TALL box (type bar ~56 %H, P3) and is not a reference; TXLN #10 Treasure (the ruler print) takes its place (TXLN #7 · TM19 #14 · TXLN #10). The 18 new printings are in the reference fixture, TDOM #2 / TXLN #7 in the signature fixture.
        - **No stored card moves, no bump.** Real Satori bakes (the stored bake's contract, frames sha256-checked) at `2b9c4c2` vs this branch, HD and 750: the 731 cached public production cards, the 1,080-row template matrix (40 templates) and the 32 production token-frame rows + 5 token seeds — 3,696 bakes, all byte-identical, 0 errors. The scrim on `m15token` stays until the stored rows move.
        - **Evidence:** TDOM #2 and TM19 #1 beside our bakes (print | `m15tokentext` | today's `m15token`), all 19 references' lower halves, the synthetic cases (one centred line, five lines, rules + flavour, a long text, see-through `c`, blue artifact, Treasure) and every colour master — in the PR.
        - **Skeptic pass 2026-09-29 (`feat/token-textbox-final`, on top of `ed294ed`).** Re-checked, no change needed: the 28 bucket objects rebuild byte-identical from the pinned CC commit and match the manifest's sha256 on the dev bucket (`frames:check --origin` the dev bucket: 332/332); CC's band sits 60–65 px above TDOM #2 / TM19 #1 / TC17 #9 / TWAR #16 and the re-cut within ±2 px (an independent band-offset measure); the alignment score reproduces (19 references 94.52 %, the four ruler prints 95.03 %, CC as-is 92.8 / 93.0, today's `m15token` 93.9); all 19 references print the regular box; preview ≡ HD bake in headless Chromium (the app's built CSS, frames sha-checked) within 2 px on every rules line of 11 cases (one centred line, five lines, rules + flavour, flavour only, a 270-character text, see-through `c`, gold, blue artifact, Treasure, the textless control) and the 750 bake at half the HD positions ±1 px; 1,848 more real bakes (731 production at 750, the 1,080-row matrix at 750, the 37 token rows at HD) byte-identical to `2b9c4c2`; eight mutations each fail the new tests; 7.6 and the square-corner check pass on the 14 local masters. Fixed: (1) merged `origin/main` (#405–#408): #407's `token/m20` / `token/role` / `token/other-type` rules name the family pick, so 1.23's expectations for printings with text move to the text-box arch (22 tests were red on the merge); (2) the registry called the 2014–19 **tall** box `exact` on the regular box, so the 1.6 log could never count it: a survey of all 316 black-bordered pre-M20 arch tokens with rules text (Scryfall images, measured against this master, checked by eye) found 21 tall-box printings (TAKH #1/5/6/12/15, THOU #2/3/4/6, TC18 #4/10/19, TSOI #11–16, TDOM #7, TRIX #1, TUST #18), now `TALL_BOX_TOKEN_PINS` → `era/2015+tall-box`, `nearest` with `blockedBy` 4.49 (TAKH #1 / TSOI #11 fixtures, captured 2026-09-29). Of the 32 public `m15token` rows, 31 fit `m15tokentext` unclipped (today 15 clip on the scrim); Prize Pig (205 + 108 characters with a P/T) still clips at the 42 px floor — count it before the stored-row move. **Blocker for the stack (not fixed here — the v34 branch's file):** main now carries `0125_anon_render_limit.sql` (#406, applied to production on merge), so `feat/token-v34-final`'s `0124_token_creature_word.sql` sorts BEFORE a migration production already has — renumber it past 0125 on that branch (its file, `tests/unit/db/token-creature-word-migration.test.ts` and the comments naming 0124) before it merges; this branch then merges it again. (Done: `feat/token-v34-polish` renumbered it 0128; merged here by the restack below.)
        - **Restack 2026-09-29 (`feat/token-textbox-polish`: `3b3ff41` + a merge of `feat/token-v34-polish-final` `e26d1a9`).** Conflicts only in `TODO.md` / `docs/FRAMES.md` (migration numbers → 0128; both sides' notes kept). The print pass moved `M15TOKEN`'s set symbol (84.39 → 84.78 %H) and plate box (88.48 → 88.61 %H), and `M15TOKENTEXT` spreads `M15TOKEN`, so the plain merge moved both on the text box too. Re-measured on the text-box pins (real HD bakes of each print's row with its set's Keyrune glyph, frames sha-checked; Scryfall PNGs at 1500 × 2100; ours − print):
          - Symbol (the glyph's ink box against a bake with an invisible icon; the print's ink inside its pill): the text box's own 70.48 %H box (CC's 67.43 moved 292 px with the re-cut) centres −1.0 / −3.5 / +0.5 / +2.0 px on TDOM #2 / TM19 #1 / TXLN #10 / TC16 #9 (mean −0.5; ink-weighted −2.1; +0.6 over eleven text-box prints; TM19's is the printed M19 badge against Keyrune's smaller m19). Kept — now derived from `TOKEN_CC_SYMBOL_RECT`, as the print pass's stack note asked; the plain merge put it 8.2 px low.
          - Plate (2-D correlation of edge maps over the plate, digits masked; the plate's side profiles and its bottom edge agree within 1.5 px): CC's 88.48 %H box sat −3.7 / −4.3 / −4.1 px on TDOM #2 / TM19 #1 / TC16 #9 (TXLN #10 prints no P/T; −2.5 over nine text-box prints, the M15 / BFZ ones −0.4 to +1.1 as the prints are cut) — more than 3 px off, the offset the fifteen textless pins showed. So the text box keeps `M15TOKEN`'s print-moved plate (by the spread): −1.0 / −1.9 / −1.2 (mean −1.4; +0.3 over nine). The digits stay in M15's value box (−2.0 to −2.7 px in y, 0 to −3.1 in x — unchanged).
          - Tests: `tests/unit/render/token-text-box-bake.test.tsx` holds the plate's top to the three pins' 1862.2 px (±2 at HD, ±1.5 at 750) beside the symbol's 70.48 %H; `tests/unit/components/token-text-box-preview.test.tsx` pins both boxes. The plain merge's symbol and CC's un-moved plate each fail six of them.
          - No existing card's bake changes: real Satori bakes (the stored bake's contract, frames sha256-checked) at `e26d1a9` vs this branch — the 32 production token rows + 5 token seeds at HD and 750 (74), the 1,080-row template matrix (40 templates × 27 rows) at HD and 750 (2,160): 2,234 bakes, all byte-identical, 0 errors. (515 cached public production rows at 750 byte-identical too; the other 216 lost their cached art to a /tmp clean-up mid-run.) typecheck, lint, the unit suite (323 files) and `next build` pass.
        - **Restack round 10 (`feat/token-textbox-recut`: `b4484a5` + a merge of `feat/token-v34-recut-final` `f07c859` + the tall-box `blockedBy` 4.55 commit from `feat/token-textbox-tallbox`).** The text box keeps its own re-cut and its own measured symbol; nothing of the textless re-cut reaches it:
          - Importer: both branches had added `recutBand`; round 10's is kept (`blendBottom` defaults to `blend`, so `TOKEN_REGULAR_RECUT` still fades both seams over 24 rows). The merged importer rebuilds all 56 token objects (both pairs, PNG + WebP, from the pinned CC commit) byte-identical to the manifest, and `frame-sources.json` unchanged; `frames:check --origin` the dev bucket: 332/332 (both branches' manifests).
          - Profile: `M15TOKENTEXT` spread `M15TOKEN.type`, which the re-cut moved 8 px down (its dy 8 px up), so the plain merge left the band 8 px low in the text box's pill with the text in place (round 10's stack note). The band now derives from `TOKEN_CC_TYPE_TOP_PCT` and the dy from `TOKEN_CC_TYPE_PRINT_DY` (same float operations as `b4484a5`): centred on the pill's interior, 1424–1530 px. The symbol (`TOKEN_CC_SYMBOL_RECT`, 70.48 %H), art slot (55.2 %H) and rules box are the text box's own; the plate is M15TOKEN's, which the re-cut did not move. The plain merge bakes byte-identical too (the text lands in the same place) — the band's rect is the difference, pinned by `token-text-box-preview.test.tsx` and `m15-text-sizes.test.ts` (5 tests fail on the plain merge's type slot).
          - Re-measured on TDOM #2 / TM19 #1 / TXLN #10 / TC16 #9 (real HD bakes, frames sha-checked; Scryfall PNGs at 1500 × 2100; ours − print): symbol box centre −1.0 / −3.5 / +0.5 / +2.0 px (M15TOKEN's re-cut box would sit 8 px lower); plate −1.0 / −1.9 / — / −1.2 (TXLN #10 prints no P/T); the type line's cap top 1450 px on all four (prints 1449–1451), left edge 129 (125–126), baseline 1501 (1502–1504). Unchanged from `b4484a5`: its 11 pins, their no-glyph twins, the 29 text-box rows of the evidence set and a 54-row text-box matrix (27 kinds × both templates) bake byte-identical to `b4484a5` at HD and 750 (199 bakes; the no-glyph twins at HD); the 11 textless landings of the same prints change with round 10's re-cut, byte-identical to `f07c859`'s.
          - No existing card changes: real Satori bakes (the stored bake's contract, frames sha256-checked) at `f07c859` vs this branch, HD and 750 — the 33 public tokens + 5 token seeds (0128 applied in memory), the 1,080-row template matrix (40 templates × 27 rows) and 200 public non-token rows (12 templates, stand-in art): 2,636 bakes, all byte-identical, 0 errors, no request left the loopback. typecheck, lint, the unit suite (324 files; the frame-gated edge-contract / corner / plate-ink tests too, on a sha-checked copy of the 332 objects) and `next build` pass.
        - **Owner next:** `frames:promote`; walk and verify the colours (2.2 → 2.4) against the pins; then the stored-row move (the next free migration number — 0125 is #406's, 0126 / 0127 are queued, 0128 is the v34 token release's; private rows counted first) with the scrim's removal in the same release. The automatic text-box choice (owner decision 5: none / regular / tall follows the rules text, a manual choice sticks) is 4.48's height rule and waits for that family; until then `m15tokentext` is an ordinary skin once verified.

      Acceptance: TDOM #3, TDOM #2 and TM19 #1 beside our bakes; 7.6 passes. 3.11 parity cases: P/T on the plate; one centred line and five lines on `m15tokentext`. No stored card loses its rules text.
- [ ] **4.50 [P1] Artifact tokens: the artifact look in both token frames** (token research 2026-09-29; owner request; owner decisions 2026-09-29) — Every printed artifact token wears an artifact look, in both designs. Today it is a frame variation (`m15tokenartifact`) with no link to the type line.
      - **Model (owner 2026-09-29, 4.48):** artifact tokens get their own templates in both families: `m15tokenartifact` and `m15tokenartifacttext` (4.49) on the arch, `m20tokenartifact`, `…text` and `…tall` (4.48) in the full-art family, picked from the Artifact type word. Nyx and snow stay dresses inside a colour's tick.
      - **Wording.** "Token Artifact — Treasure" (Food, Clue, Blood, Map, Powerstone, Gold, Junk, Lander, Incubator, Equipment, Vehicle …), "Token Artifact Creature — Thopter", "Token Legendary Artifact — Equipment" (TAFR #2), "Token Snow Artifact" (TKHM #17), and a bare "Token Artifact" with no subtype (TM15 #12 Land Mine, TIKO #9 Feather).
      - **Counts.** Scryfall 2026-09-28 (`t:token game:paper`, front face says Artifact): 546 printings, 278 noncreature and 268 creature. Since M20, 231 of the 236 noncreature ones are colourless (black border, `frame: 2015`, released ≥ 2019-07-12, not `plst`, single-faced). The 5 coloured ones are TIKO #9 and TMOC #23 Feather, TFRA #11 Heartwood, TAFR #2 and SLD #1018 Icingdeath.
      - **Stats and text.** Noncreature artifacts print no P/T, except Vehicles, which print it on the plate (TDFT #12 Vehicle 3/2). Predefined tokens always carry their rules (Treasure 53 characters, Food 48, Clue 39, Blood 60; Map 287 → the tall box, TLCI #17).
      - **M20+ look.**
        - Colourless: silver-blue metallic pills with white name ink, a light blue-grey type pill and box, dark ink (TFDN #23 Treasure, TFDN #22 Food, TMKM #14 Clue, TVOW #17 Blood, TEOC #14 Golem, TMOM #19 Thopter).
        - Coloured: the SAME silver pills and box, with the colour on the pill rims, the pinline, the bottom strip and the P/T rim (TDSK #7 Toy W, TSOC #8 Phyrexian Myr U, TMH3 #18 Phyrexian Wurm B, TMOC #25 Gremlin R). TIKO #9 Feather also tints its box. No mono-green artifact token was printed.
        - Two colours → a gradient rim (TLCI #13 Golem UW), 4.6.
      - **2014–19 look.** CC's silver-blue artifact frame (TXLN #7, TSOI #11, TM19 #14, TM15 #12). Coloured ones add a colour pinline (TC18 #7 Myr, TC16 #9 Thopter). That is today's `m15tokenartifact` and its text version; 4.49 re-pins both.
      - **Source.** M20+: CC `tokenFrameA{Textless,Short,Tall}.png` for colourless. Coloured = the `A` master plus the colour master through CC's token Pinline mask, and the colour's m15PT plate. This is NOT 4.16's `m15artifact` recipe (colour title, type and rules): token pills stay silver. Score it against TDSK #7 and TSOC #8.
      - **Creator.** "Artifact" in 3b.15's picker picks the artifact template; there is no separate frame choice. P/T only with Creature or a Vehicle/Spacecraft subtype (`showsPowerToughness` already knows Vehicle). Import: 1.23 (1.3 already routes Token + Artifact to `m15tokenartifact`).
      - **References:**
        - c TFDN #23 · TMKM #14 (text), TEOC #14 (textless creature), TLCI #17 (tall);
        - w TDSK #7; u TSOC #8; b TMH3 #18; r TMOC #25;
        - m TNEO #14 Mechtitan (five colours, legendary: `nearest` until 4.6);
        - g none;
        - Vehicle: TDFT #12.
      - **Later (P3, by the 1.6 log):**
        - the snow dress (CC snow masters; TKHM #17);
        - land tokens (5: "Token Land" TDSK #16, TECL #11; "Token Land Creature" TBRO #3, TM3C #19, TFRA #9);
        - the DFC Incubator (TMOM #16) with 5.5;
        - whether a Vehicle token takes 4.6's vehicle treatment (check TDFT #12 first).
      - **Depends on:** 4.48 (templates and model), 4.49, 3b.15; 4.6 for two colours and crowns.

      **Status 2026-09-29 (`feat/fullart-tokens`, with 4.48): the M20+ artifact templates are built — `m20tokenartifact` / `m20tokenartifacttext` / `m20tokenartifacttall`, unverified.** `c` = CC's `tokenFrameA{Textless,Short,Tall}` (the textless one re-cut with `m20token`); a coloured one = that master whole + the colour's master through the pack's Pinline mask (`tokenMaskTextlessPinline`, `short/m15MaskPinlineSuperShort`, the Tall pack's regular `m15MaskPinline`), so the pills and box stay silver and the colour takes the rims, pinline and strip — checked by eye against TDSK #7 (w), TSOC #8 / TM3C #7 (u), TMOC #25 (r), TMH3 #18 (b), TLCI #3 (w, text), TMH3 #13 / T2XM #8 (u, text), TNEO #6 (r, text). Name ink white on every colour (the silver pill); plates `m15artifact/pt` (CC's m15PTA for `c`, the colour's plate otherwise, as TDSK #7 / TMOC #25 print). The Artifact word picks them (`TYPE_WORD_DRESSES`, one per height). References: `m20tokenartifact` c TEOC #14 · TCMM #45, w TDSK #7, u TSOC #8 · TM3C #7, r TMOC #25 (b / g / m documented nulls: T40K #14 prints its own layout); `m20tokenartifacttext` c TFDN #23 · TFDN #22, w TLCI #3, u TMH3 #13 · T2XM #8, b TMH3 #18 · TMH3 #17, r TNEO #6 (g / m nulls; the Feathers TIKO #9 / TMOC #23 tint their box and are not references); `m20tokenartifacttall` c TLCI #17 · TMKM #14 (MKM's Clues print the tall box), the rest nulls. Left: the snow dress, land tokens, the DFC Incubator, the Vehicle question (as listed above).
- [ ] **4.51 [P2] Enchantment tokens: the Nyx dress** (token research 2026-09-29; owner request; owner decisions 2026-09-29; replaces 4.15's "Nyx tokens") — The enchantment token itself is 3b.15's picker on the plain frames (P1); this item adds the dress some prints wear. There are 32 enchantment token printings: 26, plus 6 WOE/WOC Roles (TWOE #15–17, TWOC #1–2, plst TWOE-17). 19 of them are from M20 on, 6 of those Roles.
      - **Wording.**
        - "Token Enchantment — Aura" (TC18 #4 Mask, TNEC #6 Smoke Blessing, TPIP #8 Settlement, TWHO #15 Mark of the Rani, TSOC #3 Contract);
        - "Token Enchantment — Shard" (TKHM #1, TDSK #2);
        - "Token Enchantment Creature — Glimmer" (TDSK #4; also TDSK #10 Horror, TNEC #1 Shrine, TCMM #62 Cleric);
        - "Token Enchantment Artifact Creature — Golem" (TEOC #13).
      - **M20+ Nyx.** A starfield inside the NAME PILL only. The type pill and box stay plain, and the pill keeps its colour tone:
        - white: TDSK #4 Glimmer and TSOC #3 Contract (a light pill with stars, dark ink);
        - black: TDSK #10 Horror;
        - colourless: TEOC #13 Golem and SLD #1835 Shrine (a dark starry pill, white ink).

        All five are from September 2024 or later.
      - **Plain (no Nyx).** TKHM #1 Shard (2021, a lavender colourless pill), TNEC #1 and #6 (2022), TCMM #62 and TWHO #15 (2023), TPIP #8 (2024-03), and TDSK #2 Shard, from the same set as the Nyx Glimmer. So Nyx is an optional dress, not a rule. Colourless enchantments print the colourless `C` frame.
      - **2014–19.** TC15 #23 Spirit (WB) wears a Nyx-textured frame. The 2013–14 Theros tokens (11) used the 2003 frame (4.10 / 4.43).
      - **Roles (owner 2026-09-29): unsupported.** 6 printings, a third of the M20-era enchantment tokens; each card holds two Roles, one upside down, and there is no CC or MSE master. 1.23 imports the front Role and logs the printing (1.6); no two-Role layout is planned.
      - **Source.**
        - M20+: neither CC nor MSE ships a master, so composite our own: the colour's 4.48 master plus a Nyx starfield through CC's Title mask. Use the strength MSE uses (`magic-m15-mainframe-tokens`, `m20/nyx_mask.png`, about 60 % grey), with the starfield from MSE `magic-modules` `trims/nyx`. It holds CC pixels, so it goes in the bucket. Owner visual sign-off beside TDSK #4, TDSK #10, TSOC #3 and TEOC #13 (check TSOC #3's type pill).
        - 2014–19: CC ships them: `token/m15/{textless,regular}/nyx/{w,u,b,r,g,m,a}.png` (`packTokenTextlessM15.js` / `packTokenRegularM15.js`:22-28), no `c`. The regular ones carry 4.49's ~3 %H offset.
      - **Creator (owner 2026-09-29).** "Enchantment" in 3b.15's picker, plus a "Nyx" toggle that is ON by default (the 2024+ prints and MSE's auto-Nyx); off gives the plain 2021–23 look. Enchantment + Artifact → the artifact template with the Nyx pill (TEOC #13). Today Nyx is refused on tokens: `SHOWCASE_KIND_RESTRICTION.nyx` is `["enchantment", "creature"]` (the creature since #396's A3). This dress is a master key of the token frames, not the `nyx` showcase template.
      - **Import (1.23).**
        - Nyx when `frame_effects ∋ enchantment` (TEOC #13, TSOC #3) or on a pinned list: TDSK #4, TDSK #10, SLD #1835 (Scryfall flags none of the three). Plain otherwise.
        - 1.4's `nyx` gap (#396) names 4.7 (`m15nyx`, a non-token frame); on the token kind it must name this item.
      - **Depends on:** 4.48, 4.49, 3b.15; the owner's sign-off on the composite.
- [ ] **4.52 [P1] Emblems: the emblem frame (M20 design) from Card Conjurer's 'Planeswalker Emblems'** (token research 2026-09-29; owner request; owner decisions 2026-09-29; ships with 6.23) — CR 114: an emblem has no colour, types, mana cost, rarity or P/T. 141 have been printed (Scryfall `t:emblem`, 2026-09-28). Every one is on a colourless silver frame, whatever the planeswalker's colour, with the art in a planeswalker-spark cut-out. Three looks:
      - **2012–13 (2003 frame):** a gold-rimmed plaque reading "EMBLEM / Sorin, Lord of Innistrad", no type line, centred text (TDKA #3, the first emblem; TM13 #11; TTHS #11; 13 printings) → P3 with 4.43 / 4.10.
      - **M15 → MH1 (52 printings, plus 4 The List reprints):** a black bar reading "EMBLEM", rippled silver, type bar 68.4–74.2 %H reading "Emblem — Ajani" (TM15 #13, TBFZ #13, TKLD #10, TWAR #19, TMH1 #20; plst TORI-14) → the P3 variant below.
      - **M20 → today, the standard.** 76 of the 141 were released from 2019-07-12 on; 4 of those are the plst reprints above.
        - The name pill carries the SOURCE's name ("Kaito, Cunning Infiltrator") in white Beleren Small Caps on dark grey, with silver light rays behind the spark.
        - The type bar sits at 67.5–73.4 %H and reads just "Emblem". AFR alone re-added the subtype (TAFR #16 "Emblem — Ellywick"); later sets dropped it again (MTG wiki "Emblem"). The set symbol is black, at its right.
        - The text box runs to ~92.7 %H: one line centred, several lines left-aligned. 2019–21 prints centred every line (TM20 #11, TKHM #20).
        - Collector letter E (4.9). A non-planeswalker source uses the same frame (TMOC #44 Teferi's Talent).
      - **Source (owner 2026-09-29): Card Conjurer's emblem frame, today's look only.** CC `packEmblem.js` @2fcddba: one master, `img/frames/token/emblem/frame.png`, 1500×2100, the M20 design, through the same pipeline as the other M15 frames (the 4.3 importer, frames bucket, provenance). Seeds: art 14.2/4.96/71.6×85.48 (the spark cut-out is transparent at 11.67–66.38 %H); title 8.54/5.22 at 0.0381 H, white, centred; type 8.54/68.0, left, dark; rules 8.6/74.43/82.8×17.48; set symbol right edge 92.13, centre 70.43. Measure the box bottom on TFDN #25: CC's box measures 73.86–90.24 %H on the master, while prints run to ~92.7.
      - **Profile.** Template `emblem`, one colour key `c` (the kind forces colourless). No cost, P/T or loyalty. 4.49's `rules.alignSingleLine: "center"`. Brand mark and footer in the black border.
      - **References:**
        - c TFDN #25 Vivien Reid (curated; it prints "Emblem" though Scryfall says "Emblem — Vivien") · TFDN #24 Kaito, Cunning Infiltrator;
        - checks: TM20 #11 (the first M20 emblem), TDSK #17 (one line, centred), TBLB #30 (two lines, left), TFRA #16 (the newest; Reality Fracture, 2026-10-02).
      - **Import.** 1.23 maps `layout: emblem` here and replaces 1.4's `no-card-type` `unsupported` for emblems.
      - **Later (P3; owner 2026-09-29: only if people ask, by the 1.6 log):**
        - the 2014–19 "EMBLEM" look as an `m15emblem` variant, from MSE `magic-m15-emblem` frame type `m15` or CC's master with the title bar redrawn. References TM15 #13 and TKLD #10 (its lower half already matches CC's geometry);
        - the 2003 plaque, with 4.43.
      - **Not planned:** the Universes Beyond full-bleed emblems (TACR #7, TFIN #24, WFIN #1), The Ring (TLTR #H13), the Mystery Booster playtest emblem (MB2 #513).
      - **Rollout.** A new template with no cards: no bump. `frames:promote`, then verify `emblem/c`. Add it to `supabase/seed.sql`'s frame_reviews block only once production has verified it (the seed mirrors production).
      - **Depends on:** 6.23 (the card type and kind; ship together), 4.3, 4.49 (`alignSingleLine`), 4.8 (small caps), 4.9 (E).
- [ ] **4.53 [P1] Today's token frame, the rest of the print match: gold small-caps name and the art slot** (token research 2026-09-29; owner request; the rest of 4.4's leftover (1)) — What 4.49 leaves on `m15token` / `m15tokentext` / `m15tokenartifact` / `m15tokenartifacttext`:
      - **(c) Name:** light Beleren Bold → gold `#fde367` (CC) Beleren Small Caps (4.8), centred. The gold ink can go first.
      - **(e) Art slot:** CC artBounds 7.67/12.48/84.76×68.43 (today 6.5/12/87×69), with 7.6's coverage test (7.6 lists a 0.24 %H hairline here).
      - **Rollout.** A template-scoped sweep, sharing 4.49's bump when ready together. Verification as 4.49 (owner 2026-09-29, decided for the frame fix it was split from): the art slot and the name move, so it resets the token ticks; in 4.49's bump they reset once.
      - **Depends on:** 4.49, 4.8 (small caps).
- [ ] **4.54 [P3] Retire `alphatoken`** (token research 2026-09-29; owner decision 2026-09-29: retire it, don't rebuild it) — `alphatoken` is a PipGlyph invention: no 1993-frame token was printed (the `lib/cards/frame-references.json` note; 0 in Scryfall's `t:token`). It prints a tiny type line and a P/T that lands on the cream text box (4.31). It has no references and no tick, so the creator hides it, and 1.4's `alpha` family (#396) still names it for a 1993-frame token (none exist). The real old-border tokens (303 printings on the 1997 and 2003 frames) stay with 4.10 / 4.43.
      - **Count first:** an admin query by template (`frame_style->>'template' = 'alphatoken'`, every visibility). The 2026-09-25 snapshot's 29 public tokens are all on `m15token`, so any rows are private.
      - **Move the stored cards** to the 2014–19 token frame: `m15token` in the same colour, or `m15tokentext` for rows with rules or flavour text once 4.49 has shipped it. A migration (next free number — 0125 is #406's, 0126 / 0127 are queued, 0128 is the v34 token release's; no grants change) that also marks them for the platform re-bake (a null stamp, picked up by the automatic re-bake, 0120), after the frame-swap before/after sheet. No migration if the count is 0.
      - **Code:**
        - drop the Classic era's token frame (`ERA_TYPE_FRAME.classic.token`, `types/card.ts`), so the picker disables Classic for tokens as it does for planeswalkers;
        - the registry's `alpha` family picks `m15token` for a token (`lib/scryfall/frame-signatures.ts`);
        - a legacy `alphatoken` in a draft or remix reads as `m15token` (0.25's `RETIRED_CARD_FINISHES` pattern);
        - remove the profile (`ALPHATOKEN`, `lib/cards/template-layout.ts`), the git master (`public/frames/alphatoken/`) and its rows in `lib/frames/edge-contract.ts`, `scripts/lib/frame-corners.mjs`, `lib/cards/frame-references.json`, `scripts/find-frame-references.mjs`, `scripts/import-mse-profiles.mjs` and `scripts/visual-audit.mjs`; take it out of 4.23's and 4.24's notes. `lib/cards/layout-version.ts` keeps it in its frozen historical scopes.
      - Never verify it before it goes.
- [ ] **4.55 [P3] The arch token's tall text box (`m15tokentall` / `m15tokenartifacttall`)** (split out of 4.49 (b), owner decision 2026-09-29, round 10) — 21 of the 316 black-bordered pre-M20 arch tokens with rules text print a TALL box: a shorter arch and the type pill high on the card (type bar 56.1–62.2 %H), for long text and predefined tokens (TAKH #1/5/6/12/15, THOU #2/3/4/6, TC18 #4/10/19, TSOI #11–16 Clues, TDOM #7, TRIX #1, TUST #18; survey 2026-09-29 on `feat/token-textbox-final`). Card Conjurer has no source for it (the 1.6 log decides when: P3).
      - **Today:** the import names them `nearest` the regular text box (`m15tokentext` / `m15tokenartifacttext`, 4.49 (b)) through the registry's `tall-box` gap (`TALL_BOX_TOKEN_PINS`, `era/2015+tall-box`, `blockedBy` this item), and long text shrinks to fit the regular box (3.29).
      - **Build:** a PipGlyph composite of CC's 'Regular (Bordered M15)' pixels (the pack 4.49 (b) re-cut), measured against the tall prints first: the window's bottom edge, the pill and the box top move UP onto the prints (~11 %H; `recutBand` moves bands down today, so the cut needs the other direction or a texture fill for the rows the box gains), the rest of the frame as CC draws it. Provenance and the dev bucket as every CC import; the edge contract and corner check.
      - **Profile:** its own templates (the artifact dress too, 4.48's model): the type band on the high pill, the rules box from the box's top to the plate's keep-out, the symbol on the pill's centre, the plate as 4.49 (a). Pins from the list above per colour; `c` built like `m15tokentext`'s see-through `c`.
      - **Import / creator:** the `tall-box` gap resolves `exact` once verified; a new token picks it by 4.48's height rule (long text), a manual choice sticks.
      - **Rollout:** new templates, no stored card on them — no bump; stored `m15tokentext` rows with long text move only by an owner decision.
      - **Depends on:** 4.49 (b) (the text-box templates and their re-cut), 3.29.

### Phase 5 — Two-sided cards end to end (3–4 weeks; needs 4.3 and 4.5)

- [ ] **5.1 [P1] Transform + MDFC kinds with real back-face frames from CC**
      (front/back, icon families by set era, dark back treatment, colour
      indicator, grey back P/T on the front, "transforms into" hint line); the
      back face carries its own frame/colour/rarity. **[decide]** retire or
      merge the `back_card_id` path.
      **Card Conjurer audit 2026-09-25:** Name the pieces:
      - CC Transform Front/Back(New) and MDFC front/back frames, including the land (L) variants.
      - The 13 transform icons (`packM15TransformTypes.js`) as an icon field mapped to Scryfall's `*dfc` frame_effects.
      - The front's grey reverse P/T at x 8.6, y 84.2, w 83.8, derived from the back.
      - The MDFC flipside strip at x 6.8, y 89.2, w 36.4, auto-filled with the other face's type word plus its cost or first ability.
      - White title/type/P/T ink on backs.
      - Borderless/extended/short DFC variants through 4.5, and DFC crowns from 4.6.
      - Planeswalker transform + MDFC from CC PlaneswalkerTransform*/PlaneswalkerMDFC.
      - Transforming saga fronts (CC saga/dfc, title inset for the icon) in 5.5.
      Keep both faces linked in ONE card; CC imports each face as a separate card.
- [ ] **5.2 [P1] Editor** — second-face editor for DFC on the Identity step
      (own art, colour, frame variant, stats); remove the "Double-faced cards —
      coming soon" veil on Publish (`components/creator/coming-soon.tsx`,
      `panels/publish-panel.tsx`:252).
- [ ] **5.3 [P1] Bake both faces** (two PNGs + thumbs), gallery tile flip, card
      page flip (exists), downloads (both faces PNG, two-page PDF, ZIP), OG
      stays front, share copy (`lib/cards/bake-core.ts`:89,
      `lib/render/card-image.tsx`:579, `lib/render/card-pdf.ts`,
      `components/cards/download-modal.tsx`).
      **Card Conjurer audit 2026-09-25:** Also generate a DFC checklist/helper card (CC's helper layout: two title rows at 7.91/16.81 % H, rules 24.39–92 %), offered in downloads and deck proxy sheets beside the two faces.
- [ ] **5.4 [P1] Import** — `transform`/`modal_dfc`/`battle`/`meld` printings
      seed the DFC kind; icons from the `*dfc` frame effects; back colour from
      the back face.
- [ ] **5.5 [P2] DFC sagas + battle backs, double-sided tokens.**
      **Token research 2026-09-29:** 41 printings are `layout: double_faced_token` (e.g. TMOM #16 Incubator // Phyrexian). Until this ships, 1.23 imports the front face with a toast.
- [ ] **5.6 [P3] Meld.**
      **Card Conjurer audit 2026-09-25:** Source from MSE `magic-m15-meld-3in1`; CC has no meld frame.
- [ ] **5.7 [P2] Borderless transform + MDFC faces** (borderless research 2026-09-25) — 149 non-showcase transform/MDFC printings, e.g. ZNR #284 Branchloft Pathway and MOM #292 Elesh Norn. CC has only the light look: `TransformBorderlessFront/Back` (8 front + 7 back, `groupDFC.js`:10-11) and `ModalBorderless` (7 + 7, no L, `groupModal-1.js`:3). About 70 % of the real ones are `inverted` (survey sample: 74 of 103). Derive the dark look from CC `m15/borderless` plus 5.1's DFC icon, flipside strip and back-face treatment. Needs 5.1–5.3 and 4.32. Import signature: `border_color: borderless` + `*dfc` effects (5.4).

### Phase 6 — Creator polish and print (2–4 weeks, after Phase 4 basics)

- [ ] **6.1a [P1] Download option: 1/8 in bleed margin** (owner request
      2026-09-25) — a checkbox on the download modal that renders the card
      with a 1/8 in (3.175 mm) bleed on every side, extending the frame's
      outer border colour/texture (never scaling the card): trim 2.5×3.5 in →
      2.75×3.75 in, i.e. 825×1125 @300 ppi, 1650×2250 @600 ppi. PNG + PDF
      (crop marks on the trim line). Bake path in `lib/render/card-image.tsx`
      + `lib/render/card-pdf.ts`; entitlement same as the clean download.
      **Card Conjurer audit 2026-09-25:** Bleed is a per-treatment recipe declared per edge in the manifest (4.1), not a colour extension:
      - `border`: extend the outer border colour/texture (black-border M15).
      - `art`: paint the art with the transform computed for the TRIM slot, unclipped into the bleed. Mirror or clamp when the source runs out; never re-cover a bigger box. This applies to borderless, full-art and extended frames, and is already needed for bloomanime/fullartland today.
      - `bar`: for borderless bottom bars.
      Showcase frames get extension art (import CC's margin packs in 4.3). Corners are square whenever bleed is on. Fixtures: M15, fullartland, extendedart, one showcase, `m15borderless` (4.32: top and sides `art`; the bottom is `bar`, from CC `margins/borderlessBottomBarExtension.png`, `packMargin-1.js`:9). Needs 6.10 so the art has pixels to extend; window-shaped imported art (1.18) has none, so a borderless import bleeds only with 6.10 or the user's own art.
      **Full-art research 2026-09-26:** bleed fixtures `m15fullartland` (all four edges `border`) and `fullartland` (all four `art`, with its two bars inside the trim).
- [ ] **6.1b [P1] Download option: 800 ppi export** (owner request
      2026-09-25) — an 800 ppi choice next to the current HD download:
      2000×2800 px at trim, 2200×3000 with the bleed option. Only sharp once
      the M15 family comes from Card Conjurer's 2010×2814 sources (4.4);
      until then it upsamples the 1500×2100 bake. Paid tier only **[decide]**;
      bake on demand (not stored), PNG only.
      (Stale since #380: 4.4 shipped, but the importer downscales once to
      1500×2100 and only those masters are in the bucket, so the M15 family
      is still 1500 px. 6.1b also needs the importer to publish a second,
      native 2010×2814 master set, with `nativeSize` recorded per template.)
      **Card Conjurer audit 2026-09-25:** 800 ppi is sharp only where the template's frame AND every overlay it uses are ≥2000 px native (manifest `nativeSize`, 4.1).
      - Of 4.4's nine templates, that means m15, m15land, m15snow, m15snowland, m15devoid and m15artifact.
      - These upsample: m15pw, m15token and m15tokenartifact (1500×2100 in CC too); saga, adventure, split, flip, aftermath and class; holo stamps (192×96); the colour-indicator base (70×70); every borderless template 4.32–4.38 (CC's borderless masters are 1500×2100 native). Label them 'upscaled' or hide the option.
      Prefer CC's Accurate/new packs wherever they exist (UB, extended, full art, snow, Nyx, spree, scroll, Mystical Archive). Needs 6.10 for the art.
      **Full-art research 2026-09-26:** every full-art source here is 1500 px native (CC) or 744 px (MSE per-set basics), except CC's NEO basics, which are vector. They upsample at 800 ppi; label them as upscaled.
- [ ] **6.1 [P2] Print-ready export** — bleed option (2.75×3.75 in at 300/600
      → 825×1125 / 1650×2250), MPC preset (816×1110 at 300, 1632×2220 at
      600), PDF sheets with cut lines + bleed, card-back sheet; canonical
      render stays 1500×2100; an 800 ppi export later from the CC masters
      **[decide]** free vs paid.
      **Card Conjurer audit 2026-09-25:** Card backs: an original PipGlyph back template plus a per-deck or per-user custom back (art + title), exported as its own PNG and as duplex-mirrored back sheets (with 6.1a bleed). Never the official Magic back. MPC 1632×2220 is the same geometry as CC's Margin pack (≈0.11 × 0.10 in), so offer true 1/8 in and MPC from the same code.
- [ ] **6.2 [P2] CARDNAME / `~` substitution** and "this creature" helper in the
      rules editor; opt-in keyword reminder-text insert with a current CR list.
      **Card Conjurer audit 2026-09-25:** Once 6.3's nickname exists, CARDNAME/~ substitutes the nickname, as CC's getInlineCardName does.
- [ ] **6.3 [P2] Nickname / flavour-name field** (title bar + small Oracle
      name); UB © line when a UB frame is chosen.
- [ ] **6.4 [P2] Tokens** — automatic "Token" prefix + reminder line, emblem
      kind, token generator from a card's rules text (P3).
      **Card Conjurer audit 2026-09-25:** Emblem = CC `packEmblem`: one colourless 1500×2100 frame (art 14.2/4.96/71.6×85.48, type 68.0, rules 74.43–91.91), type line 'Emblem — <subtype>', no cost or P/T. Seed it from a walker's −N ability via a 'Create emblem from this ability' action in `components/creator/panels/loyalty-editor.tsx`. Monarch/Initiative/Day-Night markers become P3 presets. Token text-length layouts moved to 4.22.
      **Token research 2026-09-29:** the "Token" prefix moves to 3b.15, and the emblem kind to 6.23 / 4.52. This item keeps the token generator from a card's rules text (P3) and the Monarch / Initiative / Day-Night presets.
- [x] (done 2026-09-26 — feat/quick-wins. **Decided 2026-09-26 (owner): turn on Foil and Etched; Showcase as found.** Foil and Etched are selectable in the creator's Finish picker (Publish → Advanced) and free on every plan (`PREMIUM_FINISHES` stays empty); the frame gate stays per template + colour, so a verified combo saves in any finish. No migration and no layout bump: a new foil/etched card bakes at the current version, so no badge and no sweep. The finish stays locked on edit/remix (the locked summary now says so). Showcase stays "Soon", as found: its bake is byte-identical to a regular one, and only the preview slants the title (a faux italic; Satori has no italic Beleren) — ship it with a real treatment or remove it. Translucent rules backdrops — the verified `m15token` / `m15tokenartifact` scrims among them — carry the foil since layout v29 (4.31, #386), so a new foil token shows its sheen. Still open: etched is faint at display size on the M15 family (about 2.5 % of pixels move by more than 8/255) and nearly vanishes on see-through frames (3.23) — an owner call whether to strengthen it in a later finish-scoped bump; the public card page's "Card details" block doesn't list the finish.) **6.5 [P2] Foil/etched finishes: ship or remove** **[decide]**; if
      shipped, align preview and bake (`panels/effects-panel.tsx`:26).
      (progress 2026-09-25 — fix/frame-review-followups, layout v26: ETCHED
      preview and bake now draw one shared frame-masked cross-hatch + sheen,
      `lib/cards/etched-finish.tsx`. The bake had wrapped its layer in a
      Fragment, which Satori lays out as a zero-width item, so the inset gold
      border collapsed into an 18 px strip down the left edge and the hatch
      never painted. Real etched printings use a random stipple, silvered white
      frames and inverted bars — that is 4.28.) FOIL fixed in layout v28
      (feat/frame-review-decisions, owner decision): the bake's sheen used
      `inset: 0` (Satori ignores it) and `mixBlendMode` (ignored), so foil
      never reached a saved image. Both renderers now draw one shared
      luminance-masked holographic sheen (`lib/cards/foil-finish.tsx`) under
      the ink; finish-scoped sweep. Planeswalker ability stripes carry their
      own sheen too, and translucent rules backdrops from v29 (4.31).
      (Status at `267f46c`: preview and bake are aligned for both (#381 v26,
      #382 v28), so only the **[decide]** is left. The Foil, Etched and
      Showcase chips in `components/creator/panels/effects-panel.tsx` are
      still `disabled` with a "Soon" badge, so no user can pick them. Only
      existing foil/etched cards show the new look. Shipping = enabling the
      chips (+ the 3b.12 copy); removing = migrating those cards. #382's
      manual-test step "make a planeswalker with finish Foil" can't be done
      in the creator as it stands.)
      **Borderless research 2026-09-25:** after 0.25 the finish list is
      regular/foil/etched (+ showcase); borderless is no longer a finish but a
      frame treatment (4.32–4.38).
- [ ] **6.6 [P2] Language + set-code fields** feed the collector line (with 4.9).
- [ ] **6.7 [P2] Accessibility** — text alternatives for rules-text pips, chip
      keyboard navigation (3b.10), announced substitution notices.
- [ ] **6.8 [P3] Batch/CSV/MSE-set import**; community frame packs stay out of
      scope (frames remain admin-verified).
- [ ] **6.9 [P3] Watermark preset library refresh + Keyrune update.**
      **Card Conjurer audit 2026-09-25:** Watermark ink follows the frame:
      - Tint preset and single-colour uploaded marks from a per-frame-colour table that includes gold and land (today `m` falls back to neutral, `lib/cards/watermark.ts`:21-33).
      - A two-colour left/right split once 4.6 exists.
      - Optional colour and position.
      - Any Keyrune set glyph as a watermark source (reuse 6.13's search).
      Pre-tint with sharp in `withRenderableImages` and use a CSS mask in the preview. Parity test. **[decide]** whether WotC lore marks (the guild/clan/school glyphs in mana-font) are allowed.
- [ ] **6.10 [P1] Full-resolution art path for print exports (prerequisite for 6.1a/6.1b)** (Card Conjurer audit 2026-09-25) — `toSatoriDataUrl` fits to 1600 px any art over 3 MB, and any non-PNG/JPEG art such as WebP AI output (`lib/render/art-source.ts`:46-47,77-89). That already softens full-height slots (fullart, about 2100 px tall) and is a hard cap under 6.1b's 2000×2800, where the full-art slot is 2800 px.

      Fix:
      - Size the inline edge to the target slot (slot px × 1.1) per render preset (`lib/render/card-image.tsx`:94-97).
      - For 800 ppi and bleed renders, composite art + frame (+ overlays) with sharp using the same focal/scale maths, so Satori draws only text and vector layers and resvg never sees a multi-MB data URL.
      - Raise the 8 MB upload cap for PNG (`lib/cards/upload-art-server.ts`:33), or re-encode server-side.

      Acceptance: a test that a 2000×2800 source renders the 800 ppi export without upsampling.
- [ ] **6.11 [P1] Print typography on input** (Card Conjurer audit 2026-09-25) — Text is stored and rendered exactly as typed or imported, and Scryfall Oracle/flavour text uses straight quotes. So every "can't", possessive and quoted flavour line prints straight ticks where cards print ’ “ ”. A typed ' - ' instead of '—' also silently disables ability-word italics (`lib/cards/rules-text.ts`:183-192).

      Fix:
      - Add a shared `printTypography()`: curly quotes and apostrophes, ` - ` and `--` → ` — `, and a leading `*`/`-` → `•`.
      - Apply it in the editor, on save and on Scryfall import, for title, type, rules and flavour.
      - Add —, • and − buttons to `components/creator/rules-symbol-toolbar.tsx`:17-33.

      MPlantin and Beleren already carry the glyphs. CC converts on every edit (`creator-23.js`:3334,3434-3435,4070-4072).

      Acceptance: unit tests for '90s, a possessive after a pip, quote attributions and `X-1`.
- [ ] **6.12 [P2] Minimal rules markup** (Card Conjurer audit 2026-09-25) — Emphasis is automatic only: reminder parens plus a fixed `ABILITY_WORDS` list (`lib/cards/rules-text.ts`:30-82). A designer's invented ability word can't be italicised, a word inside flavour can't be set roman, and nothing can be bold. There is no line break without the paragraph gap and no size nudge; FrameStyle holds only finish + template (`types/card.ts`:581-586).

      Add:
      - `*italic*` / `**bold**` (or `{i}`/`{b}`) and a soft break (a Shift+Enter marker) in the shared tokenizer and fit estimate.
      - Italic/Bold buttons on the Text step.
      - An optional per-card rules-size nudge (−2…+1 half-points on the fit ladder, stored on frame_style).

      Both renderers, with parity tests. CC's code list is at `creator/index.html`:213-276.

      P3 follow-up on the same bold: d20 roll tables (`1–9 | text` → bold range with alternating 25 % shade, as CC's `{roll}` does at `creator-23.js`:3710-3723,3839-3852).
- [ ] **6.13 [P2] Set icon parity** (Card Conjurer audit 2026-09-25) — The Set icon step offers 12 hard-coded Keyrune codes (`components/creator/panels/set-icon-panel.tsx`:22-35), though keyrune 3.19 ships about 425 and both renderers and validation accept any code. Glyphs are flat rarity ink with no keyline (`components/cards/set-symbol.tsx`:130-145, `lib/render/card-image.tsx`:1302-1320, pinned by `tests/unit/render/render-parity.test.ts`:18-23). Import never sets the symbol, and every new card starts blank (`lib/creator/card-fields.ts`:151-152).

      1. A searchable code field generated from keyrune.css, keeping the 12 as quick picks, validated server-side against the same map.
      2. Render Keyrune as inline SVG from `keyrune/svg/<code>.svg` with a per-rarity linearGradient and a black keyline in both renderers. Satori already draws the default mark as inline SVG. Add special (purple) with 1.10. Layout bump only for cards with `set_icon_code`.
      3. Scryfall import offers 'use this printing's set symbol'.
      4. A per-user default icon via 4.14.

      CC takes any set code and rarity from 1,835 files (`creator-23.js`:4302-4341,4992-4998).
- [ ] **6.14 [P2] Import Card Conjurer saved files (.cardconjurer)** (Card Conjurer audit 2026-09-25) — CC's only export is a `.cardconjurer` JSON array [{key, data}] (`creator-23.js`:5017-5059,5148-5169). It holds text boxes with CC codes, frame layer srcs, data:-URL or URL art with artX/Y/zoom, the set symbol, the watermark and collector info. Our FAQ and CC article say there is no import (`lib/content/faq.ts`:221-222, `content/articles/card-conjurer-alternative.mdx`:74-76), yet CC users are exactly the audience of the CC-alternative pages.

      Flow: upload the file, list its cards with checkboxes, and create private drafts.
      - Map title/mana/type/rules (`{i}`, `{flavor}`, `{lns}` → rules + flavour)/pt/loyalty.
      - Guess template and colour from the `frames[].src` pack paths via the 4.1 manifest; flag unmapped ones `nearest`, like 1.4.
      - Upload data:-URL art through `uploadCardArtServerAction` (URL art only from allowlisted hosts; 3.14 orientation applies).
      - Convert artX/Y/zoom to focal/scale using the image's natural size.
      - Fill artist, set and number (4.9) and respect card capacity.

      Update the FAQ and article when it ships. Optional: a per-card 'Download card file (.json)' / 'Open card file' that round-trips through the same importer.
- [ ] **6.15 [P2] Print sheets from any selection** (Card Conjurer audit 2026-09-25) — The single-card sheet is 9 butted copies of one card with corner marks only (`lib/render/card-pdf.ts`:113-186). Mixed sheets exist only through the Pro deck export (`app/api/decks/[id]/download/route.ts`).

      - Add a 'Print / download selected' bulk action in My Cards (`components/creator/dashboard-bulk-bar.tsx`) and on liked cards. It reuses `lib/decks/export-client.ts` / `buildDeckPdf` for an id list with per-card copies.
      - Sheet options: Letter/A4, gap 0 or 1/16 in, full-length cut lines or corner marks, 63×88 mm or 2.5×3.5 in, and bleed/MPC once 6.1a lands.
      - The same entitlement as deck export decides the tier. Remember the last settings.

      CC's `/print` tool (`print/index.html`:6-40, `print/print.js`) is the model.
- [ ] **6.16 [P2] Non-Latin card text (no render-time Google Fonts)** (Card Conjurer audit 2026-09-25) — MPlantin regular has no Cyrillic, and none of the card faces cover CJK. Russian rules text falls back to bold Beleren in the bake. CJK makes `@vercel/og` fetch Noto from fonts.googleapis.com AT RENDER TIME, the same failure class as the banned `next/font/google`, while the preview uses system fonts. Registered faces: `lib/render/card-image.tsx`:1925-1931, `lib/render/card-fonts.ts`.

      Fix:
      - Either restrict card text to covered scripts with a friendly validation error, or register self-hosted OFL fallbacks (a Cyrillic-capable body face and a Noto Serif CJK subset) in the bake and `@font-face`, with a `loadAdditionalAsset` that never calls Google.
      - Then add a language choice to the Scryfall import dialog that maps `printed_name`/`printed_type_line`/`printed_text` and sets 6.6's language field. CC imports 11 languages plus Phyrexian (`creator-23.js`:5330-5355).

      es/fr/de/it/pt already work.

      Since 6.16a nothing is fetched at render time: CJK and the other uncovered scripts draw blank or as missing-glyph boxes (the creator warns) until a bundled face lands here — add it to `lib/render/fallback-assets.ts` (the per-class answer) and regenerate `lib/render/glyph-coverage.ts`.

      Acceptance: a parity test with a Russian and a Japanese card.
- [x] (shipped in feat/creator-reliability) **6.16a [P1] A bake never fetches third-party assets at render time** (Card Conjurer audit 2026-09-25) — `lib/render/card-image.tsx` uses next/og `ImageResponse` with 5 registered fonts and no `emoji` / `loadAdditionalAsset`, so by next/og defaults an emoji pulls Twemoji from jsDelivr and an uncovered script pulls Google Fonts on every bake (the 2026-09-22 font-fetch outage lesson). Add a local-only asset resolver, strip or bundle emoji, and have validation warn on characters the bake can't render. Extends 6.16.

      Done: next/og hard-wires its loader, so Node renders (bake + node OG images) now call the same satori (pinned to next/og's bundled 0.25.0, `tests/unit/render/satori-pipeline.test.ts`) + sharp through `lib/render/satori-png.ts` with `lib/render/fallback-assets.ts`: satori's "unknown" class → Google's own Noto Sans 2.015, subset and committed (`public/fonts/NotoSans-Fallback.ttf`, 187 KB, `scripts/build-noto-fallback.mjs`) with a per-request cmap cut the way Google's `text=` subsets are; decomposed (NFD) Latin whose marks satori files under th-TH/he-IL/ja-JP → the same Noto answer (main fetched Noto Sans Thai/Hebrew/JP; within ~130 px of main's bake instead of losing the marks); emoji → stripped (transparent square); symbol/math/CJK/other scripts → nothing (symbols drew blank on main too; CJK draws blank or boxed). The creator warns (`GlyphCoverageNotice`, `lib/validation/card-glyphs.ts`) from per-face tables in satori's font order with an ink check — MPlantin maps Č/°/×/→/đ/∞/π and ~170 more to EMPTY glyphs, so those were already blank in rules text on main and are now flagged; italic runs never reach Noto; display lines say "may not show". Only 2 public production cards ever fetched (U+01F5 in an artist line, U+200B opening a flavor text); both bake byte-identical to their Google-fetching bake, and all 731 public cards bake byte-identical (default + HD).

      **Stored-render scope (owner, before merge and before the v29 sweep):** private/unlisted rows can't be read anonymously. On their next bake, a card changes only if its text has an emoji in rules/flavor (Twemoji image → blank), CJK/Arabic/Hebrew/Thai/Indic text (Google Noto → blank/box), or NFD marks outside Noto Sans' Google ranges. Count first — `select visibility, count(*) from public.cards where concat_ws(' ', title, supertype, array_to_string(subtypes,' '), rules_text, flavor_text, artist_credit, face_content::text, back_face::text) ~ '[̀-ͯ֐-ࣿऀ-෿฀-๿←-⯿⺀-鿿가-힯豈-﫿＀-￯\U0001F000-\U0001FAFF]' group by visibility;` (over-matches; confirm hits with `findUnrenderableText`). If emoji cards exist, either accept the strip for the listed ids or bundle Twemoji first-party (below) before merging.

      Follow-ups (not done): bundle Twemoji (8.6 MB of SVGs, CC-BY — own-CDN like frames, not traced; same SVG bytes keep emoji cards byte-identical) if users want emoji in images or the count above finds emoji cards; Noto Sans Symbols 2 / Math subsets for ★ ⇒ ′; CJK and other scripts stay with 6.16; MPlantin's empty glyphs in rules text are a pre-existing renderer bug (fixing it changes stored renders: layout bump + sweep — separate item). An emoji in a display line (title/type/artist) was already drawn as a Beleren box before this change, with Twemoji reachable (checked on main) — only rules/flavor emoji ever got the Twemoji image.
- [ ] **6.17 [P3] Hide reminder text toggle** (Card Conjurer audit 2026-09-25) — A per-card toggle, stored on frame_style, that drops `reminder` spans in the shared tokenizer and the fit estimate, in both renderers. The spans are already tokenized (`lib/cards/rules-text.ts`:205-214). Users delete reminder text by hand today to make text fit, especially after an import. CC has the option (`creator-23.js`:3390-3401).
- [x] (done 2026-09-29 — feat/jpeg-download-square-limit, shipped with 7.8 (same route): `?format=jpeg` on `/api/cards/[id]/png` (`lib/cards/output-format.ts`: `parseFormatParam`, `cardJpegHref`, `cardImageFilename`) is ALWAYS the square card — the Square PNG's bytes (a free viewer's stored bake squared with `squareCornerFillsOf`'s fills, a live watermarked square render where a corner keeps its drawing, a paid viewer's live clean square render) re-encoded by `lib/render/card-jpeg.ts` (quality 92, 4:4:4 chroma, sRGB, no EXIF/ICC/XMP), `corners` ignored, saved as `<slug>.jpg`, `format: "jpeg"` in the funnel's download row. `format` goes into the ETag for the JPEG only, so every PNG keeps the ETag it had; the URL carries `format=jpeg`, so the browser's cache key differs too. No or any other `format` is the PNG: 648 PNG request shapes (anonymous / free / paid × 9 templates × 3 bake stamps × 4 `corners` values × 2 presets) answer byte-identical bodies, headers and ETags to main's route, and main's ETags still 304. The modal's first tab is now "Image" with a PNG / JPEG "File type" switch for every viewer; on JPEG the corner switch shows Square with Rounded disabled and says why, and switching back restores the PNG's corner. No renderer, bake or layout change — no stored image moves. Left: the Pro deck export ZIP stays PNG (not asked for).) **6.18 [P3] Download format (JPEG)** (Card Conjurer audit 2026-09-25; **re-scoped 2026-09-27: the corners shipped with 3.26** — the Rounded/Square switch for every viewer, square in the border's colour, print always square, tier-aware modal copy. Left: an optional JPEG download.) — Downloads were always square. The M15 masters' transparent corners are filled with the bake background #101015 (`lib/render/card-image.tsx`:285), and other masters are opaque. CC defaults to transparent rounded corners with a square option, and also offers JPEG (`creator/index.html`:186-189, `creator-23.js`:4641-4676).

      - Add a 'Rounded (transparent) / Square (print)' choice on the PNG download (`components/cards/download-modal.tsx`). Rounded applies a proportional sharp corner mask (≈2.9 % of width) to the live or stored PNG.
      - Square fills the corners with the frame's border colour, not #101015.
      - Print, PDF and bleed outputs always stay square. JPEG is optional.
      - The modal says which option to use for printing and which for sharing.
- [ ] **6.19 [P3] Art adjustments (grayscale)** (Card Conjurer audit 2026-09-25) — Add an optional `art_position.grayscale`, applied identically in the uploader, the preview (CSS filter) and the bake (a sharp pre-filter in `withRenderableImages`, so Satori sees the finished pixels). Add 90° rotate steps only if users ask; the legacy `rotation` key is accepted by zod but never drawn (`lib/validation/card.ts`:206-208). CC has art rotation and grayscale (`creator/index.html`:323-338). Parity test.
- [ ] **6.20 [P3] Deck card with QR in the Pro deck export** (Card Conjurer audit 2026-09-25) — In the Pro deck export (ZIP + sheets), add a card-sized 'deck card' built from the deck cover, title, colour-identity pips, format/bracket and a server-rendered QR SVG pointing to `/deck/<user>/<slug>`. Place it on the first print sheet. CC's Deck Cover + QR template (`packCustomDeckCover.js`, `versionQRCode.js`) is the model. It is a cheap traffic loop from printed decks.
- [ ] **6.21 [P3] Custom colour tint **[decide]**** (Card Conjurer audit 2026-09-25) — CC's per-layer HSL / colour overlay is a frequent ask (a 'sixth colour'). Offer an HSL tint on the colour layers only, labelled custom/unverified, never on a verified combo's defaults.
- [x] (done 2026-09-29 — fix/pdf-landscape-cards, no layout bump, no bake or PNG changes: `cardSlotPlacement()` in `lib/render/card-pdf.ts` turns a landscape render (wider than tall) 90° anticlockwise into the portrait 180 × 252 pt slot, in the single-card page, every 3×3 sheet cell (Letter and A4) and both deck-export layouts (`buildDeckPdf` "pages" and sheets). The direction follows the printed card, per Scryfall's scans of Invasion of Zendikar (MOM) and Fire // Ice (MH2): the title reads bottom-to-top up the left edge and Fire sits in the bottom half, so the proxy reads when turned clockwise, the quarter turn `scripts/visual-audit.mjs` already undoes on a scan. The page stays 2.5 × 3.5 in, the sheet grid and crop marks are unchanged (the turned card fills the slot exactly), print stays `corners: "square"`, and a portrait render's content stream is byte-identical to before. `tests/unit/render/card-pdf-landscape.test.ts` replays each image's matrix from the saved PDF: single, Letter/A4 sheets, the mixed deck export, and real battle and split bakes.) **6.22 [P2] The card PDF squashes a landscape card** (3.26 review, 2026-09-27) — `lib/render/card-pdf.ts` draws every render into a portrait 180 × 252 pt box (`drawImage(img, { width: CARD_W_PT, height: CARD_H_PT })`, the single card and each 3×3 sheet cell), so a Battle or Split bake (2100 × 1500) prints squeezed to 5:7. Rotate it 90° into the portrait slot (a printed Battle is a portrait card turned sideways) or give it a landscape page; the Pro deck export's PDF goes through the same module (`buildDeckPdf`). Test with a real landscape bake.
- [ ] **6.23 [P1] Emblem card type and kind** (token research 2026-09-29; owner request; owner decisions 2026-09-29; takes over 6.4's emblem bullet; ships with 4.52) — Nothing exists: no card type, kind, DB value, frame or import mapping. Typing "Emblem" on a token prints "Emblem Token" with a P/T slot, and an import keeps the previous kind (1.23).
      - **Data.** Migration: the next free number (0122 is #397's, 0123 #400's, 0125 #406's, all merged; 0126 / 0127 are queued; 0128 is the v34 token release's), `NNNN_emblem_card_type.sql`: drop and re-add `cards_card_type_valid` (0018) with 'emblem', stating its grants (no new objects, none changed).
        - `cards.layout` already admits 'emblem' (0019 `cards_layout_valid`, with 'token' and 'double_faced_token'). Decide whether an emblem writes it.
        - Then update:
          - `CARD_TYPE_VALUES` and the labels (`types/card.ts`; the zod enum in `lib/validation/card.ts` reads it);
          - `types/supabase.ts` (hand-maintained);
          - `TYPE_HUB_COPY` (`lib/cards/hubs.ts`, a `Record<CardType, …>`, so typecheck asks for copy). `HUB_TYPES` adds `/gallery/type/emblem`, indexed only above its threshold;
          - the type icons (`components/creator/field-group.tsx`);
          - `ERA_TYPE_FRAME.m15.emblem = "emblem"` (4.52).
      - **Kind.** A `KindDef` `emblem` (card type emblem, preview `emblem`). **Owner 2026-09-29:** it is reached from the Token kind's picker (3b.15: Emblem next to Creature / Artifact / Enchantment), not listed as its own entry in the kind picker; the emblem is still stored as its own card type.
        - Fields: name (the source's name, e.g. "Kaito, Cunning Infiltrator"; the placeholder says so), rules text, art, artist, set icon.
        - Hidden: cost and the Pips step, colour (forced colourless), P/T, loyalty, supertype, rarity (new emblems are common, owner 2026-09-29; the E letter comes with 4.9).
        - An optional subtype prints "Emblem — Kaito" (the AFR and 2014–19 style). It is off by default, so the line reads "Emblem".
      - **Seed from a planeswalker.** A "Create emblem" action on a loyalty row whose text says `You get an emblem with "…"` (`components/creator/panels/loyalty-editor.tsx`) opens `/create` with a draft emblem: name = the walker's name, rules = the quoted text (like the `?backFor=` / `?deckCard=` seeds).
      - **Import:** 1.23. **AI:** keep emblems out of the AI dialogs' card-type lists until asked. In `lib/ai/mtg-rules.ts`, the no-cost warning at :278 exempts only land and token: add emblem.
      - **Copy and seeds.** The token hub already promises emblems (`lib/cards/hubs.ts`). Add "How do I make an emblem?" to the token article's FAQ, and one emblem to `supabase/seeds/*.sql`.
      - **Depends on:** 4.52 (its frame), 3b.15 (where it is offered).

      Acceptance: an emblem saves with no cost, P/T or colour and prints "Emblem"; 1.23's emblem fixtures pass; the migration applies on the PR's Supabase preview branch.

### Phase 7 — Ops and QA (continuous)

- [ ] **7.1 [P1] Visual-regression suite in CI** (from 3.11) extended to every
      newly published template; layout-version bump enforced when published
      pixels change.
- [x] (done 2026-09-25: 0.12's fold + migration 0114 (#372) removed the prod-only overrides; `frameUrl()` (#377) serves bucket frames everywhere; dev/local and dev-DB previews read the dev bucket, per-PR-branch previews via the Preview-scoped `NEXT_PUBLIC_FRAME_ORIGIN` (set in Vercel), CI e2e via `.env.e2e`; the `frames:check` production gate and the required "Frames published" check keep prod ⊇ manifest) **7.2 [P1] Preview parity** — previews/local render exactly like
      production (0.12, plus the storage origin from 4.2 available to
      previews).
- [ ] (partly 2026-09-25: `docs/FRAMES.md` exists (#377, #378) and covers the git-vs-bucket homes, the CC importer, shipping a frame change (publish → preview → owner promote → merge), owner setup and dev-branch reset; CLAUDE.md points to it. Still open: "how to add a frame", replacing the stale header in `lib/cards/template-layout.ts`, which still says to drop PNGs into `public/frames/<name>/`; the verification SOP; the provenance/legal notes; the CC non-goals below; and its CC section says "eight" templates where the importer builds nine) **7.3 [P2] `docs/FRAMES.md`** — pipeline, manifest, "how to add a frame"
      (replacing the stale headers in `template-layout.ts` and
      `types/card.ts`), verification SOP, provenance/legal notes; CLAUDE.md
      pointers.
      **Card Conjurer audit 2026-09-25:** (critic) Record CC's free-form editor as a deliberate non-goal (verified geometry wins): per-layer x/y/size/opacity/erase/HSL, uploaded frames and masks, free text-box bounds, `{kerning}`/`{permashift}`-style codes, extra text boxes. 0.24 names them honestly as CC advantages.
- [ ] **7.4 [P2] Admin dashboard tile** — verification progress, requests
      (1.6), scores, rebake state.
      (No tile yet, but the numbers exist on `/admin/frame-compare`: the
      checklist header counts verified, re-verify and with-reference combos
      (#374/#375), and the marked-renders panel shows what is owed a re-bake
      (#376). Requests wait for 1.6.)
      (2026-09-28: the requests live at `/admin/frame-requests` (1.6); a tile can read `admin_frame_request_counts(p_since)` through
      `getFrameRequestSummary()` in `lib/frames/frame-request-queries.ts`.)
- [ ] (partly 2026-09-25: the sweep tooling exists — `scripts/rebake-renders.mjs` `SCOPE=sweep` with a dry run, template/finish-scoped `VERSION_SCOPES`, and the admin `marked` re-bake loop (`/api/admin/rebake-marked`, #376). Still open: the /news post template and the FAQ entry; `lib/content/faq.ts` has neither) **7.5 [P2] Rebake operations** — sweep tooling for bundled bumps, /news
      post template, a "why does my card look different" FAQ entry.
- [ ] **7.6 [P1] Art-window coverage test** (Card Conjurer audit 2026-09-25) — Add `tests/unit/render/art-window-coverage.test.ts`: for every template × colour master, flood-fill alpha<16 from each `artSlot`/`secondFace.artSlot` centre and assert the (rotated) slot covers the window with ≥0.05 % overscan. Run it in the 4.3 importer on the flattened CC masters, after the 2010→1500 downscale has anti-aliased the window edge, and in CI.

      Today it would fail on:
      - split (a 1.2 % H strip)
      - lotr (ring 9.87–90.53 × 11.24–55.62 vs slot 14–86 × 13–58)
      - flip and alphaland
      - battle and lotrscroll (borderless PNGs)
      - hairlines on m15token (0.24 % H), saga and the MSE land/snow/artifact windows

      Fix those with 4.21 and the M15-family `artSlot` = CC artBounds (4.4). Translucent frames (4.17) are asserted differently.
      **Full-art research 2026-09-26:** check every colour of every master. The `expeditionland` b/g defect slipped through because the earlier checks sampled one colour.
      **Token research 2026-09-29:** the `m15token` hairline goes with 4.53 (e)'s art slot.
- [x] (done 2026-09-26 — wf/nf-renderer + feat/new-frames: `lib/frames/edge-contract.ts` holds the table and the checker — the table sits there rather than in the test so `scripts/import-cc-frames.mjs` runs the same check after its downscale and exits non-zero on a violation or an undeclared template; `tests/unit/frames/edge-contract.test.ts` checks every git master, and every bucket master when a local build matches the manifest's sha256 (`FRAMES_BUILD_DIR`, else `.frames-build`), with today's failures as `it.fails`. The check found four more ring templates the side-band survey missed — avatar, bloomburrow, lotr and tarkirdraconic (transparent bottom band and lower sides) — listed as known failures beside 7.7's list, for 4.35 / 4.11 (owner decision A8 2026-09-29: the signature registry caps every known failure but alphaland's corner specks at `nearest` until it is fixed — see 4.35). It passes on all 14 borderless masters (`m15borderless`: bar 7.76 % H, fins up the sides from 78.67 % H, measured on all nine CC masters), on `m15fullartland` (border; CC `textless/2022` rings are α 1.00) and on the re-sourced `fullartland` (art on every edge, plus its two bars)) **7.7 [P1] Edge-contract test (borderless-safe 7.6)** (borderless research 2026-09-25) — 7.6 asserts the frame is opaque outside the art window; an edge-to-edge treatment needs the opposite check. The manifest (4.1; a table in the test until then) declares each edge as `border`, `art` or `bar`, the same vocabulary as 6.1a's bleed recipe. For every template × colour master:
      - `border` → frame α ≥ 0.99 in the outer 2 % band;
      - `art` → the artSlot touches that edge (0 or 100 %) and the frame is α ≤ 0.05 there outside declared bars;
      - `bar` → an opaque band at least the declared height.

      This catches the #101015 ring. It fails today on bloomanime, tarkirghostfire, tarkirdragon, lotrscroll and battle, and passes on fullartland. Run it in the 4.3 importer after the 2010→1500 downscale, and in CI.
      **Full-art research 2026-09-26:** add `expeditionland` (b, g) to the fail list. New fixtures: `m15fullartland` (border), `fullartland` (art + bars), `m15textlesspromo` (border).
- [x] (done 2026-09-29 — feat/jpeg-download-square-limit, with 6.18: migration 0125 `anon_render_hits` (32-hex key, minute, count — nothing else) + `hit_anon_render_limit(key, per_minute, per_hour)`, service-role only (RLS on with no policy; table and function revoked from PUBLIC/anon/authenticated). `lib/cards/anon-render-limit.ts` counts a SIGNED-OUT caller's LIVE renders — a Square PNG or JPEG with a null corner fill, and any download with no servable stored bake (the sweep window) — per network (an IPv4 address, IPv4-mapped IPv6 unwrapped to it in either notation; an IPv6 /64) under an HMAC-SHA-256 key with the server secret, so no address is stored and none can be looked up without the secret; a caller with no readable address (only possible off Vercel, whose edge always sets x-real-ip) is let through, never pooled into one shared bucket. 10 a minute and 60 an hour per network (a sweep window's worth for a person, not a script); over either, `rateLimitedResponse` answers 429 + Retry-After (to the next minute, or until the hour's oldest counted minute leaves it); a refused call counts nothing; one advisory lock per key; each call drops windows older than the hour, so no prune job; a database error lets the render through, like the per-user limiters. Signed-in viewers, stored-bake serves (PNG and JPEG) and 304s never reach it. Owner: nothing beyond the merge — the Supabase integration applies 0125 to production with it.) **7.8 [P2] Rate-limit anonymous live Square renders** (3.26 round 7, owner 2026-09-28: later, its own item) — `/api/cards/[id]/png?corners=square` serves a free viewer the stored round bake squared (a few ms of sharp), except where a corner keeps what was drawn there (`squareCornerFillsOf` returns a null fill): the `artReachesCardEdge` templates (m15borderless, m15borderlessartifact, fullartland) and the drawn top corners of bloomburrow, lotr and tarkirdraconic. Those render LIVE (a Satori render per request) for anyone, signed out included, and nothing limits an anonymous caller: the only short-circuit is the ETag 304 (`private, max-age=0, must-revalidate`), which a client that drops `If-None-Match` skips. Any free download, round or square, also renders live while its card has no servable stored bake (`fetchStoredRender` → `hasServableStoredRender`: a pending platform correction, e.g. between a sweep bump's deploy and its sweep, or a missing bake). Add an anonymous limiter on the live path only (the stored-bake serves stay unlimited; size it for a sweep window) and answer over it with `rateLimitedResponse` (429 + Retry-After). It needs a small migration — a windowed counter the route can write without a session (the per-user limiters, `lib/scryfall/rate-limit.ts` / `lib/ai/rate-limit.ts`, key on `user_id`), keyed so no raw identifier is stored (the funnel rule: anonymous rows carry none) — with its grants stated. 0 public cards on those templates today, so nothing is exposed yet; ship it before one is.
- [x] (done 2026-09-28 — chore/seed-verified-frames-final) **7.9 [P2] `supabase/seed.sql` mirrors production's verified frames again** (**owner decision 2026-09-29, A7 of the Lane-B questions: a new small supabase PR that mirrors production's verified `frame_reviews`, never ahead of it**) — The seed still held the 2026-09-21 snapshot (71 combos), so per-PR preview branches, fresh local stacks and the e2e stack offered none of the Borderless, Borderless Artifact or full-art basic frames production has verified since. It now mirrors a read of production's `frame_reviews` on 2026-09-28: 97 combos — twelve templates in every colour (m15borderless and m15borderlessartifact added), `fullartland` and `m15fullartland` in every colour but gold, and modern/w. Only the verdict is seeded: `verified_by`, the pinned reference and 0115's measurement columns stay NULL (the admin page reads the rows as pre-0115 ticks). `tests/unit/cards/seed-frames.test.ts` now also fails on a combo listed twice and on a header count that disagrees with the rows; the borderless import e2e expects the "Use Borderless" offer, since m15borderless/b is verified on the e2e stack now. Owner step after merge: run the file's frame_reviews block (`-- frame_reviews:begin` … `-- frame_reviews:end`) in the SQL editor of the `dev` branch (`znipzaxgpaiandwiqabn`), never production; the dev DB holds exactly the old 71 combos, and `on conflict do nothing` adds the 26 new ones and overrides nothing. **Not** `npm run db:seed:dev`: the dev branch has already run `supabase/seed.sql` (its `supabase_migrations.seed_files` row holds main's hash), and the Supabase CLI never re-runs a seed file — for a changed one `db push --include-seed` only records the new hash (`pkg/migration/file.go`, `ExecBatchWithCache` skips a `Dirty` file's statements). The seed header and docs/ENVIRONMENTS.md now say so. Refresh again whenever production verifies more, or withdraws a tick (the A6 walk-through re-verifies m15snow w/b/g and m15token/c; a withdrawn combo leaves this list, and on the dev branch it is unticked by hand, since seeds only insert) — the query is in the file's header.

Sequencing at a glance (re-ordered 2026-09-25, owner decision: de-risk the
Card Conjurer frame swap early): Phase 0 (0.20 + 0.21, and 0.23's legal wording, before the swap) →
3.13 + 3.14 (P0 live bugs) → 4.16–4.20 bundled INTO 4.4's single sweep →
**4.1–4.4 (manifest, storage
move, CC importer, M15 re-source) with one bundled layout bump/rebake** →
1.1–1.6 + 3b.1–3b.5 alongside Phase 2 → Phase 3 + rest of 3b → 4.5–4.9 and
4.11 in request-log order (4.10 when references exist) → Phase 5 → Phase 6
(6.1a/6.1b as soon as 4.4 lands); Phase 7 throughout.

Where that sequence stands (2026-09-25, `267f46c`): Phase 0 done bar 0.17,
0.18, 0.22 and 0.24; 0.23 won't-do. The swap went out BEFORE 3.13/3.14: 4.2,
the 4.3 importer and 4.4 with 4.16–4.18 inside it shipped as v24 (#377–#380),
then the review follow-ups as v25–v28 (#381/#382). 4.19 (partly), 4.20, the
M15 artSlot and 7.6 did not ride in v24; they can follow as their own badge-free
sweeps. 4.1's manifest/codegen is still to do. In flight: the 4.31 leftovers,
3.13, 3.18 and 0.22. 3.14 is fixed, and so is its follow-up 3.14a (2026-09-29; the owner's production clean-up is done too). Next in this
order: 1.1–1.6 with 3b.1–3b.5
alongside Phase 2. 6.1b is not unblocked by 4.4: it also needs native-size
masters (see its note).

Borderless (research 2026-09-25): 0.25 + 1.16 now; 3.23 → 4.32 (+7.7) can
start now that 4.4 has shipped (#380) — a new template, so no sweep and no
badge; 1.17/1.18 with 1.4/1.5; then 4.33 → 4.34; 4.35 any time before 1.17
goes live; 4.36–4.38 and 5.7 by the 1.6 log. (2026-09-26: 3.23, 7.7 and 4.32
done in feat/new-frames; owner: `frames:promote` before merge, then per-colour
verification. Split out: 3.25 multi-layer shadows, 3.26 the corner radius.)

Full art (research 2026-09-26): 0.26 now, and the full-art half of 1.16 in the
same PR as 1.16. Then 3.24 → 4.39 (bordered + borderless full-art basics)
after 3.23. 1.19 goes with 1.4/1.17. Then 4.40 → 4.41 → 4.42. 4.43, 4.44 and
the per-set basics (4.11) follow by the 1.6 log. Every template here is new or
unused, so none needs a badge. 3.24's scoped sweep re-bakes only private cards
on fullartland/m15textless*, if any exist. (2026-09-26: 3.24 and 4.39 done in
feat/new-frames — v30 scoped to fullartland; owner: `frames:promote` before
merge, the private-row count on fullartland before the sweep, verification.)

Tokens (research 2026-09-29, owner request; owner decisions 2026-09-29): 4.49
(P0) and 3b.15 first, in parallel. 4.49's P/T plate and left type line can go
out as their own sweep (it resets the 14 token ticks, re-verified against the
new pins); `m15tokentext` follows once its re-cut master is verified on
production, and the stored text rows move to it (the scrim goes with them) in
the release after. 3b.15 ships the picker on today's frames with its own
verification-neutral wording sweep (one bump with 4.49 if they land together;
that bump resets the ticks), and 1.23's search half with it. Then 4.52 + 6.23
together (a new card type and frame, no sweep); then 4.48 + 4.50 (new
templates, no sweep; new tokens default to the full-art family once they are
verified) and 4.53 with or after them; 4.51 last (a composite the owner signs
off by eye); 4.54 (retire `alphatoken`) any time after its row count. 1.23's
design rules build on 1.4's registry (#396, merged 2026-09-29).
(2026-09-29: 4.49 (a) + (d) and 3b.15 (all but the Emblem choice) built
together on `feat/token-v34` — ONE layout bump, v34, card-scoped, "sweep",
resetting the 14 token ticks; migration 0128. 4.49 (b)'s `m15tokentext` /
`m15tokenartifacttext` built on `feat/token-textbox`: new templates, no bump,
awaiting promote + verification, then the stored-row move. Next: 1.23's
search half, then 4.52 + 6.23. 4.48 + 4.50's six full-art templates built on
`feat/fullart-tokens`: new, no bump, awaiting promote + verification; the
default switch + automatic height in `lib/creator/token-frame-auto.ts`, wired
after round 11's arch auto-pick merges.)

## Billing audit follow-ups (2026-09-24)

What's left from the 2026-09-22 billing audit (docs/BILLING.md §5–§9 record
what shipped: trial reminder, scheduled downgrades, revenue log, checkout
recovery, free credits once, packs in the modal + $4 pack + subscriber pack
price, card-required trial with 25 trial credits, win-back offer). Owner
decides each item; every one is a summary-and-questions round first.

### Pricing recommendations (audit §6, in order of expected impact)

- [x] **Funnel instrumentation** (recommendation 9) — shipped in #367
      (`funnel_events` 0112, admin Funnel panel) and extended with activation
      milestones, signup attribution, trial engagement and bot filtering
      (0113). Remaining ideas: W1/W4 cohort retention rollup; refund and
      dispute events (`charge.refunded`, `charge.dispute.created`).
- [ ] **Wider annual discount** (recommendation 4). Plus $60 → $48/yr, Pro
      $150 → $120/yr (33% instead of two months free). New annual prices on
      BOTH Stripe catalogs (lookup keys `plus_annual`/`pro_annual` move to
      the new prices; old ones archived — existing annual subscribers keep
      their price), `PLANS[].annualUsd`, pricing copy, the
      "annual = monthly × 10" unit test, `tierForAmount` in
      `lib/stripe/config.ts`.
- [ ] **Visible daily Plus perk** (recommendation 5). Strongest: a
      "Download clean" button on every card page that opens the upgrade
      modal for free viewers (`components/cards/download-modal.tsx`).
      Cheapest: a Plus/Pro badge on profiles + custom banner link. Optional:
      one free clean HD download per account as a taste.
- [ ] **Reposition Pro as the deck tier** (recommendation 6). Bundle the
      Pro-only features (whole-deck generation, deck guides, print sheets,
      deck ZIP/PDF export) and make them tangible on `/pricing`; consider a
      monthly "deck showcase" gallery slot; price: $12/mo, or keep $15 and
      add bonus credits on annual. Copy in `lib/billing/plans.ts` +
      `app/(marketing)/pricing/pricing-content.tsx`.
- [ ] **Founding-member offer** (recommendation 7). First 100 subscribers
      lock Plus at $4/mo for life: a dedicated Stripe price (both catalogs),
      a counter (`site_settings` or a small table), a banner with the
      remaining count, and a rule that the price never changes for those
      accounts (the price id itself guarantees it).
- [ ] **Ship the promised premium frame set** (recommendation 8) — the one
      paid perk still listed as "coming soon" (`PAID_COMING_SOON` in
      `lib/billing/plans.ts`); design work as much as code. Turn "Card
      printing" from coming-soon into an affiliate link to a print-on-demand
      card service so the coming-soon list stops being a liability.

### Operational (from the audit's standards comparison)

- [ ] **Stripe Tax** before meaningful EU/UK volume (`automatic_tax` is off
      on every checkout; VAT thresholds there are low).
- [ ] **Sandbox test clock**: advance "pipglyph lifecycle 2026-09-22"
      (Dashboard → Customers → Test clocks) past the trial end and the
      period end to watch a no-card trial cancel and a cancelled plan end;
      the Stripe MCP can create clocks but not advance them.
- [ ] **Vercel housekeeping** from the 2026-09-14 quota incident: prune old
      deployments (`vercel rm cardforge --safe` keeps every aliased
      deployment), confirm the plan (Pro unlocks automatic deployment
      retention under Project → Settings → Security), and update the Vercel
      CLI (`npm i -g vercel@latest`, several majors behind).
- [ ] **docs/BILLING.md gap 7**: no automated hosted-checkout test — a
      monthly manual run on the `dev` alias, or a Playwright job with the
      Stripe test card against it.
- [ ] **Stale `docs/BILLING.md` wording** is fixed as of #365; keep §5–§9
      in step with future billing PRs.

## Audit follow-ups (2026-09-14)

Open findings from the full-site audit (verified). Items already fixed in PRs
#251–#255 are not listed; the full report with evidence is the session's
audit artifact. Numbers in brackets are severities; `file:line` points at
the evidence.

### Critical / high — fixed in PR #256 (`fix/critical-rls`)

- [x] **[critical] Owner-writable/deletable `ai_generation_jobs` rows turned the reconcile cron into a self-serve credit refund** — migration `0073_ai_jobs_service_role_writes.sql` drops the owner UPDATE/DELETE policies; `claim_job_step` / `patch_job_step` are now EXECUTE-able by `service_role` only and the server executor (`lib/ai/generation-jobs.ts`) checks ownership before calling them through the admin client. Owners keep SELECT + INSERT (create a job) only.
- [x] **[high] `profiles` was world-readable including Stripe ids, credits, comp/admin flags** — migration `0074_profiles_billing_columns.sql` revokes table SELECT from `anon`/`authenticated` and grants column-level SELECT on the public columns only; the owner reads their own billing state through the SECURITY DEFINER `get_my_billing()` RPC (`getCurrentProfile` merges it in) and the export watermark decision goes through `owner_export_stamp(p_owner_id)` so public render routes never read billing columns.
- [x] (done 2026-09-22 — migration 0106: `credit_ledger.settled_at` + `settle_spend(p_ref)`; `patch_job_step` settles atomically with the done-write, the idea routes call `settleSpend()`, the sweep refunds aged unsettled spends and never reads job rows) **[follow-up] Settlement proof still lives in job JSON** — the reconcile cron reads `steps` to decide refunds. With owner writes gone this is no longer exploitable, but a `settle_spend(p_ref)` RPC that stamps `credit_ledger.settled_at` from the executor would make the sweep independent of job rows entirely.

### Medium

- [x] **[medium] Password-reset and confirmation links only work in the browser that requested them (PKCE verifier cookie)** — fixed 2026-09-17 (`fix/auth-audit`): branded templates in `supabase/templates/` link to `/auth/confirm?token_hash=…&type=…`, which verifies on a button press (any browser, scanner-safe). **Owner step:** push the templates to production — `docs/EMAIL.md`.
- [x] (fixed 2026-09-21 — listPublicCardsByOwner + the profile count are public-only) **[medium] Unlisted cards are listed (and counted) on the creator's public profile page** — `app/(marketing)/profile/[username]/page.tsx`:482. Change `listPublicCardsByOwner` and the count query to `.eq("visibility", "public")` (the pinned path at :668 already does), and keep `SHAREABLE_VISIBILITIES` only for the direct-link/OG routes. If unlisted-on-profile was intended, update the publish-panel and
- [x] **[medium] OAuth-provider avatar URLs go through next/image without `unoptimized`, but only Supabase storage hosts are allowlisted** — `components/cards/card-detail-content.tsx`:843. Fixed 2026-09-17 (`feat/onboarding-email`): `unoptimized` added.
- [x] (fixed 2026-09-21 — hero + every tile use cardToPreviewData()) **[medium] Card detail page hand-builds the front-face <CardPreview> bag and omits `watermark`/`faceContent` while importing cardToPreviewData for the back card — live preview diverges from the bake** — `components/cards/card-detail-content.tsx`:279. card-detail-content.tsx: `<CardPreview {...cardToPreviewData(card, profileOverrides)} pipOverrides={pipOverrides} backFace={...} backCard={...} footerWatermark={...} />` once cardToPreviewData carries backFace (see dup-01 fix). set-card-sortable.tsx: `<CardPre
- [x] (verified fixed — card-creator-form clears has_back_face/back_face on leaving an inline-face kind) **[medium] Leaving an Adventure/Split/Flip/Aftermath kind never clears has_back_face — standard frames then can't save or persist a phantom back face** — `components/creator/card-creator-form.tsx`:778. In applyKindPatch, when `!KIND_DEFS[nextKind].inlineSecondFace` and the previous template `hasInlineBackFace`, `setValue("has_back_face", false)` and reset `back_face` to EMPTY_BACK_FACE; additionally make runSubmit send `back_face: null` unless `hasInlineBack
- [x] (fixed 2026-09-21 — seeded rows capped at 6; unrendered server field errors become the toast) **[medium] Server field errors on keys no panel renders (face_content, back_card_id) are swallowed; 7-row planeswalker can never be saved** — `components/creator/card-creator-form.tsx`:1401. Mirror the counts in cardFormSchema (issue on `loyalty_abilities`/`saga_chapters` when surviving rows > 6), cap seeded rows at 6 in the kind-switch seeding, and in applyFieldErrors fall back to `setServerError`/toast for any key `buildFieldToStep()` does not m
- [x] (fixed 2026-09-21 — CardCreatorForm keyed on the flow (backFor / deck remix / remix parent)) **[medium] 'Create a new card' for the back face navigates /create → /create?backFor= without remounting the form** — `components/creator/card-creator-form.tsx`:1483. Key the form on the flow in create/page.tsx (`key={backFor?.id ?? deckRemix?.deckCardId ?? "new"}`), or add an effect in the form that `reset(defaults)` + `goToIndex(0)` when `backForCardId` changes and skips the pending draft write.
- [x] (fixed 2026-09-21 — schemas accept null; the edit form sends null for an emptied field) **[medium] Deck edit cannot clear the description or remove the cover — 'Changes saved' but nothing changes** — `components/decks/deck-creator-form.tsx`:153. Give the wire format an explicit 'clear' value: make `deckDescriptionSchema`/`deckCoverUrlSchema` `.nullable()` (e.g. `optionalEmptyString(schema).or(z.null())`) and have the form send `null` (not `undefined`) when the trimmed input is empty in edit mode; `upd
- [x] (fixed 2026-09-21 — Tier 4b consolidation) **[medium] Gallery search/filter changes keep a stale ?page while the sets/decks search copies reset it** — `components/gallery/gallery-filters.tsx`:88. Extract `useSearchParamPatch()` (sets/deletes keys, always deletes 'page', router.replace with scroll:false) into lib/routing/use-search-param-patch.ts and use it in gallery-filters, sets-search and decks-search.
- [x] (fixed 2026-09-21 — migration 0098 SELECT policy: readable wherever the card is (public/unlisted, or owner), or by author) **[medium] Comments are accepted on unlisted cards but the SELECT policy only exposes comments on public cards** — `lib/cards/comments-actions.ts`:104. Add a migration that drops and recreates the SELECT policy with `c.visibility in ('public','unlisted')` (link-holders and the owner can read/moderate), or alternatively reject unlisted in createCommentAction and hide the composer on unlisted pages — but keep t
- [x] (dup — 0098 (PR #329)) **[medium] Comments on UNLISTED cards are invisible to the card owner (and every non-author viewer) yet still fire an owner notification** — `lib/cards/comments-actions.ts`:104. New migration replacing the 0019 SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()` — i.e. comments readable wherever the card is read
- [x] (fixed 2026-09-21 — resolveCardReportsAction → purgeHiddenCard(): card/profile/gallery paths + OG route + CDN tag purge) **[medium] Admin 'Hide card' does not purge the card's cached surfaces or the CDN-cached OG image, unlike the owner-side private flip** — `lib/moderation/actions.ts`:178. Export `revalidateCardPaths`/`revalidateDiscoverySurfaces` (or a `purgeCardEverywhere(cardId, slug, ownerUsername)` helper) from lib/cards/actions.ts and call it from the hide branch, including `revalidatePath(`/api/cards/${cardId}/og`)`; select `slug` and the
- [x] (fixed 2026-09-21 — 0098: uniqueness is per PENDING report (partial unique index); 23505 now only means a duplicate open report) **[medium] Re-reporting a card/comment after its earlier report was dismissed/actioned is silently swallowed as success (owner can re-publish a hidden card unflagged)** — `lib/moderation/actions.ts`:48. Replace the plain UNIQUE with a partial unique index `where status = 'pending'` (migration), and on 23505 (now only true duplicates) keep the idempotent success. Alternatively, on conflict do `update ... set status='pending', reason=..., created_at=now() where
- [x] (fixed 2026-09-21 — scan happens before the canonical object is touched; a flagged image leaves the approved pip intact) **[medium] Flagged custom-pip upload deletes the owner's previously approved pip object but leaves the custom_pips row pointing at it** — `lib/pips/actions.ts`:121. Moderate before overwriting the canonical object: scan the normalized PNG bytes (base64 data URL) or upload to a temp path, scan, then copy to the canonical path; only upsert the object + row after the scan passes, leaving an existing approved pip untouched on
- [x] (fixed 2026-09-21 — checklist embeds MPlantin via @pdf-lib/fontkit; unencodable code points → '?') **[medium] Deck export 500s whenever a deck title or card name contains a non-WinAnsi character** — `lib/render/card-pdf.ts`:338. Embed a Unicode-capable TTF for the checklist (register `@pdf-lib/fontkit` and `doc.embedFont(<Beleren/MPlantin bytes from lib/render/card-fonts.ts>)`), or sanitize heading/lines by replacing characters Helvetica cannot encode; also cap the heading length.
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) **[medium] Set editor cannot clear cover, icon, or description — 'Remove'/'Use default' save as silent no-ops** — `lib/sets/actions.ts`:210. Same fix as bugs-b-01: make the four optional string schemas accept `null` as an explicit clear, have the form send `null` for emptied fields in edit mode, and keep `update.x = data.x ?? null`. The `iconChanged` computation then works unchanged and triggers th
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) **[medium] deleteSetAction leaves every member card rendering the deleted set's symbol (stale set_icon_url/set_icon_code, no re-bake)** — `lib/sets/actions.ts`:302. In `deleteSetAction`, before the delete, select `cards.id` where `primary_set_id = setId`, then for each either re-home to the oldest remaining membership (reuse `repointPrimaryAfterRemoval`) or clear `set_icon_url`/`set_icon_code`, and schedule the deferred b
- [x] (fixed 2026-09-21 — out → public/frames/expeditionland) **[medium] build-variation-frames.mjs writes the Expedition frame to public/frames/expedition, but the shipped template is expeditionland** — `scripts/build-variation-frames.mjs`:90. Change scripts/build-variation-frames.mjs:90 to `out: "public/frames/expeditionland"` and the header at :7 to `expeditionland`.
- [x] (fixed 2026-09-21 — 0100 ports the 0057 guard to cards (view_count/likes_count/share_count no longer bump updated_at)) **[medium] cards.updated_at is bumped by every view and like — gallery 'Recent' sort means 'recently viewed' (the 0057 deck fix was never applied to cards)** — `supabase/migrations/0003_card_data_model.sql`:160. New migration porting the 0057 guard into set_cards_updated_at: `if (to_jsonb(new) - 'view_count' - 'likes_count' - 'updated_at') is distinct from (to_jsonb(old) - ...) then new.updated_at = now(); else new.updated_at = old.updated_at; end if;`. Note in the PR
- [x] **[medium] (fixed 2026-09-21 — seed.sql seeds prod's verified frames, seeds/10_dev_data.sql the rest) seed.sql claims no baseline rows are required, but an empty frame_reviews table leaves the creator with zero pickable frames on every preview branch and fresh local stack** — `supabase/seed.sql`:11. Replace L11-14 with:
-- Baseline rows: frame_reviews. Frame verification is the ONLY gate the creator
-- has (lib/cards/frame-availability.ts) — with this table empty, /create offers
-- no frames and every card kind renders as "Soon". Seed the verified
-- (tem
- [x] (verified fixed — homepage strip derives from plans.ts) **[medium] Homepage pricing strip sells 'the AI set generator' and 'premium finishes' as paid perks that plans.ts says are not live (and finishes are explicitly a Free-tier feature)** — `app/(marketing)/page.tsx`:126. Derive the homepage blurb from PLANS (credits, watermark-free hi-res exports, capacity) and drop the two coming-soon perks; align faq.ts:164 and :244 with plans.ts.
- [x] (fixed 2026-09-21 — §3 names Stripe, Resend, the AI Gateway providers (Anthropic, Black Forest Labs, Google), OpenAI moderation, Slack) **[medium] Privacy page omits Stripe, OpenAI (upload moderation) and the image-generation providers the code actually sends data to** — `app/(marketing)/privacy/page.tsx`:65. Add Stripe (billing; email + payment handled by Stripe), OpenAI (automatic moderation scan of uploaded images), and the Vercel AI Gateway image providers (Black Forest Labs, Google) to §3; reword the Anthropic bullet so it doesn't imply AI providers are contac
- [x] (fixed 2026-09-21 — feature-grid tile → Decks and proxies; free-account FAQ says 'build decks') **[medium] Marketing copy and FAQPage JSON-LD advertise the Sets feature as shipped while it is feature-flagged off (/sets 404s, nav hidden, 'Custom sets' listed as coming soon)** — `lib/content/faq.ts`:39. Gate every sets claim on isSetsEnabled() (or rewrite to 'decks'), regenerate the FAQPage JSON-LD from the gated list, and keep marketing copy in sync with PAID_COMING_SOON.
- [x] (fixed 2026-09-21 — answers describe FLUX via the AI Gateway, 'Generate with AI', credits, 'Get ideas') **[medium] AI generator FAQ (also emitted as FAQPage JSON-LD) describes an OpenAI image model, a 10-per-day quota, a BYO-OpenAI-key roadmap and a 'Generate random card' button — none match the code** — `lib/content/faq.ts`:97. Rewrite the AI_GENERATOR_FAQ answers to describe the AI Gateway providers, the credits model (5 free credits, then plans/packs), and the 'Generate with AI' dialog; drop the BYO-key sentence; keep faq.ts as the single source so JSON-LD follows.
- [x] (fixed 2026-09-21 — Tier 4b consolidation) **[medium] admin/rebake re-inlines bake-render.ts's upload → getPublicUrl → ?v= → row-update sequence and the private-card cleanup; the copy dropped the retry + leak log** — `app/api/admin/rebake/route.ts`:136. Move `uploadRenderAndPersist(supabase, path, pngBytes, cardId)` and export `removeRenderObject` from lib/cards/bake-core.ts (its stated purpose is shared bake plumbing); bake-render.ts and rebake/route.ts both call them so the retry+log applies to rebake.
- [x] (fixed 2026-09-21 — all six remaining literals replaced with cardToPreviewData()) **[medium] Nine card-tile previewData literals duplicate cardToPreviewData and all omit watermark/faceContent** — `components/cards/gallery-card-tile.tsx`:64. Replace each literal with `previewData={cardToPreviewData(card, profileOverrides)}` (cardToPreviewData already accepts Card; trending/gallery tiles pass profileOverrides where they have it).
- [x] (fixed 2026-09-21 — `supabase unlink` on every exit path) **[medium] db-push.mjs leaves the Supabase CLI linked to production after the confirmed push** — `scripts/db-push.mjs`:74. Unlink on every exit path (`process.on('exit', () => spawnSync('supabase', ['unlink'], {stdio:'inherit'}))` plus after a successful push), or run link+push against a temporary copy of `supabase/` via `--workdir` so the repo's CLI state never points at prod; pr
- [x] (fixed 2026-09-21 — lib/sets/upload-cover-server.ts: Sharp-validated, session-owned, NSFW-scanned; uploadSetCover() is now a thin client wrapper) **[medium] Set icon upload from the creator is a browser-direct storage write with no moderation scan** — `components/creator/panels/set-icon-panel.tsx`:61. Add a server action mirroring upload-watermark-server.ts (auth, size cap, Sharp sniff/normalize, scanImageUrl, then upload) and call it from SetIconPanel — and from the set/deck cover uploaders; optionally restrict set_icon_url to the app's storage host.
- [x] (dup — fixed in PR #329) **[medium] Unlisted cards are listed on the creator's public profile grid and counted as 'public cards'** — `lib/cards/queries.ts`:700. Decide the contract: either change listPublicCardsByOwner and the profile count to `.eq("visibility", "public")` (matching listMoreFromOwner and the empty-state copy 'hasn't published any cards publicly'), or reword the Unlisted option to 'hidden from the gall
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) **[medium] Public /set/[slug] resolves by slug across ALL owners — any user can hijack another user's set URL** — `lib/sets/queries.ts`:251. Before re-enabling sets, either (a) make set slugs globally unique like decks (0055:27) via a migration that adds a global unique index and renames collisions, and change `ensureUniqueSetSlug` to check across all owners; or (b) move the public route to /set/[u
- [x] (fixed 2026-09-21 — useOptimistic is based on a settled useState the action result updates) **[medium] Like hearts revert to 'un-liked' after a successful like on the anonymous-rendered listing pages (gallery, sets, decks, home trending)** — `components/cards/quick-like-button.tsx`:126. Keep a real `useState` for the settled value: `const [settled, setSettled] = useState({liked: initialLiked, count: initialCount})`, feed `useOptimistic(settled, ...)`, and after the action `setSettled({liked: result.liked, count: result.likes_count})`; sync `s
- [x] (fixed 2026-09-21 — /dashboard/cards lists every card (PR #322)) **[medium] Dashboard caps every section at 6 cards and there is no 'all cards' view — older private/unlisted cards become unreachable** — `components/creator/dashboard-selectable-sections.tsx`:246. Add a `/dashboard/cards` route (paginated `listMyCards` with visibility filter + search, reusing DashboardSelectableSections' bulk actions) and link each dashboard section header to it ('View all N →'); as a minimum, drop the `.slice(0, 6)` on Drafts or make t
- [x] (dup — 0098 (PR #329)) **[medium] Comments on unlisted cards: form is shown, insert succeeds, owner is notified — but RLS hides the comment from the owner and every other viewer** — `supabase/migrations/0019_v2_compat.sql`:125. New migration replacing the SELECT policy with `exists (select 1 from public.cards c where c.id = card_id and (c.visibility in ('public','unlisted') or c.owner_id = auth.uid())) or author_id = auth.uid()`; or, if unlisted threads are unwanted, gate the UI + IN

### Low (batch when convenient)

- [x] (fixed 2026-09-21 — the four pages use a <div> inside AppShell's single <main>) Four SEO landing pages render a second <main id="main"> nested inside the AppShell's <main id="main"> (duplicate id, nested main landmark) — `app/(marketing)/mtg-card-maker/page.tsx`:72
- [x] (fixed 2026-09-21 — OG responses carry Vercel-Cache-Tag: card-<id>; lib/cards/cache-purge.ts dangerouslyDeleteByTag on private/delete/hide) OG image stays CDN-served after a card goes private; revalidatePath on the route cannot purge it — `app/api/cards/[id]/og/route.ts`:28
- [x] (fixed 2026-09-21 — 0099: claims start unprocessed, stamped after the handler; stale (>10 min) claims are taken over and re-run) Webhook claims the Stripe event before processing; a kill mid-handler makes the event unrecoverable — `app/api/stripe/webhook/route.ts`:39
- [x] (fixed 2026-09-21 — chunked (200) with the error logged; only a failed chunk's cards are skipped) Sitemap owner lookup uses an unbounded .in() over up to 5000 owner ids and ignores the query error, silently dropping every card URL when it fails — `app/sitemap.ts`:213
- [x] (fixed 2026-09-21 — /pricing added) Sitemap never lists /pricing even though billing is live and the page is canonical, indexable and linked from nav/footer — `app/sitemap.ts`:43
- [x] (fixed 2026-09-21 — dup — same fix) Card-detail hero preview omits the card's watermark (and faceContent) although cardToPreviewData exists — `components/cards/card-detail-content.tsx`:279
- [x] (obsolete — no localStorage draft timer exists any more) Create-mode draft timer can re-persist the localStorage draft after a successful save — `components/creator/card-creator-form.tsx`:1433
- [x] (fixed 2026-09-21 — the label forwards caption clicks only to input/textarea/select) FieldGroup wraps button toolbars in a <label>, so clicking a field's caption/helper text fires the first button — `components/creator/field-group.tsx`:71
- [x] (fixed 2026-09-21 — key = a per-form requestId minted client-side and rotated after each success) Grant-credits idempotency key embeds Date.now(), so the documented double-submit dedupe never happens — `lib/admin/user-actions.ts`:89
- [x] (dup of the OG CDN item — fixed by the Vercel-Cache-Tag purge (PR #329)) revalidatePath('/api/cards/{id}/og') is a no-op for the CDN cache — a card flipped to private keeps serving its OG image — `lib/cards/actions.ts`:630
- [x] (fixed 2026-09-21 — same pre-flight in updateCardAction) updateCardAction writes parent_card_id without the existence/self-reference pre-flight createCardAction performs — `lib/cards/actions.ts`:560
- [x] (fixed 2026-09-21 — bake pre-resolves the art and refuses to render without it) Bake persists an art-less PNG as a successful, current-version render when the art fetch fails — `lib/cards/bake-render.ts`:136
- [x] (fixed 2026-09-21 — freshness check before upload + compare-and-set on updated_at when persisting) Overlapping bakes for the same card can persist the older render over the newer one — `lib/cards/bake-render.ts`:94
- [x] (fixed 2026-09-21 — the default template's override also matches NULL-template rows) Saving a frame-profile override doesn't mark cards without an explicit template stale, though they render with that override — `lib/cards/frame-profile-override-actions.ts`:54

### Deferred by owner decision (2026-09-14) — do not implement yet

- [x] **Email delivery for admin → user messages.** Done 2026-09-17 (`feat/onboarding-email`): branded team-message email gated by the user's "Account & team messages" preference (default on), plus the daily activity digest and the newsletter — `docs/EMAIL.md`. Owner steps: `RESEND_API_KEY` + verified `EMAIL_FROM` in Vercel.
- [ ] **Optional Stripe webhook events for subscriber UX.** The six events the webhook handles today (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`) are all that correctness needs. Add these only together with a handler + email: `customer.subscription.trial_will_end` (3-day "your trial ends, card on file?" reminder), `charge.dispute.created` (admin alert so a dispute is answered inside Stripe's window), `invoice.upcoming` (annual-renewal heads-up). `invoice.paid` is NOT needed — `customer.subscription.updated` already carries the renewed period.
- [x] (fixed 2026-09-21 — dup — same fix) Saving a frame layout override never marks cards with no frame_style.template stale, though they render on that template — `lib/cards/frame-profile-override-actions.ts`:54
- [x] (fixed 2026-09-21 — revalidateChallengeSurfaces purges /challenges/[slug]) Challenge admin actions never revalidate /challenges/[slug], so 'Close now' / feature toggles leave the detail page stale — `lib/challenges/actions.ts`:51
- [x] (fixed 2026-09-21 — suffix candidates trim trailing hyphens (decks and cards)) Slug truncation can produce a trailing/double hyphen, failing the decks_slug_format CHECK with a raw Postgres error — `lib/decks/actions.ts`:124
- [x] (fixed 2026-09-21 — Land matched first in typeBucketFor) Artifact/enchantment lands are bucketed as Artifact/Enchantment, so they enter the mana curve and are excluded from the land count — `lib/decks/analytics.ts`:52
- [x] (fixed 2026-09-21 — clampManaValue() to 9999.99) Importing a card with Scryfall cmc ≥ 10000 (Gleemax) overflows deck_cards.mana_value numeric(6,2) and aborts the whole import — `lib/decks/import.ts`:232
- [x] (fixed 2026-09-21 — delete error is checked) setFeaturedCardAction reports success even when clearing the slot fails — `lib/featured/actions.ts`:68
- [x] (fixed 2026-09-21 — dup — 0101, see above) Follow/unfollow toggling spams the target with unlimited 'follow' notifications — `lib/follows/actions.ts`:38
- [x] (fixed 2026-09-21 — every moderation write checks its error; reports are only actioned after the hide succeeds) resolveCardReportsAction marks reports 'actioned' and toasts 'Card hidden' even if the cards update failed; comment 'remove' likewise ignores the delete result — `lib/moderation/actions.ts`:154
- [x] (fixed 2026-09-21 — sweep matches rules_text on both faces too) Custom-pip rebake sweep only matches the symbol in cost/back_face.cost, but renderers also draw custom pips inline in rules text — `lib/pips/actions.ts`:219
- [x] (fixed 2026-09-21 — previous object removed only after upload + scan + row update succeed; a failed row update removes the NEW object) Avatar/banner upload deletes the previous object before the new upload succeeds — `lib/profile/upload-server.ts`:149
- [x] (fixed 2026-09-21 — deck_import added to ACTIONS) Admin Scryfall dashboard omits deck_import from today/minute/per-action counts but includes it in the 30-day totals — `lib/scryfall/admin-usage-queries.ts`:53
- [x] (fixed 2026-09-21 — throttle() is a promise chain — callers really queue) Scryfall throttle lets concurrent callers stampede instead of queueing — `lib/scryfall/client.ts`:41
- [x] (fixed 2026-09-21 — Kindred added to KNOWN_SUPERTYPES) Scryfall import drops the Kindred supertype (Scryfall renamed Tribal → Kindred) — `lib/scryfall/import-mapper.ts`:32
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) Single 'Add' inserts at position 0, so after a drag-reorder the new card lands second instead of last — `lib/sets/actions.ts`:487
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) Public set card counts include private cards that the page cannot show — `lib/sets/queries.ts`:87
- [x] (fixed 2026-09-21 — 0101: like/follow notify once per actor/target/24h; unlike/unfollow retracts the unread row) Like and remix notification triggers have no dedupe — toggling like (or private↔public on a remix) generates unbounded duplicate notifications to the owner — `supabase/migrations/0032_notifications.sql`:55
- [x] (verified fixed — 0094 wraps display_name in left(…, 64)) handle_new_user passes OAuth full_name/name straight into display_name (CHECK ≤ 64) — a long Google name aborts signup — `supabase/migrations/0046_handle_new_user_oauth.sql`:46
- [x] (fixed 2026-09-21 — 0102: on delete set null) feedback.resolved_by is a NO ACTION FK to auth.users — an admin who has resolved feedback can no longer delete their account (regression of the 0031 fix) — `supabase/migrations/0051_feedback_admin_notifications.sql`:29
- [x] (verified fixed — the branch no longer exists) Rebake route's private-card cleanup branch is unreachable — `app/api/admin/rebake/route.ts`:115
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) GET /api/sets/[id]/export (Pro whole-set PDF) is unreachable: no link, no fetch, and the sets flag is off — `app/api/sets/[id]/export/route.ts`:45
- [x] (fixed 2026-09-21 — LikeButton + CardComments fall back to the current path; RemixButton was already fixed) Unreachable `/card/${slug}` fallback branches in LikeButton, RemixButton and CardComments point at a route deleted in May — `components/cards/like-button.tsx`:51
- [x] (verified fixed — forge-ai-panel.tsx was removed) Forge AI panel hard-wires a 'Coming soon' overlay over a fully built, still-mounted 786-line AI assistant with a live API route — `components/creator/panels/forge-ai-panel.tsx`:27
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Vestigial template_id is still defaulted, validated and persisted, costing an extra sequential card_templates query on every create/edit render — `components/creator/panels/identity-panel.tsx`:77
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) AiSetGenerator: SET_GENERATION_UI_ENABLED is hard-wired false, leaving ~100 lines of unreachable UI plus hooks that run for the stub — `components/sets/ai-set-generator.tsx`:32
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) SET_GENERATION_ENABLED is hard-wired false — whole set-generation path is flag-dead and hides a latent size-clamp mismatch — `lib/ai/generation-jobs.ts`:212
- [x] (verified fixed — the exports no longer exist) Dead query exports: getCardBySlugPublic, listPublicCards and getCardWithLineage have no callers — `lib/cards/queries.ts`:288
- [x] (fixed 2026-09-21 — dup — same fix) Homepage and FAQ still sell 'set building' and 'the AI set generator' while both are switched off — `app/(marketing)/page.tsx`:128
- [x] (fixed 2026-09-21 — Tier 4b consolidation) VisibilityPicker + VISIBILITY_OPTIONS copied into set and deck forms (bypassing ChipGroup); set copy's description is stale — `components/sets/set-creator-form.tsx`:70
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Deck and set opengraph-image.tsx are ~110-line clones with brand hex literals hard-coded instead of BRAND tokens (26 literals across the OG page files) — `app/(marketing)/deck/[slug]/opengraph-image.tsx`:87
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Small pure helpers duplicated: firstString ×3, clamp ×3, randomUUID-fallback snippet ×5 — `app/(marketing)/gallery/gallery-view.tsx`:80
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Rate-limit 429 + Retry-After response block copy-pasted 10 times across 7 route handlers — `app/api/ai/jobs/route.ts`:215
- [x] (fixed 2026-09-21 — Tier 4b consolidation) UUID regex declared inline in 17 files alongside two differing validated homes (auth UUID_REGEX vs zod-4 uuidSchema); three different Scryfall-id checks — `app/api/cards/[id]/og/route.ts`:31
- [x] (fixed 2026-09-21 — Tier 4b consolidation) CRON_SECRET bearer check (isAuthorized) and the service-role 503 guard duplicated in both cron routes and admin/rebake — `app/api/cron/refill-credits/route.ts`:27
- [x] (fixed 2026-09-21 — the remaining username ternaries in cards/actions + the creator's share prompt use buildCardPath; the rest were edit/redirect routes, not detail paths) buildCardPath helper bypassed by ~14 inline `ownerUsername ? /card/u/slug : /card/slug` re-implementations — `components/cards/like-button.tsx`:49
- [x] (fixed 2026-09-21 — plans.isLowCredits() (≤20% of the monthly allotment, min 1) + planForTier().name in both panels) Low-credit threshold and tier display name re-derived in two panels instead of coming from lib/billing/plans — `components/dashboard/credits-summary.tsx`:30
- [x] (fixed 2026-09-21 — Tier 4b consolidation) inputClass/textareaClass Tailwind blobs are exported from field-group.tsx but copied verbatim into deck and set creator forms — `components/decks/deck-creator-form.tsx`:376
- [x] (fixed 2026-09-21 — FollowButton bounces with redirectTo and promotes on a session cookie (the drift part; consolidation stays open)) Sign-in bounce logic copied into five buttons with two drifts: FollowButton drops redirectTo, only QuickLikeButton re-checks the session cookie — `components/follows/follow-button.tsx`:24
- [x] (fixed 2026-09-21 — Tier 4b consolidation) formatRelative copy-pasted verbatim in 3 components; formatDate duplicated 3× — `components/notifications/notification-bell.tsx`:202
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Notification row presentation duplicated between the bell and the page; formatRelative copied three times, formatDate twice — `components/notifications/notification-bell.tsx`:29
- [x] (fixed 2026-09-21 — Tier 4b consolidation) RARITY_LABELS ×3, COLOR_LABEL(S) ×2 and COLOR_DOT ×2 re-declared in components while types/card.ts already hosts CARD_TYPE_LABELS — `components/sets/set-analytics-panel.tsx`:17
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Analytics panels duplicate BarList (already drifted), COLOR_DOT/COLOR_LABELS, and RARITY_LABELS (three copies, no home in types/card) — `components/sets/set-analytics-panel.tsx`:128
- [x] (fixed 2026-09-21 — Tier 4b consolidation) UUID regex declared in 20 files (two of them re-created per call inside function bodies) — `lib/auth/schemas.ts`:126
- [x] (fixed 2026-09-21 — cards/decks/sets/challenges share slugify(); articles' GitHub-style slugifyTag stays so heading ids and tag URLs remain stable) Slug generation implemented 4 ways with different normalization (diacritics, caps, fallbacks) — `lib/challenges/actions.ts`:41
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Owner-username lookup for revalidation re-implemented 8× (cached getCurrentProfile already has it); deck revalidation path lists drift — `lib/decks/membership.ts`:60
- [x] (fixed 2026-09-21 — Tier 4b consolidation) narrowCard() copy-pasted byte-for-byte into lib/cards, lib/decks and lib/sets query modules (plus the ILIKE escape) — `lib/decks/queries.ts`:51
- [x] (fixed 2026-09-21 — Tier 4b consolidation) UUID regex literal declared in 17 files (twice re-created per call) alongside zod uuid() elsewhere — `lib/moderation/actions.ts`:105
- [x] (fixed 2026-09-21 — Tier 4b consolidation) lib/og chrome (WUBRG pip strip, brand lockup, gradient ground, domain stamp) re-inlined in home-card.tsx and card-social.tsx instead of using shell.tsx's OgShell/BrandLockup — with size drift — `lib/og/home-card.tsx`:47
- [x] (fixed 2026-09-21 — Tier 4b consolidation) card-pdf.ts: buildDeckPdf re-inlines drawSheet's 3×3 grid + crop-mark corner loop; PDF metadata block and one-card-per-page loop also duplicated — `lib/render/card-pdf.ts`:313
- [x] (fixed 2026-09-21 — Tier 4b consolidation) Like-toggle server action triplicated (self-described 'mirror'); set/deck copies invert the cards' no-purge-on-like policy — `lib/sets/likes.ts`:42
- [x] (fixed 2026-09-21 — pages through the window (20 × 500)) Reconcile sweep scans only the oldest 500 spends per daily run with no pagination; stale 'hourly' comment — `lib/billing/credit-reconcile.ts`:41
- [x] (fixed 2026-09-21 — REPORTS_PER_DAY=20 per reporter; target must be visible to the reporter (RLS)) Report actions have no rate limit and no visibility guard; every report sends an admin email + Slack + per-admin notification rows — `lib/moderation/actions.ts`:30
- [x] (obsolete — .env.local targets the dev branch and `npm run dev` refuses production) Cred-gated e2e specs run against the prod-pointed :3000 dev server when credentials come from the shell instead of .env.e2e — `playwright.config.ts`:49
- [x] (fixed 2026-09-21 — `future` builds only when named on the command line) build-era-frames.mjs default run emits a public/frames/future asset set that no template references — `scripts/build-era-frames.mjs`:119
- [x] (fixed 2026-09-21 — OG route no longer reads ?preset — always the 750×1050 display render) OG route serves the 1500×2100 render to anyone via ?preset=hd, bypassing the viewer-tier gate the PNG route enforces — `app/api/cards/[id]/og/route.ts`:54
- [x] (fixed 2026-09-21 — dup — same fix as the line above) Public OG image route serves the 1500×2100 'hd' render with no entitlement check, bypassing the Plus/Pro hi-res export gate — `app/api/cards/[id]/og/route.ts`:53
- [x] (fixed 2026-09-21 — OG: any ?v other than the card's updated_at 308s to the canonical URL, so a card has 2 cacheable URLs per variant; /png is already private-cached + gated) Unauthenticated Satori render endpoints (/api/cards/[id]/og and /png) have no rate limit and are trivially cache-busted — `app/api/cards/[id]/og/route.ts`:57
- [x] (fixed 2026-09-21 — lib/billing/ledger-reasons.ts labels the reason and never renders the note) Admin grant note is shown verbatim to the end user in their credit ledger — `lib/admin/user-actions.ts`:88
- [ ] Card-capacity gate is check-then-insert with no DB enforcement — `lib/cards/actions.ts`:273
- [x] (fixed 2026-09-21 — directive removed; every caller is a server action or route) lib/cards/bake-render.ts is a 'use server' module whose exports are internal helpers, so they are registered as server actions — `lib/cards/bake-render.ts`:1
- [x] (fixed 2026-09-21 — listPinnedCardsForProfile(ownerId, ids) filters owner_id) Pinned-cards read path does not check ownership, so another creator's card can be pinned to your profile — `lib/cards/queries.ts`:668
- [x] (fixed 2026-09-21 — slug / username shape-checked before revalidatePath) toggleDeckLikeAction revalidates client-supplied paths (deckSlug / ownerUsername are not validated) — `lib/decks/likes.ts`:47
- [x] (fixed 2026-09-21 — escapeSlackText() on details/context) Reporter-controlled `details` is interpolated raw into the Slack mrkdwn alert (link/mention injection) — `lib/moderation/notify.ts`:23
- [x] (fixed 2026-09-21 — bytes are staged under a pending name, the VERSIONED pending URL is scanned, then the canonical object is written) Custom-pip moderation scans the un-versioned public URL of a cacheable, in-place-overwritten object — `lib/pips/actions.ts`:119
- [x] (fixed 2026-09-21 — next.config headers(): frame-ancestors 'none' + X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (no full CSP yet)) No security response headers anywhere (no X-Frame-Options / frame-ancestors, no CSP) — authenticated pages are clickjackable — `next.config.ts`:52
- [x] (fixed 2026-09-21 — 0103 mirrors the INSERT rule) card_set_items UPDATE policy omits the card-ownership check its INSERT policy enforces — a set owner can re-point an item at anyone's card — `supabase/migrations/0009_card_sets.sql`:166
- [x] (fixed 2026-09-21 — 0103 profiles_urls_https CHECK (prod had zero violations)) Zod https/host gating on profile URL columns is not mirrored by DB CHECKs, so direct PostgREST writes bypass it — `supabase/migrations/0022_profile_customization.sql`:53
- [x] (fixed 2026-09-21 — 0103: counts only public/unlisted rows (rate limiting still open; see the next line)) increment_card_view is a SECURITY DEFINER RPC granted to anon — view counts trivially inflatable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [x] (fixed 2026-09-21 — 0103: visibility guard on both; unthrottled by design (anonymous views are views) — partial) increment_card_view / increment_deck_view are anon-callable, unthrottled, and ignore visibility — 'Most viewed' is trivially gameable — `supabase/migrations/0042_card_views_and_ranks.sql`:78
- [x] (fixed 2026-09-21 — 0102: readable when the deck is visible, or own likes) deck_likes SELECT policy is `using (true)` — regresses the card_likes/set_likes hardening (0012, 0024) — `supabase/migrations/0055_decks.sql`:296
- [x] (fixed 2026-09-21 — dup — 0102) deck_likes SELECT policy is `using (true)` — anyone can enumerate who liked private/unlisted decks (never received the 0012/0024 hardening) — `supabase/migrations/0055_decks.sql`:296
- [x] (fixed 2026-09-21 — dup — 0102) deck_likes SELECT is `using (true)` — anonymous callers can enumerate who liked private/unlisted decks (the leak 0012 and 0024 already closed for cards and sets) — `supabase/migrations/0055_decks.sql`:299
- [x] (verified fixed — 0073 dropped owner UPDATE/DELETE; step RPCs are service_role-only) ai_generation_jobs rows are fully client-writable (plan/steps/kind) and the step route trusts them — `supabase/migrations/0059_ai_generation_jobs.sql`:69
- [x] (fixed 2026-09-21 — tests/unit/admin/user-actions.test.ts, chain-stub client) No unit coverage for the admin credit-grant / comp / card-cap actions — `lib/admin/user-actions.ts`:61
- [x] (fixed 2026-09-21 — withCreditedStep extracted to lib/ai/credited-step.ts + tests/unit/ai/credited-step.test.ts) No unit coverage of the credit reserve → refund → spend_ref stamping path in job steps — `lib/ai/generation-jobs.ts`:515
- [x] (fixed 2026-09-21 — planImportWrites extracted to lib/decks/import-plan.ts + tests/unit/decks/import-plan.test.ts incl. the same-row accumulation regression) Import commit merge/accumulate logic has no tests despite a documented prior data-loss bug — `lib/decks/import.ts`:318
- [x] (fixed 2026-09-21 — tests/unit/sets/actions.test.ts: membership authz, icon adopt/re-home + deferred bake, slug suffixing) No automated coverage at all for the sets subsystem (membership authz, icon denormalization, deferred re-bake, slug uniqueness) — `lib/sets/actions.ts`:333
- [x] (fixed 2026-09-21 — tests/unit/billing/stripe-actions.test.ts + entitlement-resolver.test.ts; effectiveTierForProfile exported) No unit tests for checkout/portal actions or the entitlement resolver — `lib/stripe/actions.ts`:22
- [x] (fixed 2026-09-21 — scripts/seed-e2e.mjs re-opens arcane-frontiers for 14 days on every run) Challenge e2e specs depend on a migration-seeded challenge that expires 14 days after the migration runs — `tests/e2e/challenges.spec.ts`:18
- [x] (fixed 2026-09-21 — safeRedirectPath was already covered in tests/unit/auth/usernames.test.ts; added tests/unit/routing/proxy.test.ts + tests/unit/auth/account-deletion.test.ts) No tests cover the auth redirect guard, middleware session gate, or account deletion — `tests/unit/auth/profile-schema.test.ts`:1
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) Owner's 'View public page' / 'View set' links 404 for private sets because the detail page resolves via the anonymous client — `app/(app)/set/[slug]/edit/page.tsx`:91
- [x] (fixed 2026-09-21 — About / Terms / Privacy point at the feedback form) Legal pages send takedown/privacy requests to a contact channel the About page says does not exist yet (circular dead end) — `app/(marketing)/about/page.tsx`:91
- [x] (fixed 2026-09-21 — copy now says first-time subscribers; PricingPlans already switched the CTA on hasSubscribed) Pricing page hero and meta description unconditionally promise a 7-day free trial that checkout refuses to lapsed subscribers — `app/(marketing)/pricing/page.tsx`:51
- [x] (fixed 2026-09-21 — copy says Alt / Option) Frame editor copy says Shift is the coarse-nudge modifier; the handler only checks Alt — `components/admin/frame-guide.tsx`:24
- [x] (fixed 2026-09-21 — reset(defaults) only when the form isn't dirty) Unsaved deck-form edits are silently wiped whenever another panel on the edit page calls router.refresh() — `components/decks/deck-creator-form.tsx`:142
- [x] (fixed 2026-09-21 — invalid ?from= is dropped, other schema issues surface as a form error) FeedbackForm silently does nothing on submit when the ?from= deep-link fails page_url validation — `components/feedback/feedback-form.tsx`:73
- [ ] Pill toggle chips and AI style presets re-implemented instead of using ChipGroup / StylePicker; gallery copy drifted — `components/gallery/gallery-filters.tsx`:422
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) Booster 'Open another pack' re-deals the identical pack — no reshuffle happens — `components/sets/booster-viewer.tsx`:87
- [x] (closed 2026-09-22 — the sets feature was removed from the app; tables kept pending a confirmed drop) Three components hand-roll the modal that ui/dialog.tsx exists to replace; their click-outside handler is dead code — `components/sets/delete-set-dialog.tsx`:70
- [x] (fixed 2026-09-21 — SVG removed from the accept list) Set icon picker accepts SVG files that the uploader and the set-covers bucket both reject — `components/sets/set-creator-form.tsx`:427
- [x] (fixed 2026-09-21 — premise obsolete (Free refills 5/mo); credit-meter zero state now says 'get more' — the upgrade modal explains trial eligibility) Billing/usage panels advertise '5/mo on Free' although Free never refills; credit-meter zero-state promises a trial to subscribers — `components/settings/billing-panel.tsx`:78
- [x] (fixed 2026-09-21 — dup — 0101, see above) Like/follow toggling creates an unbounded stream of notifications — nothing dedupes or removes them on unlike/unfollow — `supabase/migrations/0032_notifications.sql`:46
- [x] (fixed 2026-09-21 — 0103: deck_cards trigger touches the deck; the 0057 guard honours an explicit touch) Deck-entry mutations never touch decks.updated_at, so 'recent' ordering ignores card-list edits — `supabase/migrations/0055_decks.sql`:183
