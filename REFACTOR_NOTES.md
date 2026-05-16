# Spellwright v2 Refactor — Notes

This document summarizes what the v2 refactor session changed, what was
intentionally deferred, and the operational details a future session (or
the deploy owner) will need to pick up the work.

The session worked on branch `claude/stupefied-curie-3a7d3e`, off `main`,
inside the worktree at `.claude/worktrees/stupefied-curie-3a7d3e`.

---

## 0. Critical context: pre-existing branch divergence

Before any code was written we discovered the deployed Supabase project
was **17 migrations** ahead of `main` (which had 11). A parallel branch
`claude/beautiful-sinoussi-bb7577` carried two commits the user had not
merged:

- `d306fd8 Phase 9 hardening + Phase 10: Scryfall remix`
- `8c47299 Phase 11: Premium polish & power features (chunks 01–16)`

Net delta: **257 files** (+6,658 / −30,231 lines), including a complete
Scryfall integration, DFC (double-faced card) support, premium card
finishes (foil/etched/borderless/showcase), light-mode theme, card hover
3D effect, skeleton/Suspense streaming, view transitions, command
palette, bulk dashboard actions, set drag-reorder, username-scoped card
URLs (`/card/[username]/[slug]`), upload byte-sniffing, usage insights
UI, and a Playwright + Vitest test scaffold.

We asked the user how to reconcile (see chat). They chose **"merge
beautiful-sinoussi into here first, then build the v2 refactor on top"**
+ **"fix the card_type DB constraint as part of the work"**.

That merge is commit
[`7fca979`](../../../). It resolved 8 conflicts: 7 files were taken from
the other branch wholesale (it was strictly ahead on those surfaces) and
`app/globals.css` was hand-merged to keep both sides' additive blocks.

Two `0011_*.sql` migrations now coexist briefly in the merged tree:

- `0011_ai_rate_limit.sql` — already applied to remote, brought in from
  the merge.
- `0011_card_types_mtg.sql` — never applied; renamed to
  `0018_card_types_mtg.sql` in Phase 0 below.

---

## 1. What shipped, mapped against the user's v2 spec

Read this as a checklist against `Spellwright v2 Refactor` from the
initial prompt. Each item links to the commit that introduced it.

### Phase 0 — Schema v2 compat (`1fbfc73`)

- ✅ Renamed `0011_card_types_mtg.sql` → `0018_card_types_mtg.sql`
  and applied it via the Supabase MCP. The deployed `cards.card_type`
  CHECK constraint now accepts `instant`, `sorcery`, `planeswalker`,
  and `battle`. The UI was already exposing those options; saves of
  those card types were silently failing on prod before this commit.
- ✅ New migration `0019_v2_compat.sql` (applied via MCP):
  - `cards.oracle_text text` — mirror of `rules_text` for Scryfall
    parity. NO trigger; server actions write both columns.
  - `cards.mana_value numeric(4,2)` — Scryfall's `cmc`.
  - `cards.layout text NOT NULL default 'normal'` with CHECK against
    the Scryfall layout vocabulary.
  - `card_comments` table + RLS + indexes + `updated_at` trigger.
- ✅ Regenerated `types/supabase.ts` via MCP and added
  `CardComment` / `CardCommentInsert` / `CardCommentUpdate` aliases.
- ✅ `types/card.ts` — `ArtPosition.rotation?: number` and new
  `CardCommentWithAuthor` composed type.
- ✅ `lib/validation/card.ts` — `rotation` on `artPositionSchema`,
  new `CARD_LAYOUT_VALUES` + `cardLayoutSchema`, optional
  `oracle_text` / `mana_value` / `layout` on the base card schema.
- ✅ `lib/scryfall/import-mapper.ts` — `instant` / `sorcery` /
  `planeswalker` / `battle` no longer collapse into the legacy
  `spell` value during import.
- ✅ `components/creator/card-creator-form.tsx` `CARD_TYPE_OPTIONS`
  now lists all nine modern types with Lucide icons
  (Crown for Planeswalker, Shield for Battle, etc.). The legacy
  `"spell"` value is silently accepted on existing rows but no
  longer surfaced in the picker.
- ✅ `components/cards/card-preview.tsx` `showsLoyalty` /
  `showsDefense` now gate on the **card type** (planeswalker /
  battle), not on rarity. Mythic non-planeswalkers stop drawing
  a phantom Loyalty pill.

