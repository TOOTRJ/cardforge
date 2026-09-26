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
- [ ] **0.17 [P2] Admin reference-picker lookups don't burn the admin's
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
- [ ] **0.22 [P1] Aftermath bottom half rotates the wrong way** (Card Conjurer audit 2026-09-25) — `AFTERMATH.secondFace.rotation` is 270 (`lib/cards/template-layout.ts`:1066). CSS/Satori apply that as 90° COUNTER-clockwise (`components/cards/card-preview.tsx`:669,1427, `lib/render/card-image.tsx`:329,1667). MSE's `angle: 270` is counter-clockwise, while CC (`packAftermath.js`:39-42, rotation 90) and the printed Cut // Ribbons and Commit // Memory are 90° clockwise. So today the second title reads bottom→top with its cost at the top, and the second art is upside-down relative to the frame (whose bar layout already matches print).
      - Set rotation to 90. Slots rotate about their own centres, so footprints stay put.
      - Re-check the rotated rules box against CC (x 6.94–44.94 / y 57.0–90.57, 0.0507 W) so wide text can't reach the type bar.
      - Parity test: the second title's first glyph sits above its cost.
      - Compare-tool check against Cut // Ribbons with the 0.1/0.2 rotated render before 2.2 walks aftermath. It is unverified, so no user sees it yet.
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
- [ ] **0.24 [P1] Correct the Card Conjurer comparison article** (Card Conjurer audit 2026-09-25) — `content/articles/card-conjurer-alternative.mdx` gets several facts wrong:
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

- [ ] **1.1 [P0] Parse the full frame vocabulary** in `lib/scryfall/client.ts`:
      typed `border_color`, `full_art`, `textless`, `promo_types`, `set_type`,
      `security_stamp`, `color_indicator`, `produced_mana`, `watermark`,
      `finishes`, `flavor_name`, `lang`, `collector_number`; face-level
      `artist`, `colors`, `color_indicator`, `watermark`, `layout` (the strict
      face schema strips them today).
- [ ] **1.2 [P0] Colour from the front face** — `colors`/`color_indicator`
      first; `color_identity`/`produced_mana` only for lands and devoid
      (`lib/scryfall/import-mapper.ts`:271). Fixes DFC fronts importing gold
      and Westvale Abbey importing as a black land.
- [ ] **1.3 [P0] Type-line + layout precedence** — land > creature > rest for
      `card_type`; template from the whole word set (Artifact ⇒ `m15artifact`,
      Token+Artifact ⇒ `m15tokenartifact`, Artifact Land stays a land);
      Saga/Room/Class/Case/Omen from the front-face subtype (transforming
      Sagas, Rooms no longer Split) — `import-mapper.ts`:172-210.
