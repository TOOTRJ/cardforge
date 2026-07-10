# Decks — Feature Plan

Status: **APPROVED 2026-07-09** — delivery in progress (see §10 for the PR
series). Approved decisions: globally-unique `/deck/[slug]` URLs; no printing
of Scryfall scans (checklist page instead); export gating mirrors sets
(PDF/ZIP = Pro, text free); import quota 10/min · 50/day.
Research basis: full codebase audit (routes/UI, data layer, creation/print/share
flows) + MTG deck-format research (Commander/60-card/Brawl/Oathbreaker rules;
Archidekt / Moxfield / MTG Arena / ManaBox export syntax; Scryfall
`/cards/collection` batch API).

---

## 1. Product summary

A **deck** is an ordered, quantity-aware list of MTG cards in a chosen play
format. Deck entries reference *real* cards (resolved via Scryfall) and/or the
user's *custom* PipGlyph cards. The core loop that makes decks uniquely
PipGlyph: **import a real decklist → remix each real card into a custom proxy →
print/share the fully custom deck**. The deck dashboard tracks remix progress
("34 of 100 remixed") and makes original-vs-proxy comparison effortless.

Surfaces:

- **`/decks`** — public browse (replaces the existing "coming soon" stub; the
  nav item with `badge: "Soon"` already exists in `lib/site-config.ts:39`).
- **`/deck/[slug]`** — public deck page + owner "deck dashboard" (same route,
  owner sees management tools — mirrors how `/set/[slug]` works).
- **`/dashboard/decks`** — my decks (grid, new-deck, AI hooks later).
- **Import** — paste a text decklist (Archidekt, Moxfield, Arena, ManaBox,
  MTGO/plain) → parse → resolve → review → commit.
- **Creator integration** — "Add to deck" (+ inline quick-create) in the
  Publish panel; "Remix" deep-link that prefills the creator from a deck entry.
- **Export** — print whole deck to PDF (pages or 3×3 proxy sheets with
  quantities), save all renders as ZIP, copy decklist back out as text.

Guiding decision from the audit: **fork the Sets feature end-to-end** (tables,
lib, components, routes, SEO wiring are all proven) and add the deck-specific
deltas: quantities, boards, formats, Scryfall-backed entries, import, remix
tracking, and deck analytics.

---

## 2. Data model — migration `0055_decks.sql`

Follows `card_sets`/`card_set_items` (0009) + `set_likes` (0023) +
`likes_count` trigger (0043) precedents exactly. RLS: parent-readable → items
readable; writes owner-only; SELECT policy present on every table we upsert
into (upsert-needs-SELECT gotcha).

### `decks`
| column | type / constraint |
|---|---|
| `id` | uuid PK `gen_random_uuid()` |
| `owner_id` | uuid → `auth.users` ON DELETE CASCADE |
| `title` | text, 1–120 chars |
| `slug` | text, **globally unique** (see Decisions §9) |
| `description` | text ≤ 2000, nullable |
| `format` | text CHECK in `commander, standard, pioneer, modern, legacy, vintage, pauper, brawl, standard_brawl, oathbreaker, limited, casual` — default `commander` |
| `visibility` | `private \| unlisted \| public`, default `private` |
| `cover_url` | text nullable (https-gated app-side; auto-fallback: commander/first remixed card render) |
| `likes_count` | int default 0 (trigger-synced) |
| `view_count` | int default 0 (`increment_deck_view` RPC, owner-excluded, clone of 0042) |
| `created_at` / `updated_at` | trigger `set_updated_at` |

### `deck_cards`
One row per (card, board). Quantity-aware — the key structural difference from
`card_set_items`.

