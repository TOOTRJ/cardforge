# 12 · Card Creation Experience Audit — 2026-06-09

Deep audit of the card creation experience: codebase, UX, competitor landscape,
and per-frame visual accuracy against official cards (Scryfall references).
Produced on branch `feat/creation-audit`; the implementation section at the end
records what was actually changed in this pass.

---

## 1. Codebase summary

Spellwright is a Next.js 16 (App Router) + Supabase app. Card creation lives in
a single React Hook Form stepper (`components/creator/card-creator-form.tsx`,
~2k lines) with a pure, unit-tested step model (`lib/creator/steps.ts`).
Rendering is a **two-renderer, one-schema** architecture:

- **Live preview** — `components/cards/card-preview.tsx` (client). Scales with
  CSS container units (`cqw`).
- **Bake** — `lib/render/card-image.tsx` (Satori via `next/og`). Produces the
  stored PNG (`card-renders/{owner}/{card}.png`, re-baked on every save), the
  OG image, the PNG download, and the page images inside the PDF exports.

Both read the same per-frame coordinate profile
(`lib/cards/template-layout.ts`: every region is a %-of-card `Rect`; every font
size a fraction of card width) and the same shared helpers (`rules-text.ts`
tokenizer, `card-display.ts` gating/type-line/chapters, `render-tiers.ts` font
tiers). 23 frames ship, all MSE-derived (Full-Magic-Pack), grouped into 6
frame-set families.

**Verdict: the architecture is right.** One coordinate schema, two mechanical
consumers, no third renderer anywhere. The drift that exists (see §7) is in
small renderer-specific details, not structure.

### Display surfaces (who renders what)

| Surface | Source |
|---|---|
| Editor, card detail page, booster viewer, homepage teaser | live `CardPreview` |
| Gallery / feed / dashboard / profile / set / trending / liked tiles | baked PNG (`BakedCardThumbnail`), falls back to live `CardPreview` when no bake exists (private cards) |
| OG image, PNG download, PDF exports | `renderCardImage()` at request time from the DB row |

Downloads are **not** the stored bake — they re-render fresh at request time
with entitlement-correct watermark/resolution. Same renderer, same profile, so
output is consistent by construction.

### Data model

`cards` is one row per card; everything the renderer needs is on the row
(including denormalized set-icon fields and the JSONB `back_face`). No
template/layout versioning exists — see §8.

---

## 2. Current creation flow

`/create` (auth) and `/preview` (guest) mount the same stepper:
**Frame → Details → Art → Rules → [Adventure/Flip side/Other half/Aftermath/Back face] → Publish.**

- Frame: two-stage picker (set family → frame), Scryfall import + AI random
  card quick-starts.
- Details: title, mana-cost pip builder, card type chips, supertype, subtypes,
  rarity, color identity (manual), tags.
- Art: upload/paste/drag (8 MB, server-validated, NSFW-scanned), focal-point
  drag + shift-scroll zoom, AI art, Scryfall art import, artist credit.
- Rules: rules + flavor textareas, type-gated stats (P/T, loyalty, defense),
  streaming AI assistant (7 actions).
- Publish: visibility, add-to-set, finish (premium-gated), slug (collapsible).

Save = explicit button → server action → zod validation → insert/update →
best-effort bake → redirect to edit page. No autosave; guests get
"Sign in to save".

---

## 3. Competitor findings (verified 2026-06-09)

Full citations in the research transcript; claims below were verified by
fetching the named pages.

| Competitor | Model | Notable |
|---|---|---|
| **MTG Cardsmith** | Art-first multi-page wizard + gallery/contests + print shop | Coarse text control (3 sizes); edit-after-publish and purge-immunity locked behind $10/mo; 750-card free cap. Reviewers call output "janky". |
| **MTG.Design** | Account-walled single-screen editor (free, Patreon) | Editor invisible until signup — the hardest account wall in the category. Server-rendered share JPGs. |
| **Card Conjurer (live fork: cardconjurer.app)** | No-account single-page tabbed editor, client canvas | Deepest feature set: frame masks/layering, richest brace-code vocabulary (`{wup}`, `{oldtap}`, `{fontsize}`, `{flavor}`), drag-on-card art, 800 DPI export, localStorage saves (5 MB ceiling). Original site killed by WotC C&D (Nov 2022); mirrors churn. |
| **MTGCardBuilder** | Card Conjurer engine + WordPress cloud gallery/remix | "1200 DPI free", community frames, print partner. |
| **Magic Set Editor** | Desktop | The fidelity/sets gold standard; no cloud. Our frames derive from its community pack. |

