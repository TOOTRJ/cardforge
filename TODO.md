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
numbers refer to commit `6077252`.

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
- [ ] **0.18 [P2] Tests** (partly done 2026-09-25: reference validation, override save/reset stale marking, second-face preview, scan geometry, templateSupportsKind — still open: score route, verify toggle + pin e2e) — `setFrameReviewAction` (reference-column
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
      - :26 and :63 claim 'one renderer'. PipGlyph has a DOM preview plus a separate Satori bake, with open parity items 3.1–3.7.

      Describe the preview as 'matches the export, checked by parity tests (3.11)'. Compare on the real differences: hosted with an account, AI, custom pips, decks, gallery, verified frames. When 6.14 ships, also update `lib/content/faq.ts`:221-222 and :74-76 of the article ('no CC import'). Extends 0.19's 'keep claims verifiable'.

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
      verified. Fixtures from live data: BLB anime (no effect, borderless,
      collector range), ZNR full-art Island, THS Nyx (`enchantment` on a 2003
      frame), LTR ring/scroll, TDM ×3, Expeditions (`set_type: masterpiece`),
      extended art, legendary crown, `*dfc` effects, `future`.
- [ ] **1.5 [P0] Import dialog UX** — per-printing status (✓ Exact · ≈ Nearest
      · ✕ Not available); full printings list with a treatment filter instead
      of newest/oldest 30 (`app/api/scryfall/printings/route.ts`:108,
      `client.ts`:304); on a non-exact apply, an inline "PipGlyph doesn't have
      the *X* frame yet — pick one of these" chooser (kind's published frames
      for the imported colour, nearest preselected, "keep my current frame");
      a "Frame substituted (imported …)" chip on the Card step; rewrite the
      "matched to this printing's border era" copy
      (`components/creator/scryfall-import-dialog.tsx`).
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
- [ ] **3.6 [P2] Brand mark on landscape** — size by height, anchor away from
      the defense badge (`card-preview.tsx`:1014, `card-image.tsx`:709).
- [ ] **3.7 [P1] Saga chapters through `RulesBody`** with the fit ladder and
      pips (`card-preview.tsx`:1294, `card-image.tsx`:1536).
      **Card Conjurer audit 2026-09-25:** Start chapter text at the 7.5 pt compact standard; today `SAGA.chapters.sizePct` 0.029 W = 5.2 pt (`lib/cards/template-layout.ts`:828-836) vs CC 0.0427 W. Put the chapter rail on the profile: badge at x 3.86 W, 7.87 W × 6.29 H straddling the left border; numeral 0.045 W; text 13.34–48.34 W; reminder block 8.67/11.29/40.4×17.72; rows 17.86 % H from 28.96, content-sized via 3.13's helper. Both renderers; verify on History of Benalia (DOM). Saga is verified, so this is a platform correction (0.20).
- [ ] **3.8 [P2] Artist footer on the 13 footer-less templates** (flip, split,
      aftermath, battle, every showcase).
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
- [ ] **3.12 [P1] Layout-version bump + rebake sweep** after the fixes (owner
      badge flow; /news post) — bundle with 4.4/4.8/4.9 if timing allows.
      **Card Conjurer audit 2026-09-25:** The bundled bump also carries 3.13–3.22 and 4.16–4.20. Geometry and parity corrections go out as a 0.20 sweep, not as owner 'newer look' badges.
- [ ] **3.13 [P0] Planeswalker ability rows sized by content in both renderers** (Card Conjurer audit 2026-09-25) — Both renderers stack equal `flex: 1` loyalty rows (`lib/render/card-image.tsx`:1205-1212, `components/cards/card-preview.tsx`:1778-1786). The browser grows a long row (min-height:auto), Satori/Yoga does not. So a walker with a long ultimate looks right in the editor, while the stored PNG, gallery tile and OG image clip that ability under the loyalty plate. Reproduced by baking a 1/1/5-line m15pw. `fitRulesSizePct` only sees the whole box (`card-image.tsx`:213-231), so nothing shrinks. m15pw is verified for all 7 colours (`supabase/seed.sql`:40-51).

      Fix:
      - Compute per-row heights in the shared fit module: each ability's line count at the fitted size, a floor of one badge height, the remainder shared.
      - Feed the same numbers to both renderers and keep each badge centred on its row.
      - Add an optional per-row weight in `face_content` for manual tuning.
      - Reuse the helper for saga chapters (3.7).

      Acceptance: a parity test with a 1-line / 1-line / 5-line walker. Ship as a platform correction (0.20 sweep).