| column | type / constraint |
|---|---|
| `id` | uuid PK |
| `deck_id` | uuid → `decks` ON DELETE CASCADE |
| `board` | text CHECK in `main, side, maybe, commander, companion`, default `main` |
| `quantity` | int CHECK 1–250, default 1 |
| `position` | int default 0 (manual ordering within board) |
| `card_id` | uuid → `cards` ON DELETE **SET NULL**, nullable — the remixed custom proxy (or a directly-added custom card) |
| `scryfall_id` | text nullable — the real card this entry represents |
| `name` | text NOT NULL (display name; always present even if unresolved) |
| `set_code` / `collector_number` | text nullable (printing info from import) |
| `type_line`, `mana_cost`, `mana_value`, `color_identity text[]`, `rarity` | denormalized Scryfall display fields (analytics + list rendering without re-fetch) |
| `image_url` | text nullable — Scryfall card image (hotlink per Scryfall guidelines, https-gated) |
| `created_at` / `updated_at` | |

Entry states (derived, no extra column):
- **real, needs remix**: `scryfall_id` set, `card_id` NULL
- **remixed**: `scryfall_id` set, `card_id` set
- **custom-only**: `card_id` set, `scryfall_id` NULL (added from creator/library)
- **unresolved placeholder**: both NULL, `name` only (user chose "keep anyway"
  during import)

Deleting a custom card sets `card_id` NULL → entry reverts to "needs remix"
with its Scryfall data intact. Nice failure mode for free.

### `deck_likes`
Exact clone of `set_likes` (unique `(user_id, deck_id)`, same RLS) + a
`sync_deck_likes_count()` SECURITY DEFINER trigger cloned from 0043.

### Types & validation
- Regenerate `types/supabase.ts`; add narrowed `Deck`, `DeckCard`, `DeckFormat`,
  `DeckBoard` unions to a new `types/deck.ts` (convention: narrowed types, never
  raw generated rows).
- `lib/validation/deck.ts` mirroring `lib/validation/set.ts`: title/description
  bounds, format + visibility enums, `isSafeImageUrl` on `cover_url` and
  `image_url`, `quantity` bounds — schemas shared client+server, mirroring the
  DB CHECKs.

---

## 3. Decklist import (the flagship feature)

### 3.1 Parser — `lib/decks/parse-decklist.ts` (pure, zero-IO, heavily unit-tested)

One tolerant line grammar covers all five source formats:

```
<qty>[x] <Card Name> [(SET) <collector_number>] [*F*|*E*] [[Category]] [^Label,#hex^] [#tag]
```

Handles, per the format research:
- **Quantities**: `4`, `4x`, `4X`; missing qty → 1.
- **Section headers** (case-insensitive): `Deck`, `Mainboard`, `Main`,
  `Sideboard[:]`, `SIDEBOARD:`, `Commander[:]`, `Companion`, `Maybeboard`,
  `CONSIDERING:`, `Tokens` (ignored), `About` + `Name <x>` (captured as deck
  title suggestion). Blank line with no headers = main→side boundary.
  Archidekt `[Commander{top}]` / `[Sideboard]` / `[Maybeboard]` category tags
  and backtick categories map to boards; unknown categories → main.
- **Names**: commas kept (`Atraxa, Praetors' Voice`); `Front // Back` retried
  as front-face on miss; NFC-normalize, curly→straight apostrophes, U+2212;
  strip Arena `A-` Alchemy prefix.
- **Set codes**: 2–6 alphanumerics, either case, may start with a digit
  (`2X2`, `40K`); Arena↔Scryfall code mismatches (e.g. `DAR`→`DOM`) fall back
  to name-only lookup on set miss.
- **Collector numbers are strings** (`237a`, `XLN-117`, `★`).
- **Finish flags** `*F*`/`*E*` stripped (not persisted in v1).
- **Comments** (`#`, `//`, `//!`) and type-group headers (`Creatures (24)`)
  ignored.
- `\r\n`, tabs, duplicate-line merging (same name+set+board → summed qty).

Output: `{ title?, entries: ParsedEntry[], warnings: LineWarning[] }` where
every skipped/odd line carries its original line number and text for the UI.

**Test fixtures**: real export samples from each of Archidekt, Moxfield, Arena,
ManaBox, MTGO-plain, plus an edge-case gauntlet (DFC names, Lim-Dûl, The List
numbers, A- prefix, `1x` style, category/label decorations, CRLF).

