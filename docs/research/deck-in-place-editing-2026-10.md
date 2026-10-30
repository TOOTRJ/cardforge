# Editing cards inside the deck: research, recommendation and plan (DK5.18)

2026-10-30. Research and mockups only: nothing here is built, and nothing is
ticked in `TODO.md`. The owner decides before any build. (DK5.18 is not yet
written into `TODO.md`. This document follows the task brief.)

Mockups (static HTML, open from disk, dark by default):
[`mockups/deck-editing/index.html`](mockups/deck-editing/index.html).

## TL;DR

**Recommendation: (b) an edit drawer.** It is a right-hand side panel that is
a real modal dialog: focus stays inside it, and the deck behind is inert but
**visible**, lightly dimmed, with the row being edited marked. At ≥ 1024 px it
is about 880 px wide at 1366, so the deck list keeps about 460 px. Below
1024 px the same dialog fills the screen.

It hosts the **existing** `CardCreatorForm` unchanged: the same steps, panels,
save actions, guard and payload. Only two things are new:

1. **A host seam.** On save, the form hands control back to the drawer
   instead of navigating with `router.push` / `replace`.
2. **The creator reads its container's width, not the window's.** It then
   draws its existing two-column arrangement inside the drawer, and its
   existing phone arrangement in the full-screen form.

Neither is a stepper redesign. **6.29 is untouched.**

The ranking is (b), then (a), then (c):

- **(a)**, a full-screen modal holding the creator, is the drawer's narrow
  form used at every width. It is the safe fallback: the same plumbing,
  minus the container work.
- **(c)**, a section that opens in place, is rejected. It moves what the
  maker was looking at, clashes with the deck's sticky bars and keys, works
  only in List view, and does nothing for the URL.

**Bulk edit:** add an "Edit fields…" button to the DK5.4 bulk bar. It opens a
two-step drawer: first **choose changes**, where mixed values are shown and
untouched fields are never sent; then **review** each card before → after;
then Apply, with Undo.

- **Fields in scope:** visibility, tags, rarity, the collector line and set
  code, the set icon, and the artist credit.
- **Frame and colours are out of scope.** They are locked on every saved
  card (owner decision 2026-09-16, `lib/creator/revise.ts`). Whether bulk may
  lift that lock is owner question Q5.

## 1. What exists today (the baseline)

**The deck page** (`app/(marketing)/deck/[slug]/page.tsx`, #671 / #681):

- Owner tools:
  - add box (DK5.2);
  - steppers, Move to, Remove with Undo, the selection's bulk bar (DK5.4,
    `deck-bulk-bar.tsx`);
  - the large preview pane from 1280 px (DK5.7, `deck-preview-pane.tsx`);
  - the card pop-up, a bottom sheet on touch (`deck-card-modal.tsx`).
- Every edit goes through ONE provider and write queue
  (`use-deck-editor.tsx`, `lib/decks/entry-queue.ts`) and is drawn at once
  (DK5.8).

**DK5.5 "Edit, then come back"** (`lib/decks/return-to.ts`): every entry's
Edit is `entryEditTarget`, which goes to one of three places:

| Entry | Goes to |
| --- | --- |
| The owner's own card | `/card/<slug>/edit?returnTo=` |
| Another creator's card (D3) | `/create?deckCard=&remix=` (a remix in the owner's account, taking the entry's place) |
| A printing or placeholder | `/create?deckCard=` ("Customize" / "Make your own version") |

- The creator follows `returnTo` only through `deckReturnPath` /
  `ownDeckReturnPath`.
- A `deckRemix` save calls `linkDeckCardAction`, then
  `router.replace(returnTo)`.
- An edit's save calls `router.push(returnTo)`.
- "Edit next" walks the unchanged imports through `#next-<id>`.

**The creator** (`components/creator/card-creator-form.tsx`, about 6,200
lines and about 140 imports, plus `panels/*` and the renderers):