- [ ] **3.14 [P0] Normalise EXIF orientation for every raster we bake** (Card Conjurer audit 2026-09-25) — `uploadCardArtServerAction` (`lib/cards/upload-art-server.ts`:111-140) stores the original bytes with their EXIF orientation tag, and `components/creator/art-uploader.tsx` does not re-encode on the client. The browser preview honours the tag; the Satori bake ignores it (reproduced: an orientation-6 JPEG bakes unrotated). `toSatoriDataUrl` (`lib/render/art-source.ts`:67-89) passes JPEG/PNG up to 3 MB straight through and resizes larger files without `.rotate()`. So a phone photo looks upright in the creator and sideways in the stored bake, the WebP thumb, the OG image and downloads.

      Fix:
      - Auto-orient with `sharp(buffer).rotate()` and re-encode when `metadata.orientation > 1` in the art, watermark, set-icon and pip upload actions.
      - In `toSatoriDataUrl`, never pass through an oriented JPEG, and call `.rotate()` before `resize()` so existing uploads bake upright.
      - Run a one-off re-bake of cards whose art has orientation > 1.

      Acceptance: a unit test feeds an orientation-6 fixture through `resolveRenderableImage` and asserts upright pixels.
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

      Set `widthPct` to 83.8 / 83.1 and fix the comment. Ship as a platform correction (0.20).

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

- [ ] **4.1 [P1] Frame manifest** (`frames/<template>/frame.json`): source
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
- [x] (infrastructure done 2026-09-25 — feat/frame-storage: migration 0116 `frames` bucket, content-addressed objects + `lib/frames/frame-manifest.json`, `frameUrl()` in preview + bake, hash-checked LRU in the bake, `frames:publish` (dev) / owner `frames:promote` (prod) / CI `frames:check`, docs/FRAMES.md; pilot proved a bucket render pixel-identical to git. Left for later: moving the existing MSE masters out of git (optional), picker thumbs, history rewrite = not doing) **4.2 [P1] Storage move** — frame masters + WebP + small picker thumbs in
      a Supabase Storage (or Vercel Blob) bucket behind the CDN;
      `components/cards/frame-layer.tsx` and `lib/render/card-frames.ts` read a
      configurable frame origin; bounded LRU for the bake's in-memory frame
      cache; stop committing masters to git. **[decide]** history rewrite.
      Land before the first CC frame ships.