### 3.2 Scryfall resolution — extend `lib/scryfall/client.ts`

- New `getCardCollection(identifiers)` → `POST /cards/collection`, ≤75
  identifiers/request, existing slow-path throttle (client already classifies
  `/cards/collection` at the 500ms tier — matches Scryfall's current 2 req/s
  limit for this endpoint). **Reconcile by `not_found`, never array position.**
- Pipeline: dedupe → batch with `{set, collector_number}` when present else
  `{name}` → misses retried `{name}`-only → final stragglers via existing
  `getCardByName({fuzzy})`, ambiguity surfaced as suggestions
  (`/cards/autocomplete` optional).
- Per-user quota: new `deck_import` action in `SCRYFALL_LIMITS`
  (e.g. 10/min, 50/day — one action = one import run, not one API call) +
  `logScryfallCall` audit. Server-side only; a 100-card Commander import is
  2 collection calls ≈ 1s.
- Verify the client sends a compliant `User-Agent` (now mandatory per Scryfall
  docs); add if missing.

### 3.3 Import UX — review-before-commit, never all-or-nothing

Import dialog/panel on the deck dashboard (`components/decks/import-decklist-dialog.tsx`):

1. **Paste** — big textarea, format auto-detected (no format dropdown),
   detected-source hint ("Looks like a Moxfield export"), live line count.
2. **Resolving** — progress indicator (batches of 75).
3. **Review** — three groups:
   - ✅ Resolved (card image thumb, qty, board, printing) — editable qty/board,
     removable;
   - ⚠️ Ambiguous/fuzzy-matched — "did you mean" with the match shown for
     confirmation;
   - ❌ Unresolved — original line text, inline edit + re-resolve, or "keep as
     placeholder" / discard.
   Nothing is written until the user confirms.
4. **Commit** — server action inserts `deck_cards` in one batch; summary toast
   ("97 cards added, 2 placeholders, 1 skipped").

Import into an existing deck merges quantities. Import can also be the
*creation* path: `/dashboard/decks/new` offers "Start from a decklist".

---

## 4. Deck dashboard (`/deck/[slug]`) — public page + owner tools

Clone the `/set/[slug]` page skeleton (hero, analytics panel, card grid,
share) with deck-specific replacements:

**Header**: title, format badge, color-identity pips (union of entries),
owner avatar/@username, likes (`QuickLikeButton kind="deck"`), views,
visibility chip (owner), **remix progress ring — "34/100 remixed"**.

**Card list** — the core view. Grouped by board (Commander pinned on top →
Main → Sideboard → Maybeboard), then by type (Creatures, Instants, …, Lands)
with counts, standard deck-app style. Each row/tile:
- qty × name + mana cost glyphs (`mana-cost-glyphs.tsx` reused),
- **remix state at a glance**: remixed entries show the custom card's baked
  thumbnail with a "Remixed" badge; un-remixed show the Scryfall image slightly
  desaturated with a "Remix" CTA badge. A view toggle: **All / Needs remix /
  Remixed**, plus an **Originals ⇄ Proxies** image-flip toggle for the whole
  grid.
- Click → **deck-card modal** (`Dialog` primitive): large image with an
  original/proxy flipper when remixed, oracle text (`oracle-text.tsx`),
  printing info, links (Scryfall / custom card page), and actions: **Remix
  this card** (primary when un-remixed), Re-link/Unlink proxy, change
  qty/board, remove. Owner-only actions hidden for visitors.

**Analytics panel** (`lib/decks/analytics.ts`, modeled on
`computeSetAnalytics`): mana curve bar chart (0–7+, lands excluded), color pip
distribution, type breakdown, land count, average mana value, card totals per
board ("99/100").

**Format validation** (`lib/decks/format-rules.ts`, pure + unit-tested):
non-blocking inline warnings, Moxfield-style — deck size per format, copy
limits (4-of for 60-card, singleton for Commander/Brawl/Oathbreaker), basic-land
exemption + "any number" allowlist (Relentless Rats, Shadowborn Apostle, Seven
Dwarves ≤7, Nazgûl ≤9, etc.), sideboard ≤15, exactly-one-commander checks.
Color-identity validation deferred to v2 (needs commander color identity from
Scryfall data — we have `color_identity` denormalized, so main-deck subset
checks are actually feasible; include if cheap).