- **Save model:** nothing auto-saves. `createCardAction` /
  `updateCardAction` run on Save. An edit sends only `pickRevisablePayload`.
  Payloads are pinned by `creator-face-tabs-payload.test.tsx`,
  `creator-frame-picker-groups-payload.test.tsx`,
  `creator-clear-fields-save.test.tsx` and others.
- **After a save** it navigates. `runSubmit` already has an
  `options.afterSave` seam (used by the leave dialog) that replaces the
  navigation.
- **Guard:** `useUnsavedChangesGuard` intercepts in-app link clicks
  (capture phase), Back (a sentinel history entry) and `beforeunload`, and
  shows "Keep editing / Leave without saving / Save changes" ("Save as draft"
  on a new card).
- **Layout:** follows the VIEWPORT.
  - 20 `lg:` and 19 `xl:` classes in `components/creator`, plus one JS query,
    `CREATOR_ASIDE_QUERY = (min-width: 64rem)`.
  - Sticky offsets assume the site header (`top-[4.25rem]`, `lg:top-24`).
  - `useCreatorScrollPadding` pads the page's scroll.
  - It reads `window.location.search` once (`?step=`).
- **Server data** is fetched by the page: game system, verified frame keys,
  frame-profile overrides, pip overrides, entitlements (`isPaid`, Pro),
  export stamp, decks, AI seeds, capacity, challenge, and the full card row
  (`getMyCardBySlug`). The deck page reads only `DECK_PAGE_CARD_COLUMNS`, so
  none of it is on the deck page today.
- **Revise lock:** an existing card's type, frame, variation, colour, finish
  and set cannot be changed (`REVISABLE_FIELDS`).
- **Revalidation:** `updateCardAction` revalidates the CARD's paths only, not
  the decks holding it. Today that is invisible, because the save navigates
  back to the deck, which renders fresh. In place, the deck rows would go
  stale (see §6).

## 2. How others do it (sources)

The web fetches were blocked by this session's network policy for several
hosts (archidekt.com, notion.com, linear.app). Facts marked *(search)* come
from search-result summaries of the page cited, not a full read. Anything
unverified is said so. Tags: *[help]* = the vendor's own docs or
announcements; *[forum]* = community; *[3p]* = third party.

### MTG deck builders