**Synthesis relevant to us**

1. Brace codes (`{W}`, `{2/U}`, `{T}`) are the de-facto symbol-input standard;
   weak tools have tiny button vocabularies. **Nobody** offers a good
   picker + typed-syntax hybrid with discovery — open opportunity.
2. Automatic, Magic-accurate text fitting is a category-wide weakness
   (Cardsmith: 3 coarse sizes; Card Conjurer: manual `{fontsize}` codes).
3. Import-a-real-card is the established cold-start (we have it ✓).
4. Account walls and pay-to-edit are the most resented patterns; our guest
   `/preview` + free editing is the right side of that fight, but guest work is
   lost on sign-in (no draft persistence).
5. Single-screen + always-visible preview is praised; multi-page wizards
   punished. Our stepper with free desktop step-jump + sticky preview is
   acceptable, but every avoidable step/required field hurts.

---

## 4. Our UX problems (walkthrough findings)

Severity tags: **C**ritical / **H**igh / **M**edium / **L**ow.

1. **[H] No way to insert symbols into rules text.** The renderer supports
   inline pips, but the Rules step is a bare textarea with no toolbar, no
   autocomplete, and no mention that `{T}`/`{G}` syntax exists. Users can't
   discover the feature that makes rules text look real.
2. **[H] Pips inside reminder text render as literal braces** —
   `({T}: Add {G}.)` stays raw text. The single most common reminder format on
   real cards is broken (`lib/cards/rules-text.ts` treated a parenthetical as
   words only).
3. **[H] Color identity is manual.** Pick a red cost, forget the color chips →
   colorless frame. On real cards color follows cost; we make it a separate
   required decision (and the #1 wrong-frame trap).
4. **[M] "Next" hard-blocks on required title at step 2** — guests exploring
   the tool must invent a name to proceed (desktop rail can jump, but the
   primary affordance refuses).
5. **[M] Details step mixes essentials with metadata** (supertype, subtypes,
   tags — gallery metadata — sit between cost and rarity). Too many decisions
   before the first interesting preview.
6. **[M] Guest work evaporates** — full editor on `/preview`, but "Sign in to
   save" discards the draft (no localStorage persistence).
7. **[M] Long text silently clips.** The rules box is `overflow: hidden` with
   char-count font tiers; 4 000 chars are accepted by validation but
   half-vanish on the card with no warning.
8. **[L] AI copy says "GPT-4o drafts the card"** — actually
   `claude-haiku-4-5` (text) + `gpt-image-1` (art).
9. **[L] Vestigial `template_id`** persisted but read by no renderer; rotation
   field stored, rendered nowhere.
10. **[L] Form default visibility is `public` while the zod default is
    `private`** — latent mismatch only (the form always sends a value), but
    one constant should own this.
11. **[L] Token type lines can't express "Token Creature — Soldier"** (type
    `token` renders alone; users must abuse supertype).

---

## 5–6. Recommended UX structure: Quick vs Detailed

**Recommendation: progressive disclosure inside the existing stepper — not two
entry points, not a mode toggle, not a new wizard.**

Why: the stepper model is pure/tested, frame-aware steps (Saga/Adventure/back
face) already appear only when relevant, and competitor evidence says fewer
visible decisions wins. Two separate flows would bifurcate the form (and
eventually the renderer contract) — explicitly against the project's
one-source-of-truth rule.

- **Quick path = the default surface.** Per step, only: Frame · Title + Cost +
  Type (+ stats) · Art · Rules/Flavor + symbol toolbar · Visibility + Save.
  Color identity auto-derives from the mana cost. A user can ship a
  real-looking card touching ~6 controls.
- **Detailed path = "More options" per step** (collapsible): supertype,
  subtypes, tags, color-identity override, rarity-adjacent metadata, slug,
  finish, set assignment, artist credit. Everything stays on the same form
  state, same validation, same renderer.