**Owner tools**: add cards (search my custom cards — reuse
`quick-add-to-set-dialog` pattern — or Scryfall search for real cards), import
list, reorder (defer drag-and-drop; position within board via move actions in
v1), edit meta (title/description/format/cover/visibility), delete deck
(confirm dialog), export menu.

---

## 5. Remix flow (real card → custom proxy)

Existing primitives do almost all of this: `mapScryfallToFormPatch`,
`kindFromScryfall`, `frameTemplateFromScryfall`, `/api/scryfall/import-art`,
`source_scryfall_id` provenance.

1. Deck modal "Remix this card" → `/create?deckCard=<deckCardId>`.
2. Create page (already loads `mySets`, accepts `?backFor=` — same seam) loads
   the deck entry, fetches the Scryfall card by `scryfall_id`, and auto-applies
   the import patch through `planKindChange` (identical to the existing
   Scryfall-import dialog path, just triggered by URL param). "Remixing
   <name> for <deck title>" banner (extends the existing `remixSource` banner).
3. On save, `createCardAction` gets an optional `deckCardId`: after insert it
   sets `deck_cards.card_id = row.id` (ownership-checked). Redirect returns to
   the deck dashboard, scrolled to the entry, progress ring updated.
4. If the user already has a custom card matching, the modal also offers
   "Link an existing card" (picker over my cards).

Cards created this way keep `source_scryfall_id`, so existing "also remixed by
N" surfaces and the gallery `?source` filter work unchanged.

---

## 6. Creator integration — add-to-deck + quick create

Publish panel (where the set selector already lives):
- **"Add to deck"** multiselect-lite: dropdown of my decks (board defaults to
  `main`, qty 1) — analogous to `resolvePrimarySet`/`addCardToSetMembership`.
- **Quick-create**: "＋ New deck" inline row (title + format only) — creates the
  deck and selects it without leaving the form. Server action
  `quickCreateDeckAction` (title, format → private deck, slug auto).
- `createCardAction`/`updateCardAction` extended with optional
  `deckIds`/`deckCardId` handled inside the same action (mirrors set
  membership joins).

---

## 7. Export / print

New `app/api/decks/[id]/export/route.ts` modeled on the set export
(`requireTier("pro")`, `maxDuration 300` — see Decisions §9 for gating):

- **PDF, pages** — one card per page (`buildCardPdf`/`buildSetPdf` reuse).
- **PDF, proxy sheets** — 3×3 with crop marks (`sheet-letter`/`sheet-a4`
  layouts exist); **each entry repeated `quantity` times** (that's what you cut
  out and sleeve). 100-card Commander ≈ 12 pages.
- **Perf**: prefer the stored baked render (`rendered_image_url` in the
  `card-renders` bucket) over live `renderCardImage` — set export re-renders
  everything; decks should fetch baked PNGs and only live-render cards with no
  bake. Cap: `MAX_DECK_EXPORT_CARDS = 120` physical cards incl. quantities
  (above the 100-card Commander ceiling; revisit after measuring).
- **What prints for un-remixed entries**: custom renders only by default —
  we should not ship a Scryfall-scan proxy printer (WotC Fan Content Policy
  risk; see Decisions §9). Un-remixed entries are listed on a cover/checklist
  page ("not yet remixed: …") rather than printed.
- **ZIP download** — "Save all cards": server route streams a ZIP of the
  remixed cards' baked PNGs (`jszip`, filenames `NN-card-name.png`).
- **Text export** — "Copy decklist" (Arena-style with headers, and plain MTGO
  style) so decks round-trip back out; uses real names for un-remixed, custom
  titles for remixed (toggle).

Export menu UI lives on the deck dashboard; per-item gating mirrors the
existing download-modal plan gates + upgrade-modal hooks.

---

## 8. Public browse, SEO, stats, and everything decks touch

