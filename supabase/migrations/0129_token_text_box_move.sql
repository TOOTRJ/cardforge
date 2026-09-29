-- 0129 — stored cards with text move from the textless token frames to the
-- text-box token frames (TODO 4.49 (b); owner decision 5, 2026-09-29).
--
-- `m15tokentext` / `m15tokenartifacttext` (#414) are the 2014–19 arch with a
-- real text box, as the prints set a token's rules and flavour text (TDOM #2
-- Knight, TXLN #7 Treasure). The textless frames (`m15token`,
-- `m15tokenartifact`) set any text white on a dark scrim over the art, which
-- no printed token does, and long text clips there at the 42 px floor. All
-- 28 combos (the four templates × w u b r g c m) were verified on production
-- at layout v34 on 2026-09-29, so every moved card lands on a verified frame
-- in its own colour. From this release the creator, the import and the AI
-- jobs put a token with text on the text-box frame by themselves (the text
-- box follows the text until the user picks one by hand); this moves the
-- cards saved before it:
--   * m15token          → m15tokentext;
--   * m15tokenartifact  → m15tokenartifacttext (the Artifact dress stays).
-- Only frame_style's `template` key changes (jsonb_set): `finish` and any
-- other key are kept.
--
-- "Has text" is what the renderers draw in the rules box (hasRulesBoxText,
-- lib/cards/card-display.ts — both renderers and the creator read it):
--   * rules_text OR flavor_text — a flavour-only token prints its flavour in
--     the box too (Stalbokoblin, 73dc31b0), so it moves;
--   * blank = no text: a column that holds nothing but the characters
--     String.prototype.trim removes (JS WhiteSpace + LineTerminator — the
--     tab, LF, VT, FF, CR, every Zs space incl. U+00A0 / U+3000, U+2028 /
--     U+2029, U+FEFF) is not text; any other character is. The bracket
--     expression below lists exactly that set (Postgres ARE \uXXXX escapes,
--     no locale class), and tests/unit/db/token-text-box-move-migration.test.ts
--     holds it to the JS engine's own trim over every code point. (btrim()
--     alone strips spaces only; \s depends on the locale.)
--   * face_content is NOT text here: the token frames draw no loyalty rows
--     or saga rail, so loyalty abilities / chapters never print on them.
--   * the FRONT face only: the stored bake is the front, and a legacy
--     back_face shares the front's frame. (0 public cards on these frames
--     have a back face.)
--   * never a card typed `land`: the renderers print NO rules text for a
--     basic land (basicLandManaKey — its big symbol instead), so a land row
--     here would trade the scrim-less art for an empty text box, and the
--     basic-land rule is not re-derived in SQL. Every other card type can't
--     be a basic land, so for it "has text" is exactly the renderers' test.
--     A land left on a textless token frame keeps what it prints today (the
--     scrim's fallback below for a nonbasic's text). 0 public rows.
--   * never an admin's FRAME PREVIEW (cards.frame_preview, 0121): it is the
--     evidence for the combo it was saved on, listed under that template in
--     /admin/frame-compare, so it stays on it — the creator's walk-through
--     and its edits pin the frame the same way. Always private (0 public
--     rows); the owner's count names them.
-- A card with no text stays on the textless frame, which prints none.
--
-- Production, 2026-09-29 (anonymous REST, public rows only — RLS hides the
-- private ones; read after the v34 re-bake, all stamped 34): 33 public cards
-- on the token frames, all on m15token, all card_type 'token', and all 33
-- have text (30 rules + flavour, 2 rules only, 1 flavour only), so all 33
-- move to m15tokentext; 0 on m15tokenartifact. The owner counts the private
-- rows before the merge (the read-only queries in the PR, by visibility and
-- template; the same WHERE as below).
--
-- The textless frames keep their scrim, as a FALLBACK: after this, no stored
-- card on them has text but a land's or a frame preview's (the public ones,
-- and every private one this WHERE matches), and new ones get text only by a
-- hand-picked variation (the creator's choice sticks, owner decision 5), a
-- frame preview or an older client's save — the text then stays readable on
-- the scrim instead of being lost or set straight on the art. No renderer
-- changes in this release, so no CARD_LAYOUT_VERSION bump: a moved card's
-- bake changes because its frame does, which the null stamp below covers.
--
-- The same statement sets layout_version = NULL on exactly these rows (the
-- 0117 / 0128 pattern). A null stamp owes a platform re-bake that the
-- automatic re-bake (0120) picks up (it scans `layout_version is null`), and
-- never shows the owner a badge (hasNewerLook is false for a null stamp; the
-- render_update cron only scans layout_version < CARD_LAYOUT_VERSION). The
-- text-box templates shipped in #414 and are live, so the order of this
-- migration and the Vercel deploy doesn't matter: an old deployment's cron
-- bakes the moved cards exactly as the new one does. The stored render is
-- kept (the gallery shows it until the re-bake; a download renders live
-- meanwhile, hasPendingCorrection), and the render columns are not touched.
-- It is an edit of the frame, so the cards' updated_at moves (the 0108
-- trigger ignores only the render columns).
--
-- Triggers on the update: cards_set_updated_at (set_cards_updated_at, 0108)
-- bumps updated_at; cards_search_vector_refresh (0086) doesn't fire (no text
-- column changes); cards_remix_notify (0032) returns early (visibility
-- doesn't change); cards_guard_render_columns (0126), cards_guard_media_columns
-- and cards_guard_back_card (0127) only judge the API roles (anon,
-- authenticated) and a migration runs as the table owner; cards_guard_frame_preview
-- (0121) fires only on frame_preview. No insert-only trigger (the capacity
-- check, 0104) fires. RLS doesn't apply.
--
-- Idempotent: a moved row is on a text-box frame, so a second run matches
-- nothing (and nulls no stamp).
--
-- Grants: none. This migration only updates rows of public.cards. It creates
-- no table or function and changes no grant, so the API roles keep exactly
-- the privileges they have on public.cards (0097).
--
-- Ships through a PR; never applied ad-hoc.

update public.cards
set
  frame_style = jsonb_set(
    frame_style,
    '{template}',
    to_jsonb(
      case frame_style ->> 'template'
        when 'm15token' then 'm15tokentext'
        when 'm15tokenartifact' then 'm15tokenartifacttext'
      end
    )
  ),
  layout_version = null
where frame_style ->> 'template' in ('m15token', 'm15tokenartifact')
  and card_type is distinct from 'land'
  and not frame_preview
  and (coalesce(rules_text, '') || coalesce(flavor_text, ''))
    ~ '[^\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';