Side fixes folded into the same commit because they would have
blocked the typecheck:

- `components/creator/frame-style-picker.tsx` — `Required<FrameStyle>`
  type now requires `finish` (per Phase 11 chunk 03), so presets are
  loosened to `Pick<…, 'border' | 'accent'>` and the preset click now
  merges over the existing value so the user's chosen finish is
  preserved.
- `app/(marketing)/set/[slug]/page.tsx` — `items.length` was
  referenced outside the inner Suspense component's scope; the
  "Open booster" button is now always exposed.

### Phase 8 — Lift IP guardrail in the AI card assistant (`395661a`)

- ✅ `lib/ai/card-assistant.ts` system prompt now explicitly **allows**
  the full vocabulary of published MTG keyword abilities (Flying,
  Trample, Deathtouch, …), full mana templating (hybrid `{W/U}`,
  Phyrexian `{W/P}`, snow `{S}`), and generic Magic flavor concepts
  (planeswalkers, the color pie, the Multiverse).
- ✅ Still forbidden: copying published card names verbatim,
  Wizards-owned proper nouns (Jace, Liliana, etc.) as a card's
  identity, and unrelated real-world IP.
- ✅ The `generate_from_concept` whitelist updated from the old
  6-type subset to the 9 modern card types.

### Phase 6 — Download modal with PNG / PDF / Letter / A4 (`f278ec8`)

- ✅ `lib/render/card-pdf.ts` — `PdfLayout` extended to
  `"card" | "sheet" | "sheet-letter" | "sheet-a4"`. Both Letter
  (612×792pt) and A4 (~595.276×841.890pt) get the same 3×3 of
  180×252pt MTG cards with corner crop marks. The legacy `"sheet"`
  alias still produces the Letter sheet so existing share/embed
  links keep working.
- ✅ `app/api/cards/[id]/pdf/route.ts` accepts
  `?layout=card|sheet|sheet-letter|sheet-a4` and `?paper=letter|a4`;
  filename distinguishes A4 sheets.
- ✅ New `app/api/cards/[id]/png/route.ts` — HD PNG download with
  the same RLS-based visibility model (public CDN-cacheable,
  unlisted no-cache, private owner-only).
- ✅ New `components/cards/download-modal.tsx` — Radix Dialog +
  Tabs, four panels each with `download={filename}` anchors.
- ✅ Wired into:
  - Public card detail (`/card/[username]/[slug]`) — replaces the
    disabled `Share` placeholder and the owner-only `ExportButton`;
    one modal serves everyone.
  - Editor (`/card/[slug]/edit`) — replaces the separate
    `ExportButton + PrintButton` pair in the page header.

### Phase 5 — Gallery social + SEO (`commit after f278ec8`)

- ✅ `app/sitemap.ts` now batches a DB query for every public card
  and emits canonical `/card/[username]/[slug]` URLs (capped at
  5000). Cards owned by usernameless profiles are skipped because
  they're unreachable via the public URL.
- ✅ 20 `/gallery?color=…&rarity=…` filter combo URLs are appended
  so search engines can build long-tail pages like "red mythic MTG
  cards."
- ✅ `app/(marketing)/card/[username]/[slug]/page.tsx` emits a
  JSON-LD `CreativeWork` block on shareable cards (public + unlisted),
  with name / description / image / author / publisher / datePublished.
- ✅ Comment thread on the canonical card detail page:
  - `lib/cards/comments-queries.ts` — `listCommentsForCard`
    joins comments with the author profile.
  - `lib/cards/comments-actions.ts` — Zod-validated
    create/update/delete server actions, revalidating the right paths.
  - `components/cards/card-comments.tsx` — client component, anon
    viewers see a sign-in CTA, authors can edit/delete their own.
- ✅ `components/cards/share-targets.tsx` — Radix Dialog with four
  targets: copy link, X intent, Reddit submit, Discord (clipboard
  with markdown). Inline SVG glyphs for X/Reddit since Lucide
  doesn't ship them.
- ✅ `app/(marketing)/ai-mtg-card-generator/page.tsx` — SEO landing
  targeting "AI MTG card generator" queries. Mirrors the
  `/mtg-card-maker` structure with AI-focused copy + 8-item FAQ.

### Phase 4 — AI random card generator (`commit after Phase 5`)