### `/decks` browse (replaces stub)
- Clone the split-route ISR pattern: `decks/page.tsx` (ISR 300, bare) +
  `decks/browse/page.tsx` (dynamic) + `DECKS_FILTER_PARAMS = ["q", "format",
  "sort", "page"]` in `lib/routing/browse-params.ts` + a `/decks` branch in
  `proxy.ts`.
- Grid of `PublicDeckTile` (clone `PublicSetTile`): cover (or auto card-fan
  fallback), title, format badge, color pips, `@username` + avatar, card
  count, remix-progress mini-bar, `QuickLikeButton kind="deck"`.
- Filters: format chips, search, sort (recent | popular | viewed). Query
  `listPublicDecks` in `lib/decks/queries.ts` via `createPublicClient()`
  (anonymous flag pattern) to stay ISR.

### SEO wiring checklist (all seven hooks from the audit)
1. `app/sitemap.ts`: `/decks` static entry + `fetchPublicDeckEntries`.
2. Metadata: canonical `/decks`; `generateMetadata` on `/deck/[slug]` with
   `robots noindex` for non-public.
3. `deck/[slug]/opengraph-image.tsx` via `lib/og/shell.tsx` (cover/commander
   art + title + format + byline).
4. JSON-LD: breadcrumbs + `CollectionPage`/ItemList (clone set builders).
5. Nav: remove `badge: "Soon"` (`site-config.ts:39`); add "My Decks" to
   `dashboardNav` + mobile drawer; footer Discover column link.
6. `ShareTargets` `entity: "deck"`; oEmbed optional (defer).
7. Revalidation helper `revalidateDeckPaths` fanning to `/decks`, `/deck/[slug]`,
   `/dashboard/decks`, `/profile/[username]`, `/`.

### Stats surfaces to update ("all tracked stats")
- **Profile** (`profile/[username]`): deck-count badge + "Decks by X" section
  (public decks grid).
- **Dashboard**: "Decks" stat tile alongside Cards/Public/Drafts; My Decks
  quick action.
