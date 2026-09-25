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
- [ ] **0.10 [P1] Verification metadata + history** — migration adding
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
- [ ] **1.12 [P3] Title schema to 150 chars; proxy edge cases** (`?id=&exact=`,
      Scryfall 400 vs ambiguous 404 messages).
- [ ] **1.13 [P2] Refresh `ABILITY_WORDS`** (`lib/cards/rules-text.ts`:33) with
      the 2024–2026 words + a test against Scryfall's `catalog/ability-words`.
- [ ] **1.14 [P2] Kindred stays a supertype word; delete the dead
      `tribal → "spell"` mapping** (`import-mapper.ts`).

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
- [ ] **3.8 [P2] Artist footer on the 13 footer-less templates** (flip, split,
      aftermath, battle, every showcase).
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
- [ ] **3.12 [P1] Layout-version bump + rebake sweep** after the fixes (owner
      badge flow; /news post) — bundle with 4.4/4.8/4.9 if timing allows.

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
- [ ] **4.2 [P1] Storage move** — frame masters + WebP + small picker thumbs in
      a Supabase Storage (or Vercel Blob) bucket behind the CDN;
      `components/cards/frame-layer.tsx` and `lib/render/card-frames.ts` read a
      configurable frame origin; bounded LRU for the bake's in-memory frame
      cache; stop committing masters to git. **[decide]** history rewrite.
      Land before the first CC frame ships.
- [ ] **4.3 [P1] CC importer** (`scripts/import-cc-pack.mjs`) — clone the fork
      locally, flatten each pack's layers + masks per colour into exact-5:7
      1500×2100 PNGs with the art window at alpha 0, keep P/T plates, crowns,
      colour-indicator pips and DFC icons as overlay assets, import the bounds
      into the profile, write manifest provenance. Also generalise MSE mask
      compositing for the mainframe styles (`scripts/build-artifact-blend.mjs`,
      `scripts/build-adventure-frame.mjs` are the seeds).
- [ ] **4.4 [P1] Re-source the M15 base family from CC** — m15, m15land,
      m15token, m15tokenartifact, m15artifact, m15snow, m15snowland,
      m15devoid, m15pw → measured profiles → auto-score → walk → verify → ONE
      layout-version bump + rebake sweep + /news post. Changes every existing
      card's look; do it once, deliberately.
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
- [ ] **4.7 [P1] M15-era variants from CC**, in request-log order — extended
      art + borderless (replace the contradicted profiles), textless, full-art
      lands (generic first, per-set later), Nyx (fix), class, prototype,
      mutate, leveler, spree/companion/miracle/lesson marks, tokens + emblems,
      4-ability + compleated planeswalkers. Each ships through 0.9 → 2.2 → 2.4.
- [ ] **4.8 [P1] Era typography** — Magic Medieval for 1993–2002 titles, Matrix
      Bold for 2003–2014, Beleren Small Caps for the artist, a Gotham-class
      font for the collector line; `font` on the profile; registered in the
      bake + `@font-face` in the browser (self-hosted, licence check like the
      current Beleren/MPlantin); parity tests.
- [ ] **4.9 [P1] Collector info line + holofoil stamp** — card fields for set
      code, collector number, language (default EN), rarity letter derived;
      footer redesigned to the M15 layout (number, set • lang, artist brush
      glyph, © line) with the brand mark relocated; stamp overlay by rarity
      (oval; UB triangle on UB frames); Scryfall import fills set/number;
      editor fields on the Set icon step; both renderers; bump + rebake
      (bundle with 4.4).
- [ ] **4.10 [P1] Old borders** — check whether CC ships 1997/2003 frames at
      high resolution; if not keep MSE's 375 px for classic/retro/modern
      **[decide]**; complete their references (all seven colours, lands,
      tokens), apply 4.8 fonts, verify + publish. Future Sight stays "Soon".