- [ ] (progress 2026-09-25 — feat/cc-importer: `scripts/import-cc-frames.mjs` + `scripts/lib/cc-frames.mjs` build 8 M15-era templates + plates into `.frames-build/` with CC's exact layer recipe (mask ALPHA, CC draw order, native size, one downscale; coloured artifacts = artifact frame + colour interior; tokens from the textless bordered pack) and provenance in `lib/cards/frame-sources.json`; m15/c + m15devoid deferred to 4.17 (see-through); still open: crowns / colour-indicator pips / DFC icons as overlay assets, bounds import into profiles (4.4), MSE mask generalisation) **4.3 [P1] CC importer** (`scripts/import-cc-pack.mjs`) — clone the fork
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
- [ ] **4.4 [P1] Re-source the M15 base family from CC** — m15, m15land,
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
      `c` keys: m15tokenartifact → a.png; m15token → l.png or keep MSE **[decide]**.
      (2) M15-family `artSlot` = CC artBounds 7.67/11.29/84.76×44.29, which fixes today's hairlines on land, snow and artifact.
      (3) m15artifact per 4.16 (not the MSE blend, not the prototype's pinline-only recipe); m15devoid gets its own profile per 4.17; m15/c per 4.17's [decide].
      (4) m15pw, m15token and m15tokenartifact are 1500×2100 in CC too.
      (5) Correct the 2026-09-24 evaluation notes: token profiles don't need re-measuring, and CC does have a colourless land (`m15/new/l.png`).
      (6) 0.23, 4.16–4.20 and 7.6 land before, or in the SAME, layout bump.
      **Swap blockers (Card Conjurer audit 2026-09-25) — all must be handled in or before this item:**
      (Blockers 1, 2, 6 and the importer half of 7 are already done in the 4.3 importer, PR #378: CC's exact artifact recipe, the textless token pack, excluded see-through frames, native-size compositing. m15devoid is deferred to 4.17.)
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
      12. 800 ppi: only 6 of 4.4's 9 templates get 2010 px masters; m15pw and both token templates are 1500×2100 in CC too. Don't announce 6.1b as sharp for them; gate the option on manifest nativeSize, and on 6.10 for the art.
      13. Storage: 4.2 is still in progress on feat/frame-storage (lib/frames/frame-manifest.json is empty; migration 0116 creates the bucket). CC masters must reach the production `frames` bucket through frames-promote before 4.4 merges, and must never be committed to the public repo.
- [ ] **4.5 [P1] Treatment × kind overlay model** — per-kind overlays (P/T
      plate, vehicle plate, loyalty rail + shield, defense badge, chapter rail,
      class/leveler bars later) as separate assets composed at render time via
      a new profile capability, so borderless/extended/textless/full-art/
      showcase treatments work for every kind; restrict every frame to the
      kinds whose overlays exist (replace `SHOWCASE_KIND_RESTRICTION`,
      `card-kinds.ts`:227). Fixes planeswalkers/battles in showcase frames
      printing no stat.
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
      **Card Conjurer audit 2026-09-25:** Also drive `modern`/`modernland` (and 1997 gold) with the same two-colour logic: CC's `auto8thEditionFrame` stacks pinlineRight/rulesRight/frameRight on pack8th, and the Ravnica, Shadowmoor and Alara hybrids and golds were printed on the 2003 frame (critic).

      Crown = a family keyed by treatment:
      - Standard: CC `crowns/new/{w,u,b,r,g,m,a,l,c}` at 2.19/1.88/95.62×17.52, plus a black border cover 0–4.87 % H clipped to our rounded corners.
      - Floating + lower-cutout + outline for borderless, extended and showcase.
      - UB crowns (4.25); transform/MDFC crowns (5.1); Nyx/companion inner crowns at 16.37/2.49/67.31×2.27.
      - Colour follows the pinline letter, split for two colours; auto from Legendary, with an opt-out.

      Vehicle is a full treatment, not just a P/T box: CC `v.png` as the Frame + Border layers (colour or artifact bars stay), the `m15PTV` plate fitted to 4.18's plate box, white P/T ink, auto from the Vehicle subtype. Reference: Smuggler's Copter (KLD).

      Colour indicator: base at 7.67/57.48/4.67×3.34, the type slot indented when shown, 2–3 colours via CC's half/third masks, 4–5 colours drawn by us, the base redrawn as vector for 800 ppi.

      'Coloured-artifact blend' is replaced by 4.16, because the current blend is inverted.
- [ ] **4.7 [P1] M15-era variants from CC**, in request-log order — extended
      art + borderless (replace the contradicted profiles), textless, full-art
      lands (generic first, per-set later), Nyx (fix), class, prototype,
      mutate, leveler, spree/companion/miracle/lesson marks, tokens + emblems,
      4-ability + compleated planeswalkers. Each ships through 0.9 → 2.2 → 2.4.
      **Card Conjurer audit 2026-09-25:** - **Borderless:** a 4.5 treatment in two text-box heights (CC FullArtNew 2010 px standard, IkoShort short, GenericShowcase fallback) with floating crowns, plus borderless pw/token. Signature: border_color=borderless without a showcase effect.
      - **Extended art:** from CC `m15/new/extended` (2010 px, includes c and v; art 0/8.39/100×54.37).
      - **Nyx (fix):** a new `m15nyx` skin of m15 from CC `m15/new/nyx` (normal cream text box, dark ink; c → a.png). Auto for Enchantment Creature/Artifact and for `frame_effects: enchantment` on non-showcase printings. Add a saga Nyx and a Nyx inner crown. KEEP the `nyx` template as the THB 'Constellation' showcase, which matches its references.
      - **Tall walker:** `m15pwtall` from CC PlaneswalkerTall (type y 49.67, rows from 55.81 at 8.96 %, symbol y 52.34), auto at ≥4 loyalty rows; Compleated as a skin on it.
      - **Case and Fuse (new):** Case (MKM) as the class column with `face_content.case = {text, toSolve, solved}`; Fuse (DGM) as a split skin with a full-width fuse bar. Class stores `face_content.class.levels`.
      - **Leveler:** via a `tiers` capability (shared with Station, 4.27).
      - **Saga creatures:** a P/T slot plus CC saga/pt plates (64 cards).
      - **Seeds:** class art 7.53/11.24/42.47×72.53, rail x 50.93 w 40.4, header bars 4.81 % H; leveler bands 63.03/72.29/82.2 (lower two indented to 20.67), P/T 65.91/75.24/85.15; prototype band 8.6/63.57/69.4×9.19, mana 63.81, white pt2 69.35; mutate art to 75.63, rules 75.67–91.82; miracle overlay 4/2.86/92×53.24.
      - 'Tokens' moves to 4.22 and 'emblems' to 6.4.
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
- [ ] **4.11 [P1] Showcase families from MSE (744–750 px)**, in request-log
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

      Per-set full-art basics: CC for ZEN/THB/SNC/NEO/UB/2022/snow/UST/UNH, MSE for DFT/AFR/LCI/ONE/UNF, with one shared full-art land profile per layout family.

      Masterpieces in request-log order, Mystical Archive first (CC 2010 px, plus JP); then Inventions, Invocations, nonland Expeditions, Praetors, Signature Spellbook and promo tall-art.
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
- [ ] **4.16 [P0] Coloured artifacts: artifact outer frame, colour interior (CC's recipe)** (Card Conjurer audit 2026-09-25) — Every coloured `m15artifact` frame is inverted today (verified, all 7 colours in `supabase/seed.sql`). `scripts/build-artifact-blend.mjs` gives the colour's outer border with a silver title bar and text box: sampled `public/frames/m15artifact/r.png` has a red side (202,82,41) and a silver title (203,212,217). Real Embercleave (ELD) and Phyrexian Metamorph (2XM) scans have a silver artifact outer frame (side 209,226,246 / 167,173,195) with colour-tinted type bar and text box. Cursed Mirror and Esper Sentinel match. That is exactly CC's `cardFrameProperties` + `autoM15NewFrame` (`creator-23.js`:577-747,1038-1110).

      Build m15artifact in the 4.3 importer:
      - `new/a.png` through the Frame + Border masks.
      - `new/{colour}.png` through the Pinline + Title + Type + Rules masks.
      - The colour P/T plate.
      - 2 colours per 4.6 (split pinline/rules, gold bars unless hybrid); 3+ colours → m.

      Build m15tokenartifact the same way with the token masks. The scratchpad prototype importer (silver base + colour only through the pinline mask) is also wrong.

      Fix the wrong description in the build-script header, `types/card.ts`:272-274 and the `m15artifact` note in `lib/cards/frame-references.json`.

      Acceptance: re-score every colour against Esper Sentinel, Phyrexian Metamorph and Embercleave. Ships inside the 4.4 bump as a platform correction (0.20).
- [ ] (in progress 2026-09-25 — feat/cc-m15-swap: `underFrameArt` profile field, both renderers; owner decision: colourless + devoid show art like real cards) **4.17 [P1] Art under the frame for translucent frames (devoid, CC colourless)** (Card Conjurer audit 2026-09-25) — The m15devoid frames (verified, live) are translucent: type bar α≈204, text box α≈188, sides α≈34. But art is drawn only inside the inherited M15 `artSlot` over the #101015 ground (`lib/render/card-image.tsx`:285,291; `components/cards/card-preview.tsx`:627-631; `M15DEVOID = …M15`, `lib/cards/template-layout.ts`:554). So the text box renders flat grey and the side strips near-black, where print shows the art through them (Kozilek's Channeler, Introduction to Prophecy). CC's `m15/new/c.png` ('Eldrazi') is equally see-through (α 212/179/26).

      Fix:
      - Add a profile capability `artUnderFrame`: colours 'all' on m15devoid. For m15, use ['c'] only if the owner picks CC's translucent colourless **[decide]**; otherwise keep an opaque c. It draws the art over CC's devoid bounds (4 / 10.39 / 92 × 89.61, clipped to the card) beneath the frame in both renderers, with `artSlot` kept as the crop/focus hint.
      - Give m15devoid its own profile and CC's devoid P/T plate (= m15PTC).
      - Check rules/type legibility in the compare tool and re-verify all colours.

      Ship before or with 4.4.
- [ ] **4.18 [P1] Separate the P/T plate box from the value box; CC plate geometry for the M15 family** (Card Conjurer audit 2026-09-25) — The M15 plate (540×304, core aspect 2.03) is object-fill stretched into `pt.rect` 73/89.3/23×5.8 (`lib/cards/template-layout.ts`:330-340; `lib/render/card-image.tsx` ~1389, `components/cards/card-preview.tsx` ~1147). Its core lands at 75.0–95.8 W × 89.3–93.9 H (aspect ≈3.2). The printed plate sits at ≈77.9–94.2 × 89.1–94.6 (DOM Serra Angel). Every profile that spreads M15 inherits the stretch, and CC's plate can't be dropped in without the same distortion.

      Fix:
      - Add `StatSlot.plateRect`, also in the profile-override zod schema.
      - M15 family: plate 75.73/88.48/18.8×7.33 (CC `packM15RegularNew.js`:3, m15PT*.png), value 79.28/90.2/13.67×3.72; retune `valueDyEm` on the Serra Angel scan.
      - The same field serves the vehicle plate (4.6), the token plate (4.4) and saga-creature plates (4.7).

      Ship as a platform correction bundled with 4.4 (0.20).
- [ ] **4.19 [P1] Planeswalker anatomy on the profile (with 4.4)** (Card Conjurer audit 2026-09-25) — On m15pw (verified), the cost badges sit inside the rules rect at ≈10.3–20.5 W (`badgeW = 2.3×size`; `lib/render/card-image.tsx` ~1169, `components/cards/card-preview.tsx` ~1796), and every ability's text starts at ≈22.7 W. Print (Gideon BFZ) and CC straddle the frame edge (`versionPlaneswalker.js`:168-188, `packPlaneswalkerRegular.js`:37-41). `loyaltyRows` holds colours only (`lib/cards/template-layout.ts`:455-469).

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

      Add shared `TITLE_SIZE`/`TYPE_SIZE` constants, with landscape profiles scaled to the same absolute size and the fit ladder shrinking long lines. Re-check after 4.8's Beleren2016. Bundle the bump with 4.4.
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

      Verification: saga is verified in production and must be re-verified. The other five get their first verification this way (0.9 → 2.2 → 2.4). Same bump as 4.4 if timing allows.
- [ ] **4.22 [P1] Token text-length family (tokens with abilities)** (Card Conjurer audit 2026-09-25) — Our m15token/m15tokenartifact is CC's 'Textless (Bordered M15)', which CC files under 'Older Tokens' (`groupToken-2.js`:2-15). Token abilities are printed on a 50% black scrim over the art (`lib/cards/template-layout.ts`:518-528). No printed token looks like that, and 490 of 821 `t:token` cards have rules text (Treasure, Food, Clue, most UB tokens).

      Add CC's current full-art token family as `m15token` variants: token/textless, short, regular and tall, each with w/u/b/r/g/m/a/l + frameC + snow.
      - Pick the variant from rules length: none → textless, 1–2 lines → short, 3–4 → regular, more → tall. Manual override under Variations.
      - Seeds: art 4/2.86/92×89.53; type y 81.96 / 67.8 / 65.0 / 56.64; rules 71.43–91.91 (regular) and 63.03–91.78 (tall); P/T 79.28/90.2.

      Also add a bordered text-box variant from token/m15/regular, so today's arch look has an abilities version: art 12.48–63.91, type 65.0, rules 8.6/71.43/82.8×20.48, symbol centre 67.43.

      Delete the scrim. Import picks the variant from the Oracle line count. References: Treasure (txln) and Treasure (tmsh). **[decide]** which family is the default token look.
- [ ] **4.23 [P1] Era text treatment (1993/1997/2003)** (Card Conjurer audit 2026-09-25) — The 1993 and 1997 profiles print title, type, P/T and artist in dark ink (`lib/cards/template-layout.ts`:382-420 AGCLASSIC, 622-672 RETRO), and their comments claim printed P/T is dark, which is wrong. Real 1997 cards (LGN White Knight, SCG Enrage, TOR Shambling Swarm) print them white with a black drop shadow, even on white cards. Alpha prints them light grey with a shadow. The 1997 footer is a centred `Illus. <artist>` over the © line. The 2003 footer is white on black, land and colourless frames (CC `pack8th.js`:55-68), but ours is dark for every colour (:691-738).

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
- [ ] **4.31 [P2] Frame-review follow-ups still open** (owner review of every
      production card, 2026-09-25; the fixed half shipped as layout v25/v26 in
      fix/frame-review-followups):
      - **[decide] Dragon Wing two-colour cards.** The frame is the Multiverse
        Legends (MOM 2023) Tarkir frame; its only two-colour print (MUL #60
        Taigam, W/U) splits the wings — first colour left, second right — with
        a gold P/T plate. MSE does the same (`special_blend_card.png`, a hard
        vertical split). A prototype (`twoColorSplit` profile field, a clipped
        second frame layer in both renderers, both keys preloaded) was built
        and measured during the review; today a two-colour card gets the gold
        'm' wings on silver.
      - **[decide] Dragon Wing sits under the era "Tarkir: Dragonstorm"**
        (`types/card.ts`) but is the 2023 MUL frame — rename or re-home it. The
        gold TDM dragon frame people expect is `tarkirdraconic`, whose P/T is
        white on light parchment (invisible) and needs the same plate treatment.
      - **[decide] Ghostfire (tarkirghostfire)** keeps only MSE's outline
        (`card.png`, mean α 26); MSE also draws namebox/typebox/textbox at 60 %
        and a pt.png ribbon, all ink white. Our type line sits on the band's
        lower rim (band interior 51.4–56.8 %H, our rect 56–60.5). One production
        card (Veil of Echoes), which the owner marked OK.
      - **Alpha (agclassic) frame proportions.** Real LEA cards end the tan
        frame at ≈95.2 %H (≈100 px of black at HD); our master ends it at
        97.1 %H (60 px). v25 centred the P/T and brand mark in OUR strip and
        border; a re-cut frame would move both again.
      - **Alpha ink on dark frames.** P/T and the artist line are INK_DARK on
        every colour — near-invisible on black (strip luminance ≈33), weak on
        gold/green. Printed Alpha uses a light silver emboss on non-white
        frames: needs per-colour ink on StatSlot + footer in both renderers.
      - **Alpha colourless** uses a flat grey master; printed Alpha colourless
        cards are artifacts on a dark warm-brown border with a light crackle
        text box (Sol Ring, Juggernaut) — an asset re-source.
      - **Display-font word spacing:** "Jester's Mask" renders a 42 px word gap
        (17–25 px elsewhere) on every template — CardDisplay font metrics.

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
      Showcase frames get extension art (import CC's margin packs in 4.3). Corners are square whenever bleed is on. Fixtures: M15, fullartland, extendedart, one showcase. Needs 6.10 so the art has pixels to extend.
- [ ] **6.1b [P1] Download option: 800 ppi export** (owner request
      2026-09-25) — an 800 ppi choice next to the current HD download:
      2000×2800 px at trim, 2200×3000 with the bleed option. Only sharp once
      the M15 family comes from Card Conjurer's 2010×2814 sources (4.4);
      until then it upsamples the 1500×2100 bake. Paid tier only **[decide]**;
      bake on demand (not stored), PNG only.
      **Card Conjurer audit 2026-09-25:** 800 ppi is sharp only where the template's frame AND every overlay it uses are ≥2000 px native (manifest `nativeSize`, 4.1).
      - Of 4.4's nine templates, that means m15, m15land, m15snow, m15snowland, m15devoid and m15artifact.
      - These upsample: m15pw, m15token and m15tokenartifact (1500×2100 in CC too); saga, adventure, split, flip, aftermath and class; holo stamps (192×96); the colour-indicator base (70×70). Label them 'upscaled' or hide the option.
      Prefer CC's Accurate/new packs wherever they exist (UB, extended, full art, snow, Nyx, spree, scroll, Mystical Archive). Needs 6.10 for the art.
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
      frames and inverted bars — that is 4.28.) **FOIL is still broken:** the
      bake's sheen uses `inset: 0` (Satori ignores it) and `mixBlendMode`
      (resvg ignores it), so a foil bake is byte-identical to regular while the
      preview shows a shimmer — a live parity break on 10 production foil
      cards. Needs a Satori-safe design (no blend modes) + a finish-scoped
      sweep, like v26.
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
- [ ] **7.2 [P1] Preview parity** — previews/local render exactly like
      production (0.12, plus the storage origin from 4.2 available to
      previews).
- [ ] **7.3 [P2] `docs/FRAMES.md`** — pipeline, manifest, "how to add a frame"
      (replacing the stale headers in `template-layout.ts` and
      `types/card.ts`), verification SOP, provenance/legal notes; CLAUDE.md
      pointers.
      **Card Conjurer audit 2026-09-25:** (critic) Record CC's free-form editor as a deliberate non-goal (verified geometry wins): per-layer x/y/size/opacity/erase/HSL, uploaded frames and masks, free text-box bounds, `{kerning}`/`{permashift}`-style codes, extra text boxes. 0.24 names them honestly as CC advantages.
- [ ] **7.4 [P2] Admin dashboard tile** — verification progress, requests
      (1.6), scores, rebake state.
- [ ] **7.5 [P2] Rebake operations** — sweep tooling for bundled bumps, /news
      post template, a "why does my card look different" FAQ entry.
- [ ] **7.6 [P1] Art-window coverage test** (Card Conjurer audit 2026-09-25) — Add `tests/unit/render/art-window-coverage.test.ts`: for every template × colour master, flood-fill alpha<16 from each `artSlot`/`secondFace.artSlot` centre and assert the (rotated) slot covers the window with ≥0.05 % overscan. Run it in the 4.3 importer on the flattened CC masters, after the 2010→1500 downscale has anti-aliased the window edge, and in CI.

      Today it would fail on:
      - split (a 1.2 % H strip)
      - lotr (ring 9.87–90.53 × 11.24–55.62 vs slot 14–86 × 13–58)
      - flip and alphaland
      - battle and lotrscroll (borderless PNGs)
      - hairlines on m15token (0.24 % H), saga and the MSE land/snow/artifact windows

      Fix those with 4.21 and the M15-family `artSlot` = CC artBounds (4.4). Translucent frames (4.17) are asserted differently.

Sequencing at a glance (re-ordered 2026-09-25, owner decision: de-risk the
Card Conjurer frame swap early): Phase 0 (0.20 + 0.21, and 0.23's legal wording, before the swap) →
3.13 + 3.14 (P0 live bugs) → 4.16–4.20 bundled INTO 4.4's single sweep →
**4.1–4.4 (manifest, storage
move, CC importer, M15 re-source) with one bundled layout bump/rebake** →
1.1–1.6 + 3b.1–3b.5 alongside Phase 2 → Phase 3 + rest of 3b → 4.5–4.9 and
4.11 in request-log order (4.10 when references exist) → Phase 5 → Phase 6
(6.1a/6.1b as soon as 4.4 lands); Phase 7 throughout.

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