- **Homepage `HomeStats`**: add public deck count once there's inventory
  (flag-gate until N ≥ threshold so it doesn't read "3 decks").
- **Sitemap** (above), **GDPR export** `app/api/account/export/route.ts`: add
  decks + deck_cards to the JSON dump.
- **Notifications**: deck-like notifications need a `notifications.type` CHECK
  extension + nullable `deck_id` — small follow-up migration; defer to Phase 7
  (nice-to-have).
- Deck analytics panel itself (mana curve etc.) covered in §4.

### Naming cleanup
The existing "AI deck generator" (`components/sets/ai-deck-generator.tsx`,
`/api/ai/generate-deck`) generates themed *sets*. Rename user-facing copy to
"AI set generator" in Phase 1 to free the word "deck" (route/file renames
optional, low priority).

---

## 9. Decisions needing sign-off (recommendations first)

1. **Deck URL**: `/deck/[slug]` with **globally-unique slugs** (suffix on
   collision) — recommended. Sets use per-owner-unique slugs at a global
   `/set/[slug]` URL, which is a latent collision wart; decks shouldn't copy it.
   Alternative: `/deck/[username]/[slug]` like cards (more chars, but
   collision-proof and consistent with cards).
2. **Printing un-remixed (real) cards**: recommended **don't print Scryfall
   scans** — checklist page instead. It's the legally safe call and it
   *drives the remix loop* (print is the reward for remixing). Alternative:
   print scans for personal use (WotC policy risk, and hosting/printing real
   card scans could threaten the whole app).
3. **Export gating**: recommended mirror sets — deck PDF export = **Pro**,
   ZIP = Pro, text export = free. Alternative: PDF pages Plus / sheets Pro
   (mirrors single-card gating instead).
4. **Import quota**: 10 imports/min, 50/day per user (each ≤ ~4 Scryfall
   calls). Adjustable constant.
5. **Board scope v1**: main/side/maybe/commander/companion enum now, but UI
   surfaces only Commander/Main/Sideboard in v1 (maybeboard hidden unless
   present in an import).

---

## 10. Delivery plan — 7 PRs

Each PR: conventional-commit title, unit tests, `npm run test:unit` +
`typecheck` + `lint` before push. Migrations ship via PR (Supabase preview
branch validates them — note: pushes to an open PR don't create the preview
branch; open the PR after the migration file is final, or close/reopen).
**`git pull` first — local main is behind origin (PR #193 just merged).**
Reminder: `.env.local` targets PROD; no local schema pokes, e2e needs the
local stack.

Delivered so far: PR 1 = #194 (`feat/decks-core`), PR 2 = #195
(`feat/decks-public`, stacked on #194), PR 3 = #196 (`feat/decks-import`,
stacked on #195; adds migration 0056 for the `deck_import` quota action).

| PR | Scope | Key tests |
|---|---|---|
| **1. `feat(decks): schema + core CRUD`** | Migration 0055 (decks, deck_cards, deck_likes, triggers, RPC), regenerated types, `types/deck.ts`, `lib/validation/deck.ts`, `lib/decks/{queries,actions}.ts`, `/dashboard/decks` (grid + new + edit meta + delete), dashboardNav/mobile entries, "AI set generator" copy rename | validation unit tests, action happy/error paths |
| **2. `feat(decks): public browse + deck page`** | `/decks` + `/decks/browse` (ISR split + proxy + browse-params), `/deck/[slug]` public view (header, boards/type grouping, analytics panel, format-rules warnings), deck likes, ShareTargets `"deck"`, OG image, sitemap/JSON-LD/metadata, revalidation helper, footer link, un-"Soon" the nav | `format-rules` + `analytics` unit tests |
| **3. `feat(decks): decklist import`** | `parse-decklist.ts`, `getCardCollection` in scryfall client (+ UA check), resolution pipeline + rate limit action, import dialog with review step, merge semantics | the big one: parser fixture suite (5 sources + edge gauntlet), reconciliation tests (not_found, fuzzy rescue), quota tests |
| **4. `feat(decks): remix flow`** | Deck-card modal (info + actions), remix deep-link `?deckCard=` prefill in creator, `createCardAction` link-back, link-existing-card picker, remix badges/progress/filter toggles, Originals⇄Proxies flip | prefill mapping tests, link-back action tests |
| **5. `feat(decks): creator add-to-deck`** | Publish-panel deck selector + inline quick-create, `quickCreateDeckAction`, membership writes in create/update card actions | action tests |
| **6. `feat(decks): export + print`** | `/api/decks/[id]/export` (pages + quantity-aware 3×3 sheets, baked-render fast path, checklist page for un-remixed), ZIP route, text export (Arena/plain), export menu UI + gating | PDF layout unit tests (page counts vs quantities), text-export round-trip through our own parser |
| **7. `feat(decks): stats + polish`** | Profile deck section/badge, dashboard tile, HomeStats (flag-gated), GDPR export, empty states, loading skeletons, a11y pass, e2e specs (deck CRUD, import happy-path, remix link — local-Supabase mode), optional: deck-like notifications, feed events | Playwright e2e |

Later (explicitly out of scope now): AI whole-deck update/generation into real
decks, deck comments, deck versioning/history, price data, drag-and-drop
reorder, maybeboard-first UI, Discord bot integration.

---

## 11. UI/UX principles applied

- **Progress as motivation**: the remix ring + Needs-remix filter make the
  deck dashboard a checklist the user wants to complete; print/ZIP as reward.
- **Never lose user input**: import review screen before any write; per-line
  recovery (edit / suggest / placeholder / skip); placeholders keep the name.
- **Non-blocking validation**: format warnings inform, never prevent saving —
  it's a custom-card app, not a tournament judge.
- **Zero-state quality**: empty deck → three big CTAs (Import a list · Add my
  cards · Search real cards); empty /decks browse handled until inventory
  exists (featured/own decks fallback).
- **Consistency**: every pattern (tiles, likes, share, OG, modals, gating,
  revalidation) reuses the proven set/card implementations, so decks feel
  native on day one.