- [ ] **4.11 [P1] Showcase families from MSE (744–750 px)**, in request-log
      order — re-measure the 12 contradicted profiles from scans (lotr,
      lotrscroll, avatar, bloomburrow, bloomanime, tarkir ×3, expeditionland,
      fullart, m15textless ×2), then per-set full-art basics and the
      most-requested families of the last three years (the pack holds 40+ at
      hi-res). Each family gets its own reference printings.
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

### Phase 5 — Two-sided cards end to end (3–4 weeks; needs 4.3 and 4.5)

- [ ] **5.1 [P1] Transform + MDFC kinds with real back-face frames from CC**
      (front/back, icon families by set era, dark back treatment, colour
      indicator, grey back P/T on the front, "transforms into" hint line); the
      back face carries its own frame/colour/rarity. **[decide]** retire or
      merge the `back_card_id` path.
- [ ] **5.2 [P1] Editor** — second-face editor for DFC on the Identity step
      (own art, colour, frame variant, stats); remove the "Double-faced cards —
      coming soon" veil on Publish (`components/creator/coming-soon.tsx`,
      `panels/publish-panel.tsx`:252).
- [ ] **5.3 [P1] Bake both faces** (two PNGs + thumbs), gallery tile flip, card
      page flip (exists), downloads (both faces PNG, two-page PDF, ZIP), OG
      stays front, share copy (`lib/cards/bake-core.ts`:89,
      `lib/render/card-image.tsx`:579, `lib/render/card-pdf.ts`,
      `components/cards/download-modal.tsx`).
- [ ] **5.4 [P1] Import** — `transform`/`modal_dfc`/`battle`/`meld` printings
      seed the DFC kind; icons from the `*dfc` frame effects; back colour from
      the back face.
- [ ] **5.5 [P2] DFC sagas + battle backs, double-sided tokens.**
- [ ] **5.6 [P3] Meld.**

### Phase 6 — Creator polish and print (2–4 weeks, after Phase 4 basics)

- [ ] **6.1 [P2] Print-ready export** — bleed option (2.75×3.75 in at 300/600
      → 825×1125 / 1650×2250), MPC preset (816×1110 at 300, 1632×2220 at
      600), PDF sheets with cut lines + bleed, card-back sheet; canonical
      render stays 1500×2100; an 800 ppi export later from the CC masters
      **[decide]** free vs paid.
- [ ] **6.2 [P2] CARDNAME / `~` substitution** and "this creature" helper in the
      rules editor; opt-in keyword reminder-text insert with a current CR list.
- [ ] **6.3 [P2] Nickname / flavour-name field** (title bar + small Oracle
      name); UB © line when a UB frame is chosen.
- [ ] **6.4 [P2] Tokens** — automatic "Token" prefix + reminder line, emblem
      kind, token generator from a card's rules text (P3).
- [ ] **6.5 [P2] Foil/etched finishes: ship or remove** **[decide]**; if
      shipped, align preview and bake (`panels/effects-panel.tsx`:26).
- [ ] **6.6 [P2] Language + set-code fields** feed the collector line (with 4.9).
- [ ] **6.7 [P2] Accessibility** — text alternatives for rules-text pips, chip
      keyboard navigation (3b.10), announced substitution notices.
- [ ] **6.8 [P3] Batch/CSV/MSE-set import**; community frame packs stay out of
      scope (frames remain admin-verified).
- [ ] **6.9 [P3] Watermark preset library refresh + Keyrune update.**

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
- [ ] **7.4 [P2] Admin dashboard tile** — verification progress, requests
      (1.6), scores, rebake state.
- [ ] **7.5 [P2] Rebake operations** — sweep tooling for bundled bumps, /news
      post template, a "why does my card look different" FAQ entry.

Sequencing at a glance: Phase 0 (all) → 1.1–1.6 + 3b.1–3b.5 alongside Phase 2
→ Phase 3 + rest of 3b (hold the layout bump) → 4.1–4.4 + 4.8 + 4.9 with one
bundled bump/rebake → 4.5–4.7 and 4.11 in request-log order (4.10 when
references exist) → Phase 5 → Phase 6; Phase 7 throughout.

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