- Publish remains the single save surface; back-face steps continue to
  auto-appear for multi-panel frames.

---

## 7. Set/frame visual accuracy audit

Method: new dev-only harness (`POST /api/dev/render`, production-disabled)
bakes arbitrary `CardPreviewData` through the **real** Satori pipeline;
`scripts/visual-audit.mjs` builds each frame's payload from an official card's
own Scryfall data (name/cost/type/rules/art-crop), downloads the official
scan, and writes side-by-side composites to `tmp/visual-audit/<frame>.png`.
References used (one per frame): XLN Colossal Dreadmaw (m15), TMC Evolving
Wilds (m15land), CMR Soldier token, KHM Berg Strider (snow), OGW Reality
Smasher (devoid), M19 Vivien Reid (pw), LEA Llanowar Elves + Forest (alpha),
MOM Invasion of Zendikar (battle), DOM History of Benalia (saga), ELD
Bonecrusher Giant (adventure), CHK Nezumi Graverobber (flip), GRN Connive //
Concoct (split), AKH Dusk // Dawn (aftermath), LTR Frodo Baggins (ring), LTC
The Black Gate (scroll), TLA Toph (avatar), BLB Zoraline ×2, TDM Skirmish
Rhino / Clarion Conqueror / Craterhoof Behemoth (tarkir ×3). Alpha token has no
official analog (rendered solo vs MSE intent).

**Geometry is faithful.** Region rects match the MSE specs (which match real
cards) to within ~0.5% — e.g. m15 art window ours 7.8/11.4/84.4/44.0 vs MSE
7.7/11.5/84.3/44.2. The gaps are typography and per-frame detail:

### Systemic (affect all/most frames)

| # | Finding | Severity | Fix |
|---|---|---|---|
| S1 | **Rules text undersized and wrongly tiered.** MSE/real cards: 14px @ 375 card width (3.73%) shrinking *to fit* down to 6px. Ours: 3.2% max, shrinking by char-count tier to 2.05% regardless of fit; long text silently clips. | **Critical** | Shared fit-estimating size model (both renderers), base ≈ MSE values |
| S2 | **Display font is a light Goudy; real cards are Beleren Bold.** Titles/type/PT read thin and small even at correct nominal size. | **High** | Vendor Beleren Bold TTF from the local Full-Magic-Pack (same accepted trade-dress class as the frames; swap-one-file contract preserved) |
| S3 | Mana cost pips oversized on m15 family (5% vs MSE 4%) | Medium | `costSizePct` |
| S4 | *(bake only)* Hybrid/twobrid/phyrexian pips render on a flat grey disc — preview shows the correct two-color split | **High** | Two-color gradient gem in `ManaGem` |
| S5 | *(bake only)* Keyrune set icons bake as the *default* glyph, not the chosen set's | **High** | Parse keyrune.css codepoints like mana.css |
| S6 | Pips inside reminder text render as literal `{T}` braces (both renderers — at least consistently wrong) | **High** | Tokenizer fix |
| S7 | Punctuation after a pip floats (`⊕ : Add` vs `⊕: Add`) | Medium | Attach bare-punctuation words to the preceding glyph |
| S8 | Flavor text: real MPlantin Italic not loaded (synthesized oblique), newlines collapse (attribution lines), 0.85 opacity + full-width hairline vs authentic bar | Medium | Vendor `mplantinit.ttf`, split lines, restore ink |
| S9 | Reminder text dimmed to 0.7 opacity; real cards print it full-ink italic | Low | Drop the dim |

### Per-frame