- **Moxfield.**
  - A card's printing can be switched to any printing, and tags set per
    card. Bulk work is mainly the **text "Bulk Edit"** mode
    *[3p mirror of Moxfield's wiki, search]*
    (<https://github-wiki-see.page/m/moxfield/moxfield-public/wiki/Features>).
  - Users report Bulk Edit resolving a name to the wrong card, and that an
    accidental mass removal there is poorly captured by history
    *[forum, search]* (<https://moxfield.nolt.io/1066>,
    <https://moxfield.nolt.io/995>).
  - Users also ask for a faster multi-card move between boards; the answer
    was copy/paste inside Bulk Edit *[forum]*
    (<https://moxfield.nolt.io/315>).
  - Its card popup and mobile editing: unverified.
- **Archidekt.**
  - **Multi-select** is Ctrl-click (desktop) or long-press (mobile). A
    multi-select bar appears at the bottom of the page as soon as one card
    is picked. Bulk actions planned: categories, foiling, quantity, colour
    tags *[help, search]* (<https://archidekt.com/news/2981306>,
    <https://archidekt.com/news/3962154>,
    <https://archidekt.com/news/20605672>).
  - The decklist text box moved to the Import menu. Users objected to
    removing text editing because it "would break a number of reasonable
    workflows" *[forum]*
    (<https://archidekt.com/forum/thread/3223199>).
- **TappedOut.**
  - Deck editing is an Edit button with a decklist **text box** *[help]*
    (<https://tappedout.net/help-desk/decks>).
  - Users call it "only text and dropdowns", needing several clicks per
    card, and asked for a visual editor *[forum]*
    (<https://tappedout.net/mtg-forum/tappedout/visual-spoiler-view-deck-editor>).

**Takeaway.** Deck builders edit ENTRY data (printing, quantity, board, tags)
in place, and do bulk work through text or a bottom selection bar. None hosts
a full card *designer*: PipGlyph's case is closer to design tools. The
selection-bar pattern PipGlyph already has (DK5.4) matches Archidekt and
Linear. Text-mode bulk edit is error-prone (Moxfield's reports), which argues
for a structured, previewed bulk edit.

### Design and productivity tools

- **Figma (inspector + multi-edit).**
  - The right-hand properties panel edits the current selection in place.
    Multi-edit (2024) applies one edit across many selected layers *[3p]*
    (<https://designcompass.org/en/2024/03/11/figma-multi-edit/>,
    <https://alternativeto.net/news/2024/3/figma-launches-multi-edit-for-editing-objects-across-multiple-frames-and-components>).
  - A property that differs across the selection shows **"Mixed"**, and
    typing a value sets it on all of them *[forum]*
    (<https://forum.figma.com/ask-the-community-7/is-it-possible-to-set-the-properties-of-components-differently-than-in-bulk-17494>).
    The plugin API has a `figma.mixed` sentinel for this *[help]*
    (<https://developers.figma.com/docs/plugins/api/properties/figma-mixed/>).
  - "Selection colors" lists a mixed selection's colours to adjust them
    *[help mirror]*
    (<https://figma-signup.helpjuice.com/color-gradients-and-images/view-and-adjust-colors-in-a-mixed-selection>).
  - A reported UI3 regression showed a mixed toggle as "all on" *[forum,
    search]*
    (<https://forum.figma.com/suggest-a-feature-11/properties-panel-selection-actions-quite-confusing-41667>).
    Lesson: a mixed state must look different from every real value.
- **Notion (peek).**
  - A database view opens items as **Side peek**, **Center peek** or **Full
    page** (••• → Layout). Side peek is the default for table, board, list
    and timeline, and edits the item while the database stays visible
    *[help, search]* (<https://www.notion.com/releases/2022-07-20>).
  - A peeked page has its own URL form *[3p]*
    (<https://matthewcassinelli.com/shortcuts/notion-pages/open-page-in-side-peek/>).
  - The query-parameter name and Back behaviour: unverified.
  - Takeaway: one item model, three presentations, chosen by context. The
    drawer below is "side peek" on desktop and "full page" on a phone.
- **Airtable.**
  - The **Batch update** extension applies actions to every record in a
    VIEW, so users make a temporary filtered view first *[help]*
    (<https://support.airtable.com/docs/batch-update-extension>; *[forum]*
    <https://community.airtable.com/base-design-9/bulk-editing-records-31349>).
  - Community answers say there is no native edit of a non-contiguous
    selection *[forum]*
    (<https://community.airtable.com/t/select-multiple-records-and-update/48030>).
  - The expanded record view is a modal over the grid *[forum/announcement]*
    (<https://community.airtable.com/announcements-6/improvements-to-expand-and-edit-records-1436>).
  - Airtable's mixed-value display or preview: unverified.
  - Takeaway: bulk tied to a view, not a selection, confuses people.
    PipGlyph's bulk works on the explicit selection.
- **Shopify (bulk editor).**
  - Tick products, **Bulk edit**, then a spreadsheet-like table with extra
    fields via a Columns button. Invalid values **block the save until
    fixed** *[help]*
    (<https://help.shopify.com/en/manual/shopify-admin/productivity-tools/bulk-editing>;
    columns *[3p]*
    <https://magecomp.com/blog/shopify-bulk-editor-for-multiple-products/>).
  - Takeaway: show every affected item and its new value before saving, and
    refuse per item with a reason. That is the review step below.
- **Linear (peek + bulk).**
  - **Peek** previews an issue with Space (hold to peek) *[help]*
    (<https://linear.app/docs/peek>,
    <https://linear.app/changelog/2019-09-23-improved-peek>).
  - Multi-select: X, Shift + ↑/↓, a hover checkbox.
  - With a selection, ⌘K or right-click applies a field to all, and a bar of
    common bulk actions sits at the bottom *[help]*
    (<https://linear.app/docs/select-issues>,
    <https://linear.app/changelog/issue-selection>).

### Standards

- **WAI-ARIA APG, modal dialog** *[help]*
  (<https://www.w3.org/WAI/ARIA/apg/patterns/dialogmodal/>):
  - content outside is inert;
  - `role="dialog"` + `aria-modal="true"` + a label;
  - focus moves in on open and is held by Tab;
  - Esc closes;
  - focus returns to the opener;
  - confirmations use `alertdialog`.
  - The APG has no pattern for a non-modal drawer, so a non-modal panel
    means designing focus by hand.
- **NN/g, "Modal & Nonmodal Dialogs"** *[3p, reputable]*
  (<https://nngroup.com/articles/modal-nonmodal-dialog/>): modals pull users
  away from their task; nonmodal dialogs leave the main content usable.
- **Material Design, side and bottom sheets** *[help]*
  (<https://material.io/components/sheets-side>,
  <https://material.io/components/sheets-bottom>):
  - a *standard* side sheet sits beside the content;
  - a *modal* one (used on mobile) must be dismissed first;
  - a modal side sheet on mobile can become standard on larger screens.
- **Apple:** an inspector shows the selection's details, and SwiftUI's
  `.inspector` becomes a sheet at compact width *[3p]*
  (<https://nilcoalescing.com/blog/InspectorInSwiftUI>,
  <https://unpkg.com/apple-hig-mcp@1.1.3/content/platforms/macos/panels.md>).

**Pattern across them.** A panel beside the collection on wide screens and a
full-screen sheet on phones, opened from the item, URL-addressable, with
mixed values said plainly and bulk changes previewed.

## 3. The three options, judged

Scores: ● good, ◐ workable with care, ○ poor.

| Criterion | (a) Full-screen modal | (b) Drawer (recommended) | (c) Section in place |
| --- | --- | --- | --- |
| Context kept | ◐ deck hidden behind; you return to the same scroll and focus | ● deck visible, row marked, Prev / Next in the header | ◐ deck visible, but everything below jumps by the creator's height |
| Live deck preview beside it | ○ | ● the creator's own preview inside; the deck's tile updates after save | ○ two previews of two cards (the pane follows the pointer) |
| Mobile (390) | ● full-screen sheet = the creator's phone arrangement | ● the same (below 1024 px it IS (a)) | ○ a full page in all but name, inside a long list |
| Focus and accessibility | ● APG modal, Radix Dialog, focus returned to `data-deck-entry` | ● the same: modal, deck inert | ○ non-modal: the deck's `/` and + − M S keys stay live; no APG pattern; two sticky bars obscure focus (3b.28's issue again) |
| Unsaved-change guard | ● close / Esc / Back / scrim go through the existing guard dialog | ● the same, plus Prev / Next and picking another row | ◐ any click anywhere in the deck must be guarded |
| URL / Back | ● `?edit=<entry>` pushed; Back closes; a reload reopens | ● the same | ○ usually no URL; Back leaves the deck |
| Performance | ● creator chunk loaded on first Edit (prefetched on intent) | ● the same | ● the same |
| Exact save paths, pinned payloads | ● same form, same actions; only post-save navigation changes | ● the same | ● the same |
| Creator change needed | ● host seam only | ◐ host seam + container-width layout (§5, PR 2) | ○ host seam + container width + sticky and scroll rework |
| Works in Stacks / Grid / Table | ● | ● | ○ only List has a row to open under |

**Why (b) over (a).** The owner asked to keep context. The drawer keeps the
deck readable beside the editor (names, counts, badges, the marked row), and
the walk through cards ("Save & next", ‹ ›) is felt. It costs one more PR
than (a) (PR 2). That PR is mechanical, and /create must stay byte-identical,
held by a test. Because (b) below 1024 px *is* (a), building (a) first loses
nothing.

**Why not non-modal (b).** A Notion-style side peek leaves the deck
interactive. Here that would need:

- a hand-made focus model (no APG pattern);
- guarding every deck click against unsaved changes;
- silencing the deck's own keys while the maker types.

A modal drawer gets most of the context (visible, not clickable) for none of
that cost. Clicking a deck row while the drawer is open isn't possible;
‹ › and "Save & next" cover the walk. Owner question Q2.

## 4. Recommended design

See `recommended-1366.html` and `recommended-390.html`.

**Opening it**

- **From:**
  - every entry's Edit / Customize / Remix / "Make your own version" (the
    same `entryEditTarget` decision, now opening the drawer instead of
    navigating);
  - the preview pane's Edit;
  - the pop-up / bottom sheet's Edit;
  - "Edit next" in the summary bar;
  - a new **"＋ Create new card"** next to the add box. It creates a card
    with the deck pre-picked: the creator's existing deck box sends
    `deck_id`, which is today's payload.
- **Width:** `min(64rem, 100vw − 480px)` from 1024 px up, docked right,
  rounded on its left edge, scrim at about 38 %. Below 1024 px it is full
  screen with a "‹ Deck name" header.

**Header**

- ‹ › to walk within the current group / sort.
- An eyebrow such as "Editing · 3 of 14 in Creatures" or "Your version of a
  real card".
- The title and the entry's status badge (`DeckEntryStatusBadge`).
- **"Open full page ↗"**: today's DK5.5 URL, as the escape hatch.
- Close.

**Body:** the creator, untouched.

- Revise mode locks what it locks today.
- Face tabs, part tabs, the AI fill, the leave dialog: all as on /create.
- Inside the drawer the creator draws its two-column arrangement (form +
  live preview). Full screen, it draws its phone arrangement (steps, folding
  "Live preview", sticky Save bar). These are today's arrangements, chosen by
  the container instead of the window.

**After a save**

- **An edit:**
  - the drawer stays open on the saved card;
  - the toast says "Changes saved.";
  - the deck's row picks up the new title, badge and (live-preview) picture.
- **A deck remix:** `linkDeckCardAction` as today, then the row turns into
  the new card.
- **"Save & next":** saves, then loads the next unchanged import (today's
  "Edit next" walk).

**Closing it**

- ✕, Esc, the scrim or Back. With changes, the creator's own guard dialog
  ("Keep editing / Leave without saving / Save changes").
- The focus returns to the row that opened it (the `data-deck-entry`
  hand-back the pop-up already does).

**URL:** `?edit=<entryId>` (or `?edit=new`) is pushed on open, so:

- Back closes the drawer;
- a reload or a shared link reopens it, for the owner only (a visitor's
  page ignores it);
- the page itself stays one URL (DK5.1).

## 5. Engineering notes (how it stays the same creator)

1. **Host seam, not a fork.** `CardCreatorForm` gains one optional prop,
   e.g.:

   ```ts
   host?: {
     onSaved(r: { cardId; slug; linked?: boolean });
     onRequestClose();
     next?: () => void;
   }
   ```

   - With a host, `runSubmit` calls `host.onSaved` where it would navigate.
     The `afterSave` seam already proves the shape.
   - `guard` stops pushing its Back sentinel and capturing link clicks; the
     drawer owns Back through `?edit=`. It still answers "may I close?" and
     shows its dialog.
   - **Nothing in the payload builders changes.** The pinned payload tests
     must pass untouched. A NEW test renders the same scenarios through the
     host and compares against the same fixtures byte for byte.
2. **Container width (drawer only).**
   - The creator's 39 `lg:` / `xl:` classes and `CREATOR_ASIDE_QUERY` become
     container queries on a creator-root `@container`.
   - On /create and /card/…/edit the container is the page, and its
     breakpoints are re-tuned so the arrangement switches at the same window
     widths as today.
   - A unit test pins the class list / computed arrangement at 375, 1024,
     1280 and 1440 against main.
   - Sticky offsets and `useCreatorScrollPadding` take their scroll
     container from the host (the drawer's body) instead of `window`.
   - `?step=` is read from the host's state instead of `location.search`.
   - **This is the only change inside the creator beyond the host seam.** It
     redesigns nothing, so 6.29 stays the owner's. Owner question Q1.
3. **Lazy loading.**
   - The drawer and the creator are a `next/dynamic` chunk. It is **not**
     part of the deck page's first load: visitors never fetch it.
   - It is prefetched on intent (pointer rest or focus on any Edit, as
     `HOVER_REST_MS`), so the first open is near-instant.
   - Owner rule from #681: a lazy part's controls are dead until its chunk
     hydrates. The drawer has none on screen at load, which is fine. Edit
     buttons stay eager and show a skeleton drawer while the chunk loads.
   - Under vitest, `tests/stubs/next-dynamic.tsx` (`dynamicReady()`).
4. **Server context on open.**
   - One owner-only GET route returns everything the edit / create pages
     pass today: the full card row by id, verified keys, profile overrides,
     pips, entitlements, export stamp, capacity, challenge, decks and AI
     seeds.
   - It is a route, not an action: cancellable, never queued behind the deck
     editor's writes (as `add-search`).
   - Page-wide parts are cached for the page session; the card row is
     re-read each open.
   - Auth is the same as the edit page: the owner's card only. Another
     creator's card is read through the remix rules (RLS), never widened.
5. **The deck after a save.**
   - The drawer asks for one revalidation of the deck page. The options are
     a `revalidateDeckEntryChange` call keyed by the deck, or teaching
     `updateCardAction` an optional `deckSlug` to revalidate.
   - The page then brings back its rows, as the DK5.8 writes do. Never a
     `router.refresh()` per keystroke; at most one per save.
   - Until the bake lands, the row draws the live preview of the saved row
     (`REBAKE_PENDING_RENDER`, today's rule).
6. **Keys and the deck editor.** While the drawer is open the deck is
   `inert`, so `/` and + − M S cannot fire. The deck's write queue may still
   be finishing a write: the drawer's save never waits on it, and they touch
   different tables.

## 6. Risks

- **The creator's size.** It has about 140 imports and the renderer. The
  first open on a slow phone could take seconds. Mitigations: prefetch on
  intent, a skeleton, and measuring chunk size in PR 1 (owner sets a budget).
- **Layout drift on /create** from the container change. Mitigation: the
  pinned arrangement test, a parity check of /create screenshots at four
  widths, and PR 2 shipped on its own.
- **Guard semantics.** Two history owners (the guard's sentinel and
  `?edit=`) would double Back presses (3b.7's bug). With a host, the guard
  must not push. One test: Back closes the drawer in ONE press, and asks
  first when dirty.
- **Stale deck rows** (`updateCardAction` revalidates only card paths; §1).
  Must be in PR 1, or a renamed card keeps its old name in the list.
- **Next 16.2's router queue** (CLAUDE.md, `import-decklist-dialog.tsx`): an
  action dispatched during a navigation the component made itself can be
  lost. Pushing `?edit=` IS such a navigation. Use `history.pushState`
  (shallow) or wrap it in a transition that the save button waits on.
- **Focus.** The drawer opens on the first field of the current step (or the
  title). On close, the focus goes back to the opener, or to the row that
  replaced it (a remix replaces the entry's card).
- **Remix into a deck while another tab edits it.** The link action already
  handles a gone entry (`stale`). The drawer then says so and closes.
- **Bulk:** see §7's last list.

## 7. Bulk edit

See `bulk-edit.html`.

**Entry:** an **"Edit fields…"** button in the existing bulk bar (DK5.4). It
opens a drawer of the same shape as §4.

**Who is editable:** only the owner's own PipGlyph cards in the selection.
The header names what is left alone and why:

- a real card (no card yet: "customize it first");
- another creator's card (D3: it is theirs; a remix is one card at a time);
- a gone card.

**Fields**

Rows only (no re-bake):

| Field | In bulk? | Notes |
| --- | --- | --- |
| Visibility | **Yes** | `updateCardsVisibilityAction` already exists (My Cards). The strong-language rule keeps a card private, says why per card, and reports `skippedLanguage`. |
| Tags | **Yes, add / remove** | Never "replace": a tag only some cards carry stays unless removed. Shown as chips with "2 of 3". Needs a new action (no bulk tag write exists). |

On the card (re-baked):

| Field | In bulk? | Notes |
| --- | --- | --- |
| Rarity | **Yes** | Revisable. Tokens and emblems have none (`kindHidesRarity`): skipped and named. |
| Collector line | **Yes** | Style (`frame_style.collector` 2015 / 2023 / off, ★) only where the frame declares the collector line; `set_code`, `lang`. **Not** the collector number (per card). "Number them in deck order" is a separate idea (Q6). |
| Set icon | **Yes** | `set_icon_url` / `set_icon_code`, a natural "my set" move. |
| Artist credit | **Yes** | Revisable. |
| Footer text / watermark | Later | Paid perk. Same mechanics; leave for a follow-up. |
| Frame anatomy switches (crown, text alignment, white border, stamp) | Later | Each is per frame (declared per profile). The review step would skip most cards. Worth it only with demand. |
| **Frame, colours, card type** | **No (locked)** | Locked on any saved card by the owner (2026-09-16). Bulk shows them read-only with that reason. Lifting it is Q5, and it would also have to pass the frame gates (verified combos, kind gate, DFC gate) per card. |

**Mixed values.** A field whose cards disagree:

- shows **no chip pressed, dashed outlines**, and a plain count ("Mixed: 2
  public, 1 private");
- a text input shows a "Mixed — type to set it on all 3" placeholder.

That is Figma's "Mixed", said in words, and visibly different from every
real value (the UI3 lesson). A mixed single-select row is a radiogroup with
none checked (whether `ChipGroup` takes "no value" today is to be checked
in PR 4). **A field left mixed is not in the
patch**: the rule that an edit never changes an untouched field, applied to
many cards.

**Preview before apply.** Step 2 lists every card with its changes ("Rarity:
Uncommon → Rare · re-bake") and, where the picture changes, a before → after
pair drawn by the live renderer (`cardToPreviewData` with the patch, at
thumbnail size, at most the visible rows rendered). Cards the server would
treat differently say so before anything is sent:

- strong language → kept private;
- a token → no rarity;
- no collector line on this frame.

**Apply** is one request: `updateCardsFieldsAction(ids, patch)`.

- At most `MAX_MEMBERSHIP_BATCH` cards per call.
- Each card goes through the **same** per-card path as `updateCardAction`:
  the revise filter, `withPrintTypographyUpdate`, the strong-language rule
  and its purge, and the gates.
- A result per card, ONE revalidation, deferred bakes (the auto-rebake lease
  is not touched; these are save bakes).

**Undo:** the toast's Undo sends the inverse patch, built from the values the
review step read. It applies only to cards still holding the new value.

**Risks specific to bulk**

- **Re-bake load.** 50 cards × a bake each. Use the existing deferred-bake
  path and say "new pictures bake in the background". Consider a cap per
  minute (the upload rate limit is the precedent).
- **Undo across a re-bake.** It is a second edit, and so a second bake. It
  is acceptable, but say so.
- **A shared card.** A card used in several decks changes everywhere. The
  review step says "also in 2 other decks" where `public_deck_card_pairs`
  (or the owner's own decks) knows it.

## 8. Build plan (PR-sized; nothing starts before the owner answers §9)

1. **PR 1: host seam + full-screen editor (option (a) shape).**
   - Code: the `host` prop; the guard in host mode; the context route; the
     lazy drawer at full screen at every width; `?edit=`; the deck
     revalidation after save; Edit / Customize / Remix open it, and "Open
     full page" keeps DK5.5.
   - Tests: payload parity through the host (the existing fixtures);
     guard + Back in one press; focus return; a visitor's `?edit=` ignored.
   - Behind a flag, `deck_inline_editor`, admins first.
2. **PR 2: container-width creator + the docked drawer from 1024 px.**
   - Container queries; the pinned arrangement test; /create byte-identical
     (screenshots at 375, 1024, 1280, 1440).
   - No behaviour change elsewhere.
3. **PR 3: walk and create.**
   - ‹ › and "Save & next" (replaces "Edit next" navigation; the summary
     bar's button opens the drawer).
   - "＋ Create new card" with the deck pre-picked.
   - Prefetch on intent.
4. **PR 4: bulk, rows only.** "Edit fields…", visibility + tags (new tag
   action), mixed states, review, Undo.
5. **PR 5: bulk, re-baked fields.** Rarity, collector line / set code /
   language, set icon, artist credit; before → after previews; deferred
   bakes.
6. **PR 6: remove the flag; e2e.** `decks.spec.ts`: edit in place, save,
   row updated, Back closes, phone path.

## 9. Questions for the owner

- **Q1.** PR 2 makes the creator follow its container's width (the same
  arrangements; /create unchanged and pinned). Is that within "host the
  existing editor", or does it touch 6.29? If it touches 6.29, ship option
  (a) only: PR 1 + 3 + 4 + 5.
- **Q2.** A **modal** drawer (deck visible but not clickable; ‹ › to walk),
  or a non-modal side peek (click another row directly; more a11y work)?
  Recommended: modal.
- **Q3.** After a save, stay in the drawer (recommended), or close and return
  focus to the row (today's DK5.5 feel)?
- **Q4.** Keep "Open full page ↗" in the drawer permanently, or only while
  the flag is on?
- **Q5.** Bulk **frame / colour** changes are blocked by the 2026-09-16 lock.
  Keep them out (recommended), or allow a gated bulk frame change?
- **Q6.** Bulk **collector numbers**: "number them in deck order" (1/60 …)?
  Not in the plan unless asked.
- **Q7.** Bulk scope beyond own cards: should "Customize all" (make your
  version of N real cards) exist? It creates N cards against the capacity
  cap. Not in the plan.

## Files

- [`mockups/deck-editing/index.html`](mockups/deck-editing/index.html): the
  list.
- [`mockups/deck-editing/recommended-1366.html`](mockups/deck-editing/recommended-1366.html):
  the drawer at 1366, clickable (edit, guard, save, ‹ ›, create).
- [`mockups/deck-editing/recommended-390.html`](mockups/deck-editing/recommended-390.html):
  the same at 390 (full screen; four states).
- [`mockups/deck-editing/bulk-edit.html`](mockups/deck-editing/bulk-edit.html):
  bulk: choose changes, mixed, review, apply, Undo.
- [`mockups/deck-editing/rejected-inline-section.html`](mockups/deck-editing/rejected-inline-section.html):
  option (c), for comparison.
- `mockups/deck-editing/mock.css`: tokens copied from `app/globals.css`.

Placeholder cards are grey boxes. Their "art" is the repo's own generated
deck covers (`public/defaults/deck-covers`, DK6.1: deterministic SVG). No
Wizards of the Coast art is used.