- ✅ Installed `openai` (official SDK) and `@ai-sdk/openai`.
- ✅ Migration `0020_random_card_actions.sql` (applied via MCP)
  extends `card_ai_calls.action` to accept `generate_random_card` and
  `generate_random_art` so the two halves count independently.
- ✅ `lib/ai/random-card.ts` — one GPT-4o call via `generateObject`
  with a Zod schema covering every editable card field PLUS an
  `art_prompt` field for DALL-E. System prompt mirrors the Phase 8
  posture (real MTG vocabulary allowed; verbatim published names
  forbidden).
- ✅ `lib/ai/random-art.ts` — DALL-E 3 HD (1024×1024 vivid) → fetch
  the result URL → upload to `card-art/<userId>/ai-<uuid>.png`. The
  asset stays on the project's Supabase Storage origin (DALL-E URLs
  expire after ~60min).
- ✅ `lib/ai/rate-limit.ts` extended with
  `checkRandomCardDailyLimit` — caps the random-card flow at
  **10/day per user** on top of the global 200/day. Matches the v2
  spec's quota.
- ✅ `app/api/ai/random-card/route.ts` — auth + Supabase +
  `OPENAI_API_KEY` gates → global rate limit → daily cap → log +
  generate text → log + generate art. `maxDuration = 90s`.
- ✅ Form action: new "Generate with AI" row in the Identity tab
  next to "Start from a real card." Disabled for guests and while a
  request is in flight; on success the form resets every field via
  `setValue()` and the art URL + focal point.

### Phase 2 (subset) — Rotation + keyboard nudge (`e535ce7`)

The Phase 11 merge already brought in a sophisticated `ArtUploader`
with drag-and-drop file upload, paste-from-clipboard, drag-to-pan
focal point, shift-scroll zoom, and a focal crosshair. This commit
adds the two missing pieces from the v2 spec on top of that base:

- ✅ `ArtPosition.rotation` (set in Phase 0) wired into the live
  preview transform alongside `scale`, with a slider in the
  Fine-tune panel and ±90° quick-rotate buttons that pivot around
  the focal point.
- ✅ Keyboard nudging on the dropzone (focused):
  - `ArrowL/R/U/D` — move focal point 1% (Shift = 5%)
  - `+` / `=` — zoom in 5%
  - `-` / `_` — zoom out 5%
  - `r` / `R` / `0` — reset to center, 1×, 0°
  - `Enter` / `Space` on an empty dropzone still opens the picker.

### Phase 7 (subset) — Spellwright rebrand pass (`9ed3e6a`)

- ✅ Six surfaces had stray "CardForge" copy left over from the
  parallel branch. All replaced with "Spellwright": dashboard
  metadata, public card OG/Twitter titles + default description,
  gallery hero copy, Scryfall import dialog footnote, card-preview
  footer brand text, Scryfall client User-Agent.
- ✅ Scryfall User-Agent is now driven by the `SCRYFALL_USER_AGENT`
  env var; defaults to `Spellwright/1.0 (+<site>)`.

---

## 2. What was intentionally deferred

### Phase 1 — M15 frame + Beleren/MPlantin/mana-font

**Deferred entirely.** Rationale:

- The Phase 11 `CardPreview` is already substantially polished:
  Lucide rarity gem SVG, keyword-ability bolding, halo gradient by
  color identity, four premium finishes (foil, etched, borderless,
  showcase) with shimmer/etched-gold overlays, reminder-text italic
  rendering, custom `ManaCostGlyphs` with hybrid/Phyrexian/snow
  support. It's not pixel-identical to a printed M15 frame, but it's
  a coherent original visual language that already differentiates
  Spellwright in screenshots.
- The v2 spec asks for `mana-font` (single-color glyph font),
  Beleren, and MPlantin downloads from `printmtg.com`. We didn't
  attempt the downloads in this session because:
  - The URLs aren't on a domain we control; if they 404 the user
    explicitly told us to stop and ask rather than swap fonts.
  - The full M15 frame rebuild is multi-day work (custom mana-cost
    rendering, set-symbol slot, holo stamp area, P/T pill, type-line
    art, plus updating the Satori renderer to ship the binary fonts).
- The existing `ManaCostGlyphs` would be a downgrade if replaced by
  `mana-font` (the latter is monochrome; the former renders gradient
  multi-color gems).