| Frame | Finding | Severity |
|---|---|---|
| m15pw | **No per-ability loyalty badges/rows** — abilities render as one flat paragraph; official has +1/−3/−8 badges in a left rail with alternating row shading. The defining planeswalker feature is missing. | **High** |
| tarkirdragon | Type line light-on-light — unreadable | **High** |
| tarkirdraconic | Title dark-on-dark art — unreadable | **High** |
| tarkirghostfire | Type/PT low contrast on pale plates | Medium |
| lotrscroll | Title uses light ink on the tan ribbon; official is dark | Medium |
| lotr (ring) | Type line dark-on-dark gold band | Medium |
| agclassic | P/T white-with-outline; official LEA is dark ink | Medium |
| saga | Pre-marker reminder line dropped entirely (user content lost); round solid badges vs official hex outline; "I, II" share-a-marker renders as one pill not stacked | Medium |
| split | Both halves take the card's single color identity (official: per-half) — model limitation, document | Medium |
| battle / m15pw | Defense/loyalty drawn badges approximate the official shield shapes | Low |
| flip | No official M15 flip exists (MSE modernization) — internally consistent ✓ | — |
| m15token / alphatoken | MSE token trade dress differs from official full-art tokens (arch window vs full bleed; P/T above type bar) — accepted MSE intent | Low |
| m15land | MSE color-orb in title bar is intentional MSE trade dress (kept; title already insets past it) | — |
| all | No collector number / set code / copyright line support (footer is `Art: X · Spellwright`) | Low (feature) |

---

## 8. Rendering architecture & consistency audit

- **One canonical renderer pair, one schema** — confirmed across every
  surface; no rogue renderers found. ✓
- Fonts: registered explicitly in Satori; preview `@font-face` declares
  `font-weight: 400 700` to suppress faux-bold so browser == Satori. ✓
- Bake correctness risks found: art is fetched by URL inside Satori at
  request time (a dead art URL degrades the bake silently); bake is
  best-effort on save (failure leaves stale/missing PNG with only a console
  warn). Acceptable for now; surfaced here for the record.
- **No template versioning.** Galleries show PNGs baked at save time; if a
  frame profile/PNG changes, old gallery tiles stay stale until the owner
  re-saves, while detail pages/downloads re-render live → **the same card can
  look different in the gallery vs its own page after template updates.**
  Recommendation (not implemented): store `layout_version` on bake + a
  `scripts/rebake-stale.mjs` admin sweep; bump the constant when profiles
  change materially.
- Foil finish intentionally differs preview (animated conic) vs bake (static
  linear) — documented, acceptable.
- The new `/api/dev/render` harness + `scripts/visual-audit.mjs` make the bake
  independently testable for the first time (visual regression seed).

## 9. Download / view consistency

- Download = fresh `renderCardImage()` — same pixels as preview modulo
  entitlement watermark/resolution. PNG (free: 750×1050 + watermark; paid:
  1500×2100 clean), PDF single (Plus), 3×3 sheets (Pro). ✓
- Saved cards reopen identically (all render inputs persisted on the row,
  including art focal/scale). ✓
- Gaps: no WebP/JPEG option (PNG is correct default; fine), no transparent
  background option (correct: cards are opaque artifacts), gallery staleness
  per §8.

---

## 10. Prioritized plan

**Critical** — S1 rules-text size model; S6 reminder pips.
**High** — symbol toolbar + syntax discovery in Rules step; S2 Beleren; S4
hybrid gems in bake; S5 keyrune glyphs in bake; m15pw loyalty rows; showcase
ink-contrast cluster; auto color identity.
**Medium** — S3 pip size; S7 punctuation hugging; S8 flavor italic/newlines;
saga intro row; quick/detailed restructure; guest draft persistence;
non-blocking step navigation; agclassic P/T ink.
**Low** — copy fixes; reminder dim; collector-info feature; token type-line;
versioned bakes (recommend, larger).

## 11. Implemented in this pass (branch `feat/creation-audit`)

**Rendering accuracy (both renderers, verified vs Scryfall references):**
- Fit-based rules-text sizing (`fitRulesSizePct`) replaces the char-count
  tiers: authentic MSE base sizes (m15 3.73% of card width), shrink only to
  fit, shared math so preview == bake. Applied to the main box, adventure
  panel, and rotated second faces. Profile base sizes raised across all 23
  frames.
- Beleren Bold is now the display face (titles/type/PT/footer) and MPlantin
  Italic the true italic master — both vendored from the same non-commercial
  Full-Magic-Pack as the frames, registered in the browser and Satori.