- [ ] **1.4 [P0] Frame signature registry + resolver** in the mapper — every
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
- [ ] **1.5 [P0] Import dialog UX** — per-printing status (✓ Exact · ≈ Nearest
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
- [ ] **1.6 [P1] `frame_requests` table + admin panel** — written on every
      nearest/unsupported outcome (signature label, set, count, last seen);
      "most-requested missing frames" decides the order of 4.7/4.11.
- [ ] **1.7 [P1] Artifact creatures** — offer `m15artifact` under kind Creature
      as a variation with P/T and route "Artifact Creature" imports to it
      (`lib/creator/card-kinds.ts` `framesForKind`,
      `lib/cards/card-display.ts`:32).
- [ ] **1.8 [P1] Back-face art only when the face has `image_uris`** (expose
      `has_back_image` on `/named`), log the quota after URL resolution,
      import the per-face artist — `app/api/scryfall/import-art/route.ts`:134,
      `import-mapper.ts`:346,391.
- [ ] **1.9 [P2] Dialog state** — stale abort must not render "Search failed"
      (check `signal.aborted`); a printing click keeps the list selection and
      scroll; block Cancel/Escape during commit.
- [ ] **1.10 [P2] Flavour `*…*` markers → italic toggles; rarity `special`/
      `bonus` → the purple special symbol; `frame: "future"` labelled and
      reported as unsupported** (`import-mapper.ts`:80,226,339).
- [ ] **1.11 [P2] Mana-symbol vocabulary** — `{G/U/P}`-style Phyrexian
      hybrids, `{C/W}`, `{HW}`, `{½}`, `{∞}`, `{CHAOS}`, `{TK}`, `{A}`, `{PW}`,
      `{P}`, `{L}`, `{D}` in the tokenizer and both renderers
      (`components/cards/mana-cost-glyphs.tsx`:66, `lib/pips`,
      `lib/render/card-image.tsx`:884).
      **Card Conjurer audit 2026-09-25:** Take every new symbol (h/half, paw, 100, 1000000, c/p, loyalty-*, ci-*, chaos, planeswalker) from mana-font 1.18, not CC's img/manaSymbols. CC's set is narrower: half.svg is never loaded and there is no {C/P}. {E}, {TK}, {A}, {CHAOS}, {PW} and the inline loyalty icons render as bare glyphs in text ink, with no disc, in both renderers. Print (KLD Aether Hub) has no disc; today {E} sits on the grey colourless disc (`lib/cards/rules-text.ts`:253-257, mana.css `.ms-cost`). Parity test.
- [ ] **1.12 [P3] Title schema to 150 chars; proxy edge cases** (`?id=&exact=`,
      Scryfall 400 vs ambiguous 404 messages).
- [ ] **1.13 [P2] Refresh `ABILITY_WORDS`** (`lib/cards/rules-text.ts`:33) with
      the 2024–2026 words + a test against Scryfall's `catalog/ability-words`.
- [ ] **1.14 [P2] Kindred stays a supertype word; delete the dead
      `tribal → "spell"` mapping** (`import-mapper.ts`).
- [ ] **1.15 [P2] 'Use art from a real card' in the Art panel** (Card Conjurer audit 2026-09-25) — Today real-card art only arrives with a full Scryfall import that overwrites text, frame and colour (`components/creator/scryfall-import-dialog.tsx`:364-399,841). CC has a separate art-by-name lookup (`creator-23.js`:4138-4185).

      Add a dialog in the Art panel:
      1. Name typeahead.
      2. Printings grid (1.5's list, with thumbnails + artist).
      3. POST `/api/scryfall/import-art` {mode: art | art-back}. The route is already id-only and SSRF-safe.

      It sets only `art_url`, a reset `art_position` and `artist_credit`, never text, frame or colour, and counts against the same Scryfall quota.

      Optional follow-up: a server-side 'Paste an image URL', under the upload allowlist, size limit and moderation. Never a client CORS proxy, which is what CC uses. Depends on 3.14 for orientation.
- [ ] **1.16 [P0] Stopgap: say so when a borderless or showcase printing imports as the plain frame** (borderless research 2026-09-25; ships before 1.4) — The importer drops every treatment, so all 6,327 paper borderless printings land silently on the bordered standard:
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
- [ ] **1.17 [P0] Borderless families in the signature registry (feeds 1.4)** (borderless research 2026-09-25) — 1.1 parses the fields; this item is the borderless half of 1.4's resolver. Every borderless printing is `frame: 2015` (`-frame:2015` returns 0). None is a battle, and none carries `extendedart` (0 each).

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
- [ ] **1.19 [P0] Full-art and textless families in the signature registry (feeds 1.4; runs after 1.17)** (full-art research 2026-09-26) — 1.17 resolves `border_color: borderless`. This item is the same resolver for every other printing Scryfall flags `full_art` or `textless`.

      **Scale.** 1,449 paper full-art printings are not borderless. 1,302 of them would still import as the bordered standard with a false "exact" after 1.16 as written (survey `stopgap.txt`; the 1.16 amendment above closes this). Run through the real mapper (`lib/scryfall/import-mapper.ts`:237-259; `today/resolve-results.txt`, `survey/mapper/mapper-results.txt`), today:
      - BFZ #250, ZNR #266, NEO #293 and ONE #262 → `m15land`;
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

### Phase 2 — Admin walk-through of the stepper (3–5 days)

- [ ] **2.1 [P1] `?previewFrames=all|<list>` for admins** on the create and
      edit pages: union the keys, persistent banner; never on the guest ISR
      page; AI jobs keep their own set (`app/(app)/create/page.tsx`:234,
      `app/(app)/card/[username]/edit/page.tsx`:165).
- [ ] **2.2 [P1] "Walk the stepper" link per template row** in the checklist →
      `/create?previewFrames=all&kind=…&template=…&color=…&seed=reference`,
      prefilled from `buildFrameComparePayload()` (with the second face from
      0.2) so battle/adventure/saga/split/flip/aftermath (later DFC) flow
      through Card → Identity → Text & stats → Publish exactly as for a user.
- [ ] **2.3 [P1] Preview saves** — allowed for admins on unverified combos but
      forced private and flagged `frame_preview` (migration); excluded from
      gallery/sitemap/hubs/trending/feeds; listed under the template in the
      checklist with delete / re-verify.
- [ ] **2.4 [P1] Sign-off flow** — per-template verify button showing the
      auto-score per colour (0.9), the walked preview cards (2.3) and the
      metadata (0.10); publishing = all colours scored + the owner's tick.
- [ ] **2.5 [P3] Optional Playwright-generated snapshot strip** of each step per
      kind in the compare view.

### Phase 3 — Parity on frames people already use (1 week)

- [ ] **3.1 [P1] Snow/untap/Phyrexian pips in the bake match the mana font**
      (`lib/render/card-image.tsx`:884, `lib/cards/rules-text.ts`:253).
- [ ] **3.2 [P1] Rules-paragraph run margins identical in both renderers**;
      cancel the last line's margin (`card-image.tsx`:1092,
      `components/cards/card-preview.tsx`:1625).
- [ ] **3.3 [P1] One loyalty-badge height constant** (1.6 vs 1.5 —
      `card-preview.tsx`:1797, `card-image.tsx`:1186).
- [ ] **3.4 [P2] Shared disc-relative constants** for cost gaps, inline
      hairlines and disc shadows.
- [ ] **3.5 [P2] Shadows/outlines as width fractions** materialised per renderer
      (`OUTLINE_SHADOW`, `ADV_SHADOW`, `SHOWCASE_SHADOW`, brand mark).
- [x] (shipped in #381, layout v25: `brandMarkLayout()` sizes the mark off the card's short side (×5/7 on landscape) and `FrameProfile.brandMark` places it — battle at right 11 %, clear of the defense badge; both renderers) **3.6 [P2] Brand mark on landscape** — size by height, anchor away from
      the defense badge (`card-preview.tsx`:1014, `card-image.tsx`:709).
- [ ] **3.7 [P1] Saga chapters through `RulesBody`** with the fit ladder and
      pips (`card-preview.tsx`:1294, `card-image.tsx`:1536).
      **Card Conjurer audit 2026-09-25:** Start chapter text at the 7.5 pt compact standard; today `SAGA.chapters.sizePct` 0.029 W = 5.2 pt (`lib/cards/template-layout.ts`:828-836) vs CC 0.0427 W. Put the chapter rail on the profile: badge at x 3.86 W, 7.87 W × 6.29 H straddling the left border; numeral 0.045 W; text 13.34–48.34 W; reminder block 8.67/11.29/40.4×17.72; rows 17.86 % H from 28.96, content-sized via 3.13's helper. Both renderers; verify on History of Benalia (DOM). Saga is verified, so this is a platform correction (0.20).
- [ ] **3.8 [P2] Artist footer on the 12 footer-less templates** (flip, split,
      aftermath, battle, lotr, lotrscroll, avatar, bloomburrow, bloomanime and
      the three tarkir frames — counted from the profiles; the plan said 13).
      **Card Conjurer audit 2026-09-25:** Footers also honour `TextSlot.shadowCss` in both renderers. `lib/render/card-image.tsx`:618-660 and `components/cards/card-preview.tsx`:983-1007 ignore it, though FULLARTLAND sets it (`lib/cards/template-layout.ts`:1437-1442). Full-art, borderless and showcase footers get an outline by default before they publish (CC outlines its bottom info).
- [ ] **3.9 [P2] Second faces + adventure page get set symbol, flavour text,
      watermark and rarity** (`card-preview.tsx`:1416, `card-image.tsx`:1648).
- [ ] **3.10 [P2] Bake paints by position not z-index** (document), `Band`
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
- [ ] **3.13 [P0] Planeswalker ability rows sized by content in both renderers** (Card Conjurer audit 2026-09-25) — Both renderers stack equal `flex: 1` loyalty rows (`lib/render/card-image.tsx`:1205-1212, `components/cards/card-preview.tsx`:1778-1786). The browser grows a long row (min-height:auto), Satori/Yoga does not. So a walker with a long ultimate looks right in the editor, while the stored PNG, gallery tile and OG image clip that ability under the loyalty plate. Reproduced by baking a 1/1/5-line m15pw. `fitRulesSizePct` only sees the whole box (`card-image.tsx`:213-231), so nothing shrinks. m15pw is verified for all 7 colours (`supabase/seed.sql`:40-51).

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
- [ ] **3.14a [P1] Strip camera metadata (GPS) from every upload** (3.14 review 2026-09-25) — Uploads are re-encoded only when their orientation tag is 2–8 (`normalizeUploadOrientation`, `lib/media/orientation.ts`). Every other JPEG/WebP (and a PNG's eXIf chunk) is stored byte-for-byte WITH its EXIF at a public storage URL: camera model, capture time and, for phone photos, GPS coordinates. A read-only production scan on 2026-09-25 found 65 card-art JPEGs with EXIF, and 1 of them carries GPS coordinates (aggregate count only; neither the coordinates nor the file were recorded). None of the 30 uploaded avatars, banners and deck covers carries GPS (2 avatar PNGs have an eXIf chunk without it).

      Fix:
      - Drop metadata from every JPEG/WebP/PNG in the five upload actions (art, watermark, cover/set icon, avatar/banner; custom pips already re-encode to a tag-free PNG). Either always re-encode with sharp (about 190 ms for a 12 MP photo, measured, plus one generation of JPEG loss) or strip the APP1/eXIf/EXIF chunks losslessly at the byte level. sharp converts an embedded colour profile to sRGB, which is what resvg draws anyway.
      - Backfill: an owner-run script that rewrites stored uploads that still carry GPS. With a byte-level strip the pixels don't change, so the stored render stays valid and nothing needs a re-bake. Never drop an Orientation tag of 2–8 without turning the pixels too (the two 0118 files): the creator would then show them sideways.

      Acceptance: a unit test uploads a JPEG and a WebP with GPS and orientation 1 and asserts that the stored bytes carry no EXIF; a re-run of the scan finds 0 files with GPS.
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
- [ ] **3.18 [P2] Stat values shrink to fit their plate** (Card Conjurer audit 2026-09-25) — P/T, loyalty and defense render at a fixed `slot.sizePct` (StatBake in `lib/render/card-image.tsx` ~1422, `components/cards/card-preview.tsx` ~1112), while each side allows 16 characters (`lib/validation/card.ts`:121-126). `100/100` overflows the M15 plate; '15/15', '*/1+*' and 'X/X+1' fit.

      Run stat values through `fitSingleLineSizePct` against the plate width (4.18's plateRect once it exists), capped at the profile size, in both renderers. CC's P/T is oneLine with shrink (`packM15RegularNew.js`:58).

      Acceptance: tests with `100/100` and `*/1+*`.
- [ ] **3.19 [P2] Card-relative flavour bar** (Card Conjurer audit 2026-09-25) — Both renderers draw the flavour divider as `borderTop: 1px` (`lib/render/card-image.tsx`:1151, `components/cards/card-preview.tsx`:1730). That is about 0.2% of card height in the preview but about 0.05% in the 1500×2100 bake, so it is too thin in the stored PNG and differs between the two. CC draws `bar.png` at 96% of the text width (`creator-23.js`:3552-3567).

      Replace it with a bar about 0.2% of card height and about 96% of the text width, with faded ends (an SVG linear gradient in both renderers). Measure against three M15 scans (Serra Angel DOM). Bundle with 3.12.
- [ ] **3.20 [P2] Metric-based text fitting** (Card Conjurer audit 2026-09-25) — Fitting uses fixed average advances: `CHAR_W` 0.5 em (MPlantin measures ≈0.43) and `DISPLAY_CHAR_W` 0.56 em (Beleren 0.41–0.61), with a 0.96 safety factor (`lib/cards/render-tiers.ts`:30-35,106). So rules text steps down half a point early, and all-caps titles run about 8% wider than estimated.

      Fix:
      - Generate `lib/cards/font-metrics.json` (advance widths + kerning for MPlantin, MPlantin Italic and Beleren) from the committed TTFs with a script. Regenerate it after 4.8's Beleren2016.
      - Replace the constants with a deterministic word-wrap simulation in `fitRulesSizePct`/`fitSingleLineSizePct`, shared by preview and bake and reused by 3.10 (titles), 3.18 (stats) and 3.13 (rows).

      Acceptance: unit tests against line counts measured on a few Scryfall scans. CC measures real glyphs (`creator-23.js`:3825-3833,3897-3903).
- [ ] **3.21 [P3] Larger hybrid cost pips** (Card Conjurer audit 2026-09-25) — Printed hybrid and two-brid cost pips are about 1.2× a mono pip (UMA Murderous Redcap), and CC loads them at 1.2 (`creator-23.js`:326-328). We draw every cost pip at one size (`lib/render/card-image.tsx`:822-872, `components/cards/mana-cost-glyphs.tsx`:259).

      Scale split discs ×1.2 in the cost band only, keeping the row's vertical centre. Check Phyrexian against a scan first. Parity test.
- [ ] **3.22 [P2] m15land/m15snowland title band ends too early** (Card Conjurer audit 2026-09-25) — After 0.12 folded the name's left edge to 8.4% W, `widthPct` stayed at 77.5. The title band now ends at 85.9% W (m15snowland: 86.6%), so long land names shrink early on two verified templates. The comment still says '14 + 77.5 = 91.5' (`lib/cards/template-layout.ts`:343-376). CC's box ends at 91.28 (`packM15RegularNew.js`:55), and land frames have no cost.

      Set `widthPct` to 83.8 / 83.1 and fix the comment. Ship as a platform correction (0.20). (Still open at `267f46c`: M15LAND, now ~line 488, still has `widthPct` 77.5 and the old comment; the v24 swap didn't touch it.)
- [ ] **3.23 [P1] Edge-to-edge frames in both renderers (before 4.32)** (borderless research 2026-09-25) — Only `fullartland` puts art on the card edge today (`lib/cards/template-layout.ts`:1776). Nothing verified does, so these gaps are invisible. CC's borderless masters bake the translucent bars and box into the PNG (α128 box, `m15/borderless/*.png`), so 4.32 needs no new box capability. It does need:
      - **One corner radius.** Display rounds with CSS `.card-corners` at 3.5 % / 2.5 % = 52.5 px at HD (`app/globals.css`:335-340, used by `components/cards/baked-card-thumbnail.tsx`:82,99). The CC masters are cut at 39 px (`lib/cards/frame-sources.json`:7), and 6.18 proposes about 43.5 px. On a black border the difference is hidden; on borderless the art sits in the corner and shows it. Measure the printed radius on FDN #311 and use one constant for CSS, OG, 6.18's rounded download and the CC importer's corner cut.
      - **Brand mark on art.** `BRAND_MARK_PLACEMENT` (`template-layout.ts`:318, bottom 1.8 %) sits inside M15's black border. On 4.32 it still lands in the CC bottom bar (92.24–100 % H), which is fine. On treatments without a bar (4.36, 4.37 tokens, `fullartland`, `bloomanime`) it lands on the art: 82 % white plus a 1 px shadow (`lib/render/card-image.tsx`:850-878). Set these profiles' placement through `FrameProfile.brandMark` (per-profile since #381, 3.6) and add an optional dark pill, identical in preview and bake. The watermark policy still requires the mark on every display surface.
      - **Art framing survives a treatment switch.** focal/scale are relative to the slot, so moving between a 1.37 window and the 0.77 full-bleed slot re-crops the art. Carry the visible centre across the switch in the shared maths (with 3b.13).
      - **New overlays in `frameAssetPathsFor`** (`lib/render/card-image.tsx`:2083): borderless P/T plates, floating crowns and the holo stamp. Otherwise they bake as a transparent pixel on Vercel.
      - **Finishes.** Foil masks by art luminance and works. Etched masks by the frame PNG's luminance (`lib/cards/etched-finish.tsx`:11-20), so it nearly vanishes on a mostly transparent frame. Hide Etched on borderless treatments until 4.28.
      - **Footer outline on art** for bar-less treatments (3.8's `shadowCss` fix).

      Acceptance: parity cases in 3.11 for a full-bleed profile (a corner pixel, brand-mark position, art centre after a template switch).
      **Full-art research 2026-09-26:** the overlay bullet also covers the basic-land symbol discs 3.24 draws (CC `textless/2022/s?.png`, ZEN `s?.svg`). They must be in `frameAssetPathsFor`. `fullartland` has art below its bottom bar (84.5–90.3 % H), so its footer and brand mark land on the art; it is already on the bar-less list.
- [ ] **3.24 [P1] Full-art renderer pieces: basic-land symbol slot, split type line, textless flag (before 4.39)** (full-art research 2026-09-26) — 3.23 makes edge-to-edge art work. Full-art frames need three more capabilities, in both renderers, with parity:
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

### Phase 3b — Creator wizard bugs (1 week, parallel with Phases 1–3)

- [ ] **3b.1 [P1] Wrap the save actions in try/catch** — a failed request must
      not unmount the editor (`components/creator/card-creator-form.tsx`:1726).
- [ ] **3b.2 [P1] Ideas dialog routes `card_type` through
      `applyKindProgrammatic`** (`card-creator-form.tsx`:981,
      `lib/ai/card-ideas-select.ts`:122).
- [ ] **3b.3 [P1] Clear `loyalty_abilities`/`saga_chapters` after folding** into
      `rules_text`; fold before the early return
      (`card-creator-form.tsx`:783,809,887,1606).
- [ ] **3b.4 [P1] Dual lands** — the basic-land fallback applies only to exactly
      one basic subtype (`lib/cards/watermark.ts`:201,
      `lib/creator/card-kinds.ts`:447).
- [ ] **3b.5 [P1] Inline-frame second-face name** — add to `saveMissing`, open
      the collapsed details on error, clear the leave-guard pending state only
      after a successful save (`card-creator-form.tsx`:584,949,2360,
      `lib/creator/form-schema.ts`:132, `panels/layout-panel.tsx`:109).
      **[decide]** allow a draft without it.
- [ ] **3b.6 [P2] Edit save resets only when `!isDirty`** so keystrokes during
      the refresh survive (`card-creator-form.tsx`:538,1885).
- [ ] **3b.7 [P2] Remove the history sentinel after a save**
      (`components/creator/unsaved-changes-guard.tsx`:88).
- [ ] **3b.8 [P2] Split/aftermath second half defaults its type from the
      kind**, not "creature" (`lib/creator/form-types.ts`:128).
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
      Still open: the rest of the "Soon" copy, e.g. the Foil/Etched finish
      chips (6.5), and the import dialog's "matched to this printing's border
      era" line (`scryfall-import-dialog.tsx`:843, rewritten by 1.5).)
- [ ] **3b.13 [P1] Art positioner matches the card's art window** (Card Conjurer audit 2026-09-25) — The pan surface is a fixed `aspect-[5/4]` (`components/creator/art-uploader.tsx`:42), and drags divide by that box's overflow (:282-336), while the card crops to `layout.artSlot`. On M15 (1.37) this is mild. On saga (0.41) and full-art (0.71), a horizontal drag sweeps the whole focal range in about 38 px. On aftermath/split (2.7) vertical drag does nothing; only the arrow keys work.

      Fix:
      - Size the surface from `resolveFrameProfile(template).artSlot` (the second face uses `secondFace.artSlot`, landscape-aware). Better: add drag-to-pan and Shift-wheel zoom on the live preview's art slot, with the window outlined while dragging, as CC does (`creator-23.js`:4200-4256).
      - Use one scale range everywhere. Today the uploader uses 0.5–3 (:39-40), the renderers 0.5–4 (`components/cards/card-preview.tsx`:573, `lib/render/card-image.tsx`:210) and zod 0.1–4 (`lib/validation/card.ts`:205).
      - Make the size hint template-aware (:635-639), showing slot px at the HD and 800 ppi exports, with a warning under 300 ppi.

      Acceptance: unit tests of the pan maths for the saga, aftermath and full-art slots.
- [ ] **3b.14 [P3] Layout kinds keep a card-type choice** (Card Conjurer audit 2026-09-25) — The adventure kind hard-codes creature (`lib/creator/card-kinds.ts`:156-161,539-560), so the 23 non-creature adventures (e.g. WOE Virtue enchantments) can't be typed correctly and always show the P/T editor. In CC the P/T plate is an optional layer (`packAdventure.js`:13-21).

      Adventure (and Prepare from 4.27, and flip) offer creature / enchantment / artifact / instant-sorcery on the Identity step. Stats and the P/T plate follow `card_type` (`lib/cards/card-display.ts`:142-156). Import keeps the front face's type for layout `adventure`.

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
      - **Nyx (fix):** a new `m15nyx` skin of m15 from CC `m15/new/nyx` (normal cream text box, dark ink; c → a.png). Auto for Enchantment Creature/Artifact and for `frame_effects: enchantment` on non-showcase printings. Add a saga Nyx and a Nyx inner crown. KEEP the `nyx` template as the THB 'Constellation' showcase, which matches its references.
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
- [ ] (partly 2026-09-25: of the 12 contradicted profiles, tarkirdragon was re-measured on MUL #1/#60 with its own P/T plate (#381) and tarkirghostfire rebuilt with translucent boxes + P/T ribbon (#382); tarkirdraconic's white-on-parchment P/T is still unreadable (4.31). The other 9 profiles, per-set basics and new families are open) **4.11 [P1] Showcase families from MSE (744–750 px)**, in request-log
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
- [ ] (partly 2026-09-25: #380 draws CC's own shield cut from each master (`plateRect` 79.6/87.667/16×7.333, above the stripes, so no double rim) with the loyalty value in CC's box 80.6/90.2/14×3.72 at 0.052 W, white; #382 lowered the name (top 4.18) and pips (`costDy` 0.004) into CC's taller title bar and gave each stripe its own foil sheen. Still open: the badge rail (x 2.8, w 14.14, per-shape heights), ability text from 18.0 / 13.6 W, row starts + heights (3.13, in progress), neutral stripes with soft seams, title/type sizes (4.20), symbol, two-line footer, and the Gideon BFZ / Karn DOM parity check) **4.19 [P1] Planeswalker anatomy on the profile (with 4.4)** (Card Conjurer audit 2026-09-25) — On m15pw (verified), the cost badges sit inside the rules rect at ≈10.3–20.5 W (`badgeW = 2.3×size`; `lib/render/card-image.tsx` ~1169, `components/cards/card-preview.tsx` ~1796), and every ability's text starts at ≈22.7 W. Print (Gideon BFZ) and CC straddle the frame edge (`versionPlaneswalker.js`:168-188, `packPlaneswalkerRegular.js`:37-41). `loyaltyRows` holds colours only (`lib/cards/template-layout.ts`:455-469).

      Put the rail on the profile, with CC's values:
      - Badges: x 2.8, width 14.14 W; heights + 7.24 / − 7.05 / 0 6.1 % H; numeral 0.04 W centred at 10.27.
      - Ability text from 18.0 W (static abilities 13.6) to 92.67; rows from 62.39 H in 9.72 % steps (or CC's per-count centres), heights from 3.13.
      - Stripes: neutral white α0.61 / #a4a4a4 α0.71 with soft 0.48 % H seams across 11.67–92.61 (today cream α0.78 with hard edges).
      - Title/type 0.0533/0.0454 W in 8.67/3.72 and 8.67/56.25 (82.67×5.48); symbol right edge 92.27, centred 58.91; two-line footer (artist line ≈96.3 H).
      - Loyalty value 80.6/90.2/14×3.72 at 0.052 W, white.

      When the frame paints its own shield (CC planeswalker), drop `plateAssetPathTemplate` (:478-487), or two rims stack.

      Acceptance: both renderers plus a parity test; verify on Gideon BFZ and Karn DOM.
- [ ] **4.20 [P1] One M15-era title/type size across layout templates** (Card Conjurer audit 2026-09-25) — CC uses 0.0381/0.0324 of card height (= 0.0533/0.0454 W) on every M15-era frame. Our MSE-derived profiles print names 5–25% and type lines about 20% smaller than our own scan-measured m15 (0.05/0.0435 W):
      - m15pw/saga/flip: 0.0427/0.0347 (`lib/cards/template-layout.ts`:442,450,807,815,912,919,943,950).
      - aftermath: 0.04/0.0347; second face 0.038/0.028 (:1044-1057).
      - split: 0.0287/0.02; battle: 0.034/0.025, both landscape (:984-996,763-777).
      - adventure panel: 0.032/0.0255 (CC 0.0414 W).
      - token type: 0.034.

      Add shared `TITLE_SIZE`/`TYPE_SIZE` constants, with landscape profiles scaled to the same absolute size and the fit ladder shrinking long lines. Re-check after 4.8's Beleren2016. Bundle the bump with 4.4. (Not in v24: every size above is unchanged at `267f46c`, and m15 itself is still 0.05/0.0435. Ship as its own sweep.)
- [ ] **4.21 [P1] Re-source the M15 layout templates (saga, battle, adventure, split, flip, aftermath) from CC** (Card Conjurer audit 2026-09-25) — All six are 241–375 px MSE sources (`scripts/build-split-frame.mjs`:28, `scripts/build-flip-frame.mjs`:18, `scripts/build-aftermath-frame.mjs`:20, `scripts/import-mse-profiles.mjs`:37-42). CC has all six at 1500×2100 (battle 2814×2010) with text bounds. The owner's 'CC for the whole M15 era' covers them, but 4.4 doesn't list them.

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
- [ ] **4.22 [P1] Token text-length family (tokens with abilities)** (Card Conjurer audit 2026-09-25) — Our m15token/m15tokenartifact is CC's 'Textless (Bordered M15)', which CC files under 'Older Tokens' (`groupToken-2.js`:2-15). Token abilities are printed on a 50% black scrim over the art (`lib/cards/template-layout.ts`:518-528). No printed token looks like that, and 490 of 821 `t:token` cards have rules text (Treasure, Food, Clue, most UB tokens).

      Add CC's current full-art token family as `m15token` variants: token/textless, short, regular and tall, each with w/u/b/r/g/m/a/l + frameC + snow.
      - Pick the variant from rules length: none → textless, 1–2 lines → short, 3–4 → regular, more → tall. Manual override under Variations.
      - Seeds: art 4/2.86/92×89.53; type y 81.96 / 67.8 / 65.0 / 56.64; rules 71.43–91.91 (regular) and 63.03–91.78 (tall); P/T 79.28/90.2.

      Also add a bordered text-box variant from token/m15/regular, so today's arch look has an abilities version: art 12.48–63.91, type 65.0, rules 8.6/71.43/82.8×20.48, symbol centre 67.43.

      Delete the scrim. Import picks the variant from the Oracle line count. References: Treasure (txln) and Treasure (tmsh). **[decide]** which family is the default token look.
      **Full-art research 2026-09-26:** the 171 M15 full-art tokens (T2XM #4, TM20 #2) already resolve `exact` on `m15token` (CC 'Textless (Bordered M15)'), so there is nothing to build for them. The 80 2003-era full-art tokens are 4.43.
- [ ] (partly 2026-09-25: the mechanism shipped in #382 (layout v27) as `inkByColorKey` on TextSlot/StatSlot (`slotInk()` / `footerInk()`, both renderers; per-colour ink + shadow, emboss in em), used for Alpha: agclassic's P/T and "Illus." line are dark on white and embossed silver on every other colour, alphaland silver on all seven, both sharing one line in the strip (#381). Still open: 1997 retro/retroland white P/T + artist with a black drop shadow and the centred `Illus.` footer, the 2003 footer ink per colour (white on black, land and colourless), and title/type ink, since `inkByColorKey` is honoured only on the footer and stat slots) **4.23 [P1] Era text treatment (1993/1997/2003)** (Card Conjurer audit 2026-09-25) — The 1993 and 1997 profiles print title, type, P/T and artist in dark ink (`lib/cards/template-layout.ts`:382-420 AGCLASSIC, 622-672 RETRO), and their comments claim printed P/T is dark, which is wrong. Real 1997 cards (LGN White Knight, SCG Enrage, TOR Shambling Swarm) print them white with a black drop shadow, even on white cards. Alpha prints them light grey with a shadow. The 1997 footer is a centred `Illus. <artist>` over the © line. The 2003 footer is white on black, land and colourless frames (CC `pack8th.js`:55-68), but ours is dark for every colour (:691-738).

      Fix:
      - Give `TextSlot`/`StatSlot` a `colorHexByKey` (per frame colour; `template-layout.ts`:60-110 has one colorHex) and a per-era shadow.
      - Apply these with 4.8's era fonts.
      - Check against the registry scans for agclassic, retro and modern.

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
- [ ] **4.28 [P3] Foil-etched frame treatment** (Card Conjurer audit 2026-09-25) — Scryfall `frame:etched` returns 849 printings (CMR, MH2, commander decks and later). CC has Etched (29 frames incl. vehicle + holo stamp), Etched Nyx, Etched Snow and etched legend/inner crowns (`groupShowcase-5.js`:56-61, `packEtched.js`), with its own colour rule: two-colour lands use colour frames, 3+ colour artifacts use A (`creator-23.js`:606-608,671-677,705-714,1373). MSE has `magic-m15-showcase-etched-foil`. PipGlyph's 'etched' is only a disabled finish shader (`types/card.ts`:248-258).

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
      open tail; every open one below is still open in code):
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
      - **Draconic P/T.** The gold TDM dragon frame people expect is
        `tarkirdraconic`. Its P/T is white on light parchment, so it can't be
        read, and it needs the same plate treatment Dragon Wing got.
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
      - **Alpha long P/T (pre-existing):** a P/T like `*+1/*+1` runs out of
        the strip across the pinstripe into the black border — the P/T rect
        spans 1207–1432 px and neither StatBake nor StatOverlay fits the
        digits (`10/10` fits). Fix: shrink-to-fit in both renderers and end
        AGCLASSIC.pt.rect inside the pinstripe (~1404 px).
      - **Alpha bevel lighting:** MSE lights every colour's text-box bevel
        the same way (lit top + right); the print does that on white and
        artifact cards but lights blue and red ones from the left + bottom.
        Matching it means re-sourcing per colour — owner's call.
      - [x] **Alpha light lettering** on non-white frames: per-colour ink on
        StatSlot + footer in both renderers, with a lower-right emboss.
      - **Aftermath's rotated second art (pre-existing, bake only):** the
        sideways window leaves an art-free strip in the Satori bake — the
        parent's rotate(270deg) combines badly with the child <img>'s scale()
        and percentage transformOrigin — and the foil sheen now paints over
        that strip. Fix: apply the scale in a non-rotated inner wrapper, or
        compute the cover + scale box in px as coverPlacement does. Found by
        the integration review 2026-09-25; 0 production aftermath cards.
      - [x] **Foil on planeswalkers** (owner decision, round-2 review): each
        ability stripe carries its own sheen (`FoilStripeSheen`, masked by the
        stripe colour) between the stripe and the badge + text, in both
        renderers — inside v28 (foil only; one production card, Coden). Still
        open: a translucent rules BACKDROP (`rules.backdropHex` — m15pw's
        non-planeswalker box, token / full-art scrims) hides the foil the
        same way.
      - [x] **Planeswalker pips + name lowered** (owner note, round-3 review:
        "pips look a little high"): CC's pw title plate runs ~9 px lower at HD
        than the printed one (77–192 vs 73–183 on M15 walkers), and the
        MSE-tuned cost box and title rect left pips and name 42–43 % of the
        way down it; printed pips sit at 47–49 %, names at 49–51 %, the pips
        ~2 px above the name. `costDy: 0.004` (6 px) and title top 3.8 → 4.18
        (8 px) on M15PW, inside v27 (m15pw added to its template list; 6
        public production cards). Still open: a long name runs under the
        detached cost (Miner the Miner — the name's ellipsis ignores
        `costRect`), and the printed name's caps are ~20–25 % taller than
        ours (≈56 vs ≈45–47 px at HD).
      - **Planeswalker row parity (pre-existing, preview only):** browser
        ability rows are content-sized (flex `min-height: auto`), Yoga's stay
        equal, so a walker with long or two-line abilities gets different
        stripe heights in the preview than in the bake (measured up to ~60 HD
        px); the preview's badge box is also 1.6× the text size tall against
        the bake's 1.5×. Aligning the preview to the bake (`minHeight: 0` on
        its rows, a 1.5× badge) moves no bake; the foil stripe sheen already
        follows either row height. In the bake, Satori rounds each row's top
        and height separately, so with 4 rows a seam can gain a 1 px gap or
        overlap and the last row can overhang the box by 1 px (clipped).
      - **Alpha colourless** uses a flat grey master; printed Alpha colourless
        cards are artifacts on a dark warm-brown border with a light crackle
        text box (Sol Ring, Juggernaut) — an asset re-source.
      - **Display-font word spacing:** "Jester's Mask" renders a 42 px word gap
        (17–25 px elsewhere) on every template — CardDisplay font metrics.
- [ ] **4.32 [P1] Standard borderless frame for regular cards (`m15borderless`) from CC 'Borderless (Alt)'** (borderless research 2026-09-25) — This is the 2019+ look: art to the edges, dark translucent bars and text box with white ink, and a black bottom bar holding the collector line. It covers 3,425 printings (2,177 without a crown), about 54 % of all borderless paper printings. Nothing ships today: the "borderless showcases" are MSE scrims with an inset art slot (4.35), and 4.7 named the wrong CC pack (its Borderless bullet now points here).
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

      Acceptance: 7.7 passes; a parity case in 3.11; the 1.17 fixtures resolve `exact` for FDN #311 and M21 #315.
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
      - **bloomanime.** `borderlessShowcase()` insets the art 2.5/3.5/93×92 (`lib/cards/template-layout.ts`:1571-1616). MSE's source runs the image 0/0/100×91.6, or 94.8 with a P/T (`magic-m15-showcase-bloomburrow-borderless-anime.mse-style/style`:401-407). Match MSE. The registry references Hop to It BLB #381 and Fell BLB #383, which are black-border promo-pack printings, not the anime run. Replace them with BLB #316–336 and #343–355. 0 production cards.
      - **tarkirghostfire.** The comment calls it "borderless" (`template-layout.ts`:1618). Scryfall: #399–408 are black-bordered, #409–418 white. The registry references #410, which is white. Paint a real black ring for the black run, register #399–408 references (e.g. Clarion Conqueror TDM #400), and leave the white run to 4.30. 1 production card, so ship it as a 0.20 platform correction.
      - **tarkirdragon.** The ring bakes #101015 (16,16,21), but the MUL references are black-bordered. Make it opaque black. 4 production cards; 0.20 sweep.
      - **fullartland.** The only true edge-to-edge master, but its references are HOB/BFZ black-bordered full-art basics. **Decided 2026-09-26 (owner: "go with your recommendation")**: keep it borderless (the alternative was adding a black border to match the current references). References revised the same day after the full-art research: FRA #382–396, not UNF #235 / EOE #262 (see the end of this item). 0 production cards.
      - **m15textless / m15textlessland.** Black-ring masters, but their references are borderless (MSH/TRK/TLA/FRA; EOE basics). **Decided 2026-09-26 (owner: "go with your recommendation")**: re-source them borderless from CC `TextlessGenericShowcase` (4.37), matching their references (the alternative was re-referencing them to black-bordered textless printings).
      - **lotrscroll and battle** are the same ring problem, already in 7.6/4.21. Cross-reference; don't duplicate.

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
- [ ] **4.38 [P3] Borderless layout cards (saga, adventure, room/class/case, mutate)** (borderless research 2026-09-25) — Paper counts: 71 sagas, 36 adventures, 11 class/case/room, 19 mutate. Examples: TDM #383 Awaken the Honored Dead, WOE #298 Kellan, DSK #334. Neither CC nor MSE has a borderless frame for these, and MSE's module masks `borders/744x1039/m15/{saga,walker}/borderless.png` are unused shape references only. Derive each from the CC layout frames (4.21) plus a 1500 px borderless border mask, with owner visual sign-off. Log each as `unsupported` (1.6) until it ships, and order by the log. Borderless battles: never; 0 have been printed.
- [ ] **4.39 [P1] Full-art basic lands from CC 'Fullart Basics (2022)': a new black-bordered `m15fullartland`, and `fullartland` (borderless) re-sourced** (full-art research 2026-09-26) — Basic lands are the biggest full-art family and the likeliest full-art import:
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
        - `c` (Wastes) from CC `l` + `sc`, with owner visual sign-off: no left-medallion Wastes was ever printed.
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

      Acceptance: 7.7 passes (`m15fullartland` has a border on all four edges; `fullartland` has art on all four edges plus its two bars). 3.24's parity cases pass. 1.19's fixtures ONE #262 and HOB #194 resolve `exact` on `m15fullartland`.
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
      - **Player Rewards textless:** P05–P11 (48) plus PLST reprints (9) and 1 more. 2003 frame, textured colour ring, arched art to the bottom, no type line. Derive from CC 8th (4.10's 1500 px source) through its type/rules masks, using MSE `magic-new-textless` (375 px) for geometry, plus 3.24's `textless` flag.
      - **2003-era full-art tokens:** 74, plus 6 silver-bordered UGL tokens, 1998–2014. Name plaque, arched art over the text area, type bar and P/T. MSE (375 px) only.
      - **ZEN (20) and J14 (5) full-art basics:** 4.40's medallion bar on 4.10's 2003 border.
      - **Future Sight textless:** FUT 5, MB2 3 plus 1. MSE `magic-future-textless` (375 px) only. Park it with 4.15's Future Sight.

      References: P07 #1 Wrath of God · P10 #1 Lightning Bolt; TLRW #3 Kithkin Soldier · TZEN #3 Kor Soldier; ZEN #230 · J14 #1★ Plains; FUT #19 Blade of the Sixth Pride · MB2 #194 Kobolds of Kher Keep.
- [ ] **4.44 [P3] 'Clear text box' full art: a PipGlyph look, not a printing** (full-art research 2026-09-26) — Card Conjurer's own 'Full Art' frames are the look its users know as "full art":
      - `packFullArtNew.js`: `m15/new/fullart/*`, 2010×2814, black ring; art 6.2/11.29/87.6×80.96 under a translucent type bar and box (α ≈ 0.60);
      - `m15/clearTextbox/*` and `ub/full/*`, both at 1500.

      No printed family matches them. The bordered, non-textless, non-land full-art printings are SLZ, SLD one-offs and the Japan showcase. So this frame would have no reference printing: it would be signed off visually, labelled "Clear Text Box", and never be an import `exact`. `new/fullart/c.png` is a dead CC reference, so `c` needs a substitute.

      **Decided 2026-09-26 (owner approved the full-art recommendations)**: send those users to Borderless (4.32) and text-on-art (4.36) now; revisit building it (as the one black-bordered "any card, full art, with rules" frame, after 4.39) when the 1.6 log or feedback asks.

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
- [ ] **6.5 [P2] Foil/etched finishes: ship or remove** **[decide]**; if
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
      own sheen too; open: translucent rules backdrops (4.31).
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

      Acceptance: a parity test with a Russian and a Japanese card.
- [ ] **6.16a [P1] A bake never fetches third-party assets at render time** (Card Conjurer audit 2026-09-25) — `lib/render/card-image.tsx` uses next/og `ImageResponse` with 5 registered fonts and no `emoji` / `loadAdditionalAsset`, so by next/og defaults an emoji pulls Twemoji from jsDelivr and an uncovered script pulls Google Fonts on every bake (the 2026-09-22 font-fetch outage lesson). Add a local-only asset resolver, strip or bundle emoji, and have validation warn on characters the bake can't render. Extends 6.16.
- [ ] **6.17 [P3] Hide reminder text toggle** (Card Conjurer audit 2026-09-25) — A per-card toggle, stored on frame_style, that drops `reminder` spans in the shared tokenizer and the fit estimate, in both renderers. The spans are already tokenized (`lib/cards/rules-text.ts`:205-214). Users delete reminder text by hand today to make text fit, especially after an import. CC has the option (`creator-23.js`:3390-3401).
- [ ] **6.18 [P3] Download corners and format** (Card Conjurer audit 2026-09-25) — Downloads are always square. The M15 masters' transparent corners are filled with the bake background #101015 (`lib/render/card-image.tsx`:285), and other masters are opaque. CC defaults to transparent rounded corners with a square option, and also offers JPEG (`creator/index.html`:186-189, `creator-23.js`:4641-4676).

      - Add a 'Rounded (transparent) / Square (print)' choice on the PNG download (`components/cards/download-modal.tsx`). Rounded applies a proportional sharp corner mask (≈2.9 % of width) to the live or stored PNG.
      - Square fills the corners with the frame's border colour, not #101015.
      - Print, PDF and bleed outputs always stay square. JPEG is optional.
      - The modal says which option to use for printing and which for sharing.
- [ ] **6.19 [P3] Art adjustments (grayscale)** (Card Conjurer audit 2026-09-25) — Add an optional `art_position.grayscale`, applied identically in the uploader, the preview (CSS filter) and the bake (a sharp pre-filter in `withRenderableImages`, so Satori sees the finished pixels). Add 90° rotate steps only if users ask; the legacy `rotation` key is accepted by zod but never drawn (`lib/validation/card.ts`:206-208). CC has art rotation and grayscale (`creator/index.html`:323-338). Parity test.
- [ ] **6.20 [P3] Deck card with QR in the Pro deck export** (Card Conjurer audit 2026-09-25) — In the Pro deck export (ZIP + sheets), add a card-sized 'deck card' built from the deck cover, title, colour-identity pips, format/bracket and a server-rendered QR SVG pointing to `/deck/<user>/<slug>`. Place it on the first print sheet. CC's Deck Cover + QR template (`packCustomDeckCover.js`, `versionQRCode.js`) is the model. It is a cheap traffic loop from printed decks.
- [ ] **6.21 [P3] Custom colour tint **[decide]**** (Card Conjurer audit 2026-09-25) — CC's per-layer HSL / colour overlay is a frequent ask (a 'sixth colour'). Offer an HSL tint on the colour layers only, labelled custom/unverified, never on a verified combo's defaults.

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
- [ ] **7.7 [P1] Edge-contract test (borderless-safe 7.6)** (borderless research 2026-09-25) — 7.6 asserts the frame is opaque outside the art window; an edge-to-edge treatment needs the opposite check. The manifest (4.1; a table in the test until then) declares each edge as `border`, `art` or `bar`, the same vocabulary as 6.1a's bleed recipe. For every template × colour master:
      - `border` → frame α ≥ 0.99 in the outer 2 % band;
      - `art` → the artSlot touches that edge (0 or 100 %) and the frame is α ≤ 0.05 there outside declared bars;
      - `bar` → an opaque band at least the declared height.

      This catches the #101015 ring. It fails today on bloomanime, tarkirghostfire, tarkirdragon, lotrscroll and battle, and passes on fullartland. Run it in the 4.3 importer after the 2010→1500 downscale, and in CI.
      **Full-art research 2026-09-26:** add `expeditionland` (b, g) to the fail list. New fixtures: `m15fullartland` (border), `fullartland` (art + bars), `m15textlesspromo` (border).

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
3.13, 3.18 and 0.22. 3.14 is fixed (its follow-up 3.14a is open). Next in this
order: 1.1–1.6 with 3b.1–3b.5
alongside Phase 2. 6.1b is not unblocked by 4.4: it also needs native-size
masters (see its note).

Borderless (research 2026-09-25): 0.25 + 1.16 now; 3.23 → 4.32 (+7.7) can
start now that 4.4 has shipped (#380) — a new template, so no sweep and no
badge; 1.17/1.18 with 1.4/1.5; then 4.33 → 4.34; 4.35 any time before 1.17
goes live; 4.36–4.38 and 5.7 by the 1.6 log.

Full art (research 2026-09-26): 0.26 now, and the full-art half of 1.16 in the
same PR as 1.16. Then 3.24 → 4.39 (bordered + borderless full-art basics)
after 3.23. 1.19 goes with 1.4/1.17. Then 4.40 → 4.41 → 4.42. 4.43, 4.44 and
the per-set basics (4.11) follow by the 1.6 log. Every template here is new or
unused, so none needs a badge. 3.24's scoped sweep re-bakes only private cards
on fullartland/m15textless*, if any exist.

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