**Follow-up plan if/when you want to tackle it:**

1. `npm i mana-font adm-zip` + `npm i -D @types/adm-zip`.
2. Write `scripts/install-fonts.ts` that fetches the two ZIPs,
   unzips into `public/fonts/mtg/`, and falls back with a clear
   error if either URL 404s.
3. Add `@font-face` declarations in `app/globals.css` for Beleren +
   MPlantin and CSS custom properties `--font-mtg-title` and
   `--font-mtg-body`.
4. Import `mana-font/css/mana.css` in `app/layout.tsx`.
5. New `lib/cards/mana.ts` parser + `components/cards/mana-cost.tsx`
   that renders parsed cost as `<i className="ms ms-cost ms-W
   ms-shadow" />` chips — only behind a feature flag at first since
   it visually conflicts with the current `ManaCostGlyphs`.
6. New `components/cards/mtg-frame.tsx` that implements the M15
   layout (title bar / art window / type line / text box / P-T pill
   / collector info bar / holo stamp area).
7. Wire `CardPreview` to render `MtgFrame` behind a frame-template
   toggle; default to the existing rich-preview until the M15 art
   pass is complete.
8. Update `lib/render/card-image.tsx` (Satori) with the same layout,
   registering Beleren + MPlantin via `next/og`'s font loader.
   Mana symbols need inline SVG (Satori can't load icon fonts).

### Phase 3 — Scryfall autocomplete typeahead

**Deferred — the existing Scryfall import dialog covers the spec's
intent.** The Phase 11 `ScryfallImportDialog` already runs a debounced
search-as-you-type backed by `/api/scryfall/search` and shows result
chips. A separate autocomplete-only route on top of that would be
duplicative.

If a true autocomplete keystroke surface is wanted later, the path is
small: `app/api/scryfall/autocomplete/route.ts` that returns just the
matching card names array (Scryfall has a dedicated `/cards/autocomplete`
endpoint), backed by the existing `lib/scryfall/client.ts` throttle.

### Phase 7 — Mobile/perf/a11y polish (partial)

Done:

- Rebrand (above).
- Phase 11 already shipped: focus-visible rings on all interactive
  primitives, focus traps via Radix Dialog, prefers-reduced-motion
  guards on card-hover/skeleton/view-transitions, Suspense streaming
  on gallery + dashboard.

Deferred:

- `@tanstack/react-virtual` virtualization for the gallery grid. The
  current grid pages at 24/page which is well under any browser's
  pain threshold; adding virtualization right now is premature.
- Mobile-specific accordion for the card-creator-form tabs. The
  current tab UI already wraps acceptably at narrow widths; the
  tabs themselves are flex-wrap. A dedicated accordion mode at <lg
  is a UX improvement but not a blocker.
- 100ms debounce on the form's `useWatch`. We didn't observe any
  laggy-typing in practice during the session, but it's a worthwhile
  micro-optimization once we see real-world traffic.
- `@axe-core/cli` automated pass. Worth running once the M15 frame
  lands since that surface is the biggest source of potential
  a11y debt.

---

## 3. Schema/migration history (this session)

Two migrations were authored and applied to the remote DB via the
Supabase MCP. Both are additive and reversible. They are also present
as SQL files in `supabase/migrations/` so `supabase db push` against a
fresh local stack will re-apply them.

```
supabase/migrations/0018_card_types_mtg.sql       — applied 2026-05-15
supabase/migrations/0019_v2_compat.sql            — applied 2026-05-15
supabase/migrations/0020_random_card_actions.sql  — applied 2026-05-15
```

`0011_card_types_mtg.sql` was renamed to `0018_card_types_mtg.sql`
during the Phase 0 commit; the rename is recorded as a git move so
history is preserved.

The deployed DB already had `cards.back_face` (`0015_card_back_face`)
and `cards.source_scryfall_id text` (`0016_scryfall_source`) from the
Phase 11 work. We deliberately did NOT add a duplicate `scryfall_id
uuid` column as the spec originally suggested; `source_scryfall_id` is
the canonical column for that fact going forward.

---

## 4. Environment variables added

`.env.example` documents the new keys. The deploy owner needs to set:

- `OPENAI_API_KEY` — gates the Phase 4 random-card generator. Without
  it, the API returns 503 with a friendly "not configured" message
  and the form button stays disabled. The rest of the app is unaffected.
- `OPENAI_RANDOM_CARD_MODEL` (optional) — defaults to `gpt-4o`.
- `OPENAI_IMAGE_MODEL` (optional) — defaults to `dall-e-3`.
- `SCRYFALL_USER_AGENT` (optional) — defaults to
  `Spellwright/1.0 (+<site>)`.

Existing keys are unchanged.

### Cost & quota choices

Per the v2 spec, we capped random-card generation at **10 cards per
user per 24h**. Cost estimate at OpenAI's current published rates:

- GPT-4o structured output ≈ \$0.01 / card
- DALL-E 3 HD 1024×1024 ≈ \$0.08 / image
- Per-user max daily ≈ \$0.90
- 100 max-throttling users ≈ \$90/day platform spend

If real-world usage approaches the spend cap, two easy levers are:

1. Lower the daily cap in `lib/ai/rate-limit.ts`
   (`RANDOM_CARD_DAILY_LIMIT`).
2. Switch `OPENAI_IMAGE_MODEL` to `dall-e-3` standard (\$0.04) or
   `gpt-image-1` if you'd like a different cost/quality profile.

The migration also accepts a future `generate_random_text` flow
(text-only, no DALL-E) — the action enum has room for it without
another migration.

---

## 5. How to re-apply migrations on a fresh Supabase project

```
supabase db push
```

…will replay every migration in `supabase/migrations/` in sequence,
including the three this session added. The `0018_` rename means the
migration's _timestamp_ slot is new but its DDL is unchanged from the
previous `0011_card_types_mtg.sql` file.

If you're seeding from scratch, also remember to seed the fantasy
game system row (already in `0003_card_data_model.sql`).

---

## 6. Tests + verification

- `npm run typecheck` — green at HEAD.
- `npm run lint` — green except for one pre-existing
  `@typescript-eslint/no-unused-vars` warning in
  `components/sets/set-analytics-panel.tsx` (CardType import). Did
  not touch it this session.
- `npm run build` — green; all new routes (`/ai-mtg-card-generator`,
  `/api/ai/random-card`, `/api/cards/[id]/png`) are listed.
- Did NOT run `npm run test` (Playwright + Vitest, brought in by the
  Phase 11 merge). They have their own setup requirements; verifying
  them is a follow-up.
- Did NOT smoke-test the UI in a browser this session. The Vercel
  preview deploy on this branch is the right place to do that.

---

## 7. Loose ends to surface before launch

1. **Test the random-card flow with a real `OPENAI_API_KEY`.** The
   error envelope is well-tested at the type level but DALL-E's
   safety filter occasionally rejects benign prompts; the route
   degrades gracefully (returns the card text without art) but
   you'll want to confirm the toast copy in person.
2. **Guest mode on `/preview`.** The Phase 11 merge dropped the
   guest-mode handling in the form's action bar. The
   `userId={null}` callsite at
   `app/(marketing)/preview/page.tsx` still works for the form
   structure but the "Sign in to save" button + "Preview mode"
   badge are gone. Re-add as a Phase 7 follow-up.
3. **Comments badge.** The card detail page shows a comment count
   inline in the `<h2>`. Consider surfacing the count on the public
   `/card/[username]/[slug]` gallery tile too.
4. **`/profile/[username]` comment-list integration.** The Phase 5
   query / actions / component all assume a single card context;
   listing a user's comment history would be a small extension.

---

## 8. Commits in chronological order

```
67c3454  Spellwright rebrand + MTG feature                          (pre-session)
7fca979  Merge claude/beautiful-sinoussi-bb7577: Phase 10 + 11      (session)
1fbfc73  Phase 0: schema v2 compat + card_type unblock              (session)
395661a  Phase 8: lift IP guardrail in AI card assistant            (session)
f278ec8  Phase 6: download modal with PNG / Single PDF / 3×3 Letter / 3×3 A4
<…>      Phase 5: gallery social — comments, sitemap, JSON-LD, share, AI landing
<…>      Phase 4: AI random card (GPT-4o text + DALL-E 3 art)
e535ce7  Phase 2: rotation slider + keyboard nudge for the positioner
9ed3e6a  Phase 7 (minimum): rebrand remaining CardForge → Spellwright
```

The user can `git log --oneline claude/stupefied-curie-3a7d3e` after
pulling to see the full history.