- Pip-size contract standardized (`costSizePct` = disc diameter; preview
  divides by mana-font's 1.3em disc, bake draws it directly) and set to the
  MSE spec (m15 4%); bake pip gap/shadow now match the preview's CSS.
- Hybrid/twobrid pips bake as real split-color discs; phyrexian pips tint to
  their color (was: flat grey, preview≠bake).
- Keyrune set icons bake as the actual set glyph (codepoints parsed from
  keyrune.css), not the generic default.
- Reminder-text pips fixed: `({T}: Add {G}.)` renders real symbols in both
  renderers; reminder text is full-ink italic (dimming removed).
- Unbreakable "tight runs": `{T}:` and `{G}{G}` never split across lines and
  punctuation hugs its pip, in both renderers.
- Planeswalker frames render printed-style ability rows: loyalty-cost badges
  (+1/−3/0) in a left rail with alternating row shading
  (`parseLoyaltyAbilities`, profile `loyaltyRows`).
- Saga rail renders the pre-chapter intro/reminder line (was dropped).
- Flavor text preserves line breaks (attribution lines) and uses the real
  italic master.
- Per-frame ink-contrast fixes: tarkir Dragon Wing type (dark on silver,
  measured band position), Draconic title, Ghostfire type/PT, LOTR Scroll
  title+type, agclassic P/T (dark, like real 1993 prints); scroll rules box
  shortened to the parchment.

**Creator UX:**
- Rules-step symbol toolbar (front + back face): one click inserts the brace
  code at the caret — pips for WUBRGC, tap/untap/X/snow/energy, generics, and
  an expandable hybrid/twobrid/phyrexian palette. Helper text teaches the
  typed syntax.
- Color identity auto-derives from the mana cost ("match mana cost", on by
  default for new cards; any manual edit or import takes over).
- Quick/Detailed structure via per-step "More options" disclosure: Details
  shows title/cost/type/rarity, folding supertype/subtypes/colors/tags; Art
  folds artist credit. Same form, same renderer, no second flow.
- Step navigation no longer blocks on validation (validation runs at save and
  routes to the offending step).
- Honest AI copy (was "GPT-4o"); dead `ManaCostBuilder` removed.

**Tooling/tests:** dev-only `/api/dev/render` harness (404 in production),
`scripts/visual-audit.mjs` (side-by-side composites vs official scans in
`tmp/visual-audit/`), and unit tests for the tokenizer, fit model, loyalty
parser, and saga intro (156 tests green).

**Deliberately not done (follow-ups):** per-half split colors, baked-render
template versioning + re-bake sweep, collector-info fields, hex saga badges,
guest draft persistence (localStorage), token "Token Creature" type-line
composition.

---

## 12. Round 2 (2026-06-09, same branch): M15-family verification + save model

### M15 set family — frame-by-frame verification

Method upgrade: geometry now comes from the **MSE style files themselves**
(`magic-m15-*.mse-style/style` — exact element rects/font sizes at 375×523)
plus **direct band measurement of our frame PNGs**
(`scripts/scan-frame-bands.mjs`) where MSE's rotated-element coordinates are
ambiguous. Every frame re-rendered through `scripts/visual-audit.mjs` and
compared against its official reference.

| Frame | Status | Corrections applied |
|---|---|---|
| m15 (Standard) | ✅ verified | — (reference standard) |
| m15land | ✅ verified | none needed (M15 clone + orb inset confirmed correct) |
| m15snow | ✅ verified | M15 clone confirmed |
| m15devoid | ✅ verified | M15 clone confirmed |
| m15token | ✅ fixed + verified | type pill moved 87.5→82.6% (measured band 82.2–87.0); P/T moved to the bottom band (88.6%, MSE 286,469) in dark ink like printed full-art tokens; type 3.4%w |
| m15pw | ✅ fixed + verified | full MSE spec applied: title 4.4%/4.27%w, art 6.7/9.9/86.4/81.7, type 56.6%/3.47%w, ability text block 63.1–91.4% (badge rail + indent match MSE 63→345px), loyalty badge to 88.2/81.5 (MSE 462,326) |
| battle | ✅ fixed + verified | plates measured: title pill 5.0–12.0, art 13.6–57.2, type 58.2–65.0, text 67.2–96.2; defense badge centered on MSE 480,336 (93.9%, 92.8%) |
| saga | ✅ fixed + verified | MSE spec: title 5.4%/4.27%w, art 50.1/11.3/41.9/72.5, rail 11.5–83.5% with badge column, type 84.9%/3.47%w, chapter text 2.9%w |
| adventure | ✅ verified | none this round (MSE adventure spec applied in round 1) |
| flip | ✅ fixed + verified | bottom half re-measured from the PNG: type bar 68.0 (band 67.6–72.4), text 73.4–85.2 (band 72.6–86.0), title 87.8 (plate 87.2–92.4); P/T to MSE 82.1%/3.47%w both halves; top type 3.47%w |
| split | ✅ fixed + verified | cost pips 2.3%→3.44%w (MSE 18px — larger than the name, like printed splits); title 2.87%w. Per-half colors remain a documented model limit |
| aftermath | ✅ fixed + verified | title 4.0%w + type 3.47%w per MSE; text band extended to the measured 41.0–54.2 |

### Save model (stepper resets / "weird autosave")

Root causes found:
1. `reset(defaults)` keyed on prop **identity** — `router.refresh()` after
   every save (and any RSC re-render) produced new `card`/`gameSystems`/
   `templates` objects and silently wiped live edits.
2. Create-mode save navigated to the edit page with no step context — full
   remount, stepper back to Frame.

Decision: **explicit Save + automatic local draft** (not server autosave).
Server saves bake the public PNG and carry publish semantics — autosaving
those on keystrokes would re-bake constantly and publish half-finished
states. Implemented:
- Reset now keys on `card.id:updated_at` (real card changes only).
- Create→edit redirect carries `?step=<key>`; the stepper initializes from it.
- Debounced (800 ms) localStorage draft on create/preview
  (`spellwright:card-draft:v1`), restored on the next visit with a
  "Start fresh" escape — a guest's draft survives signing up. Cleared on
  successful save.
- Edit-mode saves mark the form clean immediately (`reset` keeping values).
- Native before-unload warning whenever changes are unsaved.
- Status badge: "Draft kept on this device" / "Unsaved changes" / "Up to date".

---

## 13. Round 3: render versioning + re-bake sweep (and a discovery)

- `cards.layout_version` (migration 0037, applied to the live DB) records the
  renderer generation that baked each stored PNG; every save-time bake stamps
  it (`CARD_LAYOUT_VERSION`, lib/cards/layout-version.ts — bump on any
  output-changing renderer/profile/asset change).
- `POST /api/admin/rebake` (service-role, CRON_SECRET-gated in production,
  dev bypass locally) re-bakes public/unlisted cards whose render is missing
  or version-stale, in batches; `scripts/rebake-renders.mjs` loops it.
- Shared bake plumbing extracted to `lib/cards/bake-core.ts` so the sweep and
  the save-time bake render identically.

**Discovery while wiring this up:** the live database has **never persisted a
single baked render** — 0 objects in `card-renders`, `rendered_at` NULL on all
60 cards (53 public) — while `card-art` has 111 objects through the same auth
pattern. Every gallery tile has silently fallen back to the live `CardPreview`
since launch, which also means the "stale gallery PNGs" concern was moot in
practice. The save-time bake fails best-effort-silently (`console.warn`); the
sweep reports per-card errors, so its first run doubles as the diagnostic for
the root cause.

**Root cause found + fixed (same day):** the bake uploads with `upsert: true`,
which Supabase storage executes as `INSERT … ON CONFLICT DO UPDATE` — and that
plan requires SELECT visibility on `storage.objects`. `card-renders` had
insert/update/delete policies but **no SELECT policy**, so every
session-authenticated upsert failed RLS ("new row violates row-level security
policy"). `card-art` never hit it because it uploads with `upsert: false`; the
sweep never hit it because service_role bypasses RLS. Migration **0038** adds
the owner-scoped SELECT policy; a live dev probe then confirmed the real
`bakeCardRender` succeeds with the user session client, and the sweep
backfilled all 53 public cards (verified: 53 objects, `layout_version = 2`,
gallery tiles serving from `card-renders`).

**Key migration:** the service-role JWT used for the sweep was exposed during
setup, so the code now prefers Supabase's new API keys —
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) and
`SUPABASE_SECRET_KEY` (`sb_secret_…`) — with the legacy names as fallbacks
(lib/supabase/env.ts, lib/supabase/admin.ts). Disabling the legacy JWT keys in
the dashboard then revokes the exposed key without touching user sessions.
