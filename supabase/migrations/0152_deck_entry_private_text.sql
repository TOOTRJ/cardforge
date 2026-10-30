-- 0152_deck_entry_private_text.sql — a private card's text never leaves its
-- deck entry (privacy fix, owner-approved 2026-10-29; follows 0151 /
-- TODO DK0.11: what the API hands out about a deck matches its page).
--
-- THE LEAK. A deck entry keeps its own copy of a card's text (0055:
-- name, type_line, mana_cost, mana_value, color_identity, rarity — and the
-- printing columns set_code, collector_number, image_url). An entry with
-- NO printing that links a card holds THAT card's text: the creator's "add
-- to deck" writes its title (add_custom_deck_entry), older writers and the
-- seeds its type line and cost too. The deck PAGE draws such an entry as a
-- "Private card" for a visitor when its card is one they can't see
-- (lib/decks/private-card-name.ts, D11), but the entries' read rule (0055,
-- 0151) handed every row of a readable deck to anyone: anon
-- `GET /deck_cards?deck_id=eq.<public deck>` read "Vael, Gloomforge
-- Tinker", "Legendary Creature — Dwarf Artificer", "{2}{R}" of a private
-- card — and the title of a card FORCED private for its strong language
-- (owner policy 2026-10-28), which 0151's guide redaction exists to hide.
--
-- WHICH ENTRIES. A card the deck SHOWS a visitor is a public card, or the
-- deck owner's own unlisted one (the cards' RLS + canLinkIntoDeck, read by
-- listDeckCards — 0151's guide redaction asks the same): deck_shows_card()
-- below. An entry is HIDDEN from a visitor (deck_entry_hidden(), the ONE
-- rule the policy and the page's read share) when it has no printing
-- behind it (an entry with a printing holds the REAL card's name, which the
-- page shows beside "Private card" by design) AND
--   * it links a card the deck does not show them, or
--   * its card is GONE: no card left (0055's ON DELETE SET NULL) and its
--     source says the entry came WITH a card ('creator', 'link',
--     'ai_generate', 'ai_remix' — lib/decks/entry-status.ts bringsCard, the
--     "No longer available" case of deckEntryUnavailable). Its name is the
--     deleted card's title — a private one's, a strong-language one's —
--     and deleting a card must never publish it.
-- The deck's OWNER is never a visitor: they keep the stored name ("No
-- longer available"). An owner's own UNLINK of such an entry clears its
-- source (unlinkDeckCardAction: "a plain name, never No longer available")
-- — the owner keeps the name in their deck as a plain line, so a visitor
-- reads it as one, as they read any name the owner typed. (An entry written
-- before 0144 has no source, so a card deleted from under it reads as a
-- plain name too — the deck can't tell it from a pasted one.)
--
-- THE FIX: read-time, nothing stored changes.
--   1. The entries' read policy: the deck's owner reads every row of their
--      deck (as before); anyone else who may read the deck (0151's decks
--      policy — the unlisted-deck link header included) reads every row
--      but a hidden one (EVERY older select policy on the table is dropped
--      first, by catalogue, not by name). A direct API read (anon or another signed-in user,
--      a list, an embed under decks or cards) can no longer reach a hidden
--      entry's text.
--   2. deck_entries_for_viewer(deck) — the deck page's read of the rows
--      (lib/decks/queries.ts readDeckItems: the page, its copied decklist,
--      the owner's exports and the AI's deck context). The owner gets their
--      rows exactly as stored; anyone else who may open the deck (public,
--      unlisted — its id is its link, as 0151's deck_guide_for_viewer — or
--      their own) gets every row, a hidden one MASKED: its name
--      "Private card" (PRIVATE_CARD_NAME), and every value it holds from the
--      card cleared — type line, cost, mana value, colours, rarity and the
--      printing columns (none on such a row). What stays is the entry
--      itself: id, deck, board, quantity, position, the linked card's id (a
--      private card's tile needs it), source, stamps and the owner's cover
--      rank. So the visitor's list keeps its "Private card" rows and the
--      deck's counts; the card is counted, never named.
--
-- WHY READ-TIME AND NOT A SCRUB (the design first proposed: blank the text
-- in deck_cards while the card is hidden, restore it from the card when it
-- is shown again). The rows' text is read by the OWNER in places a scrub
-- would change, and the card can't give it back:
--   * D3 (0144): an entry linking ANOTHER creator's card that is no longer
--     public shows its OWNER the entry's stored name with "No longer
--     available" — they can't read that card, so a scrub would erase the
--     owner's own label, and a restore could never put back the name;
--   * the import merges a line into an entry with no printing by its stored
--     name (0143/0144 import_deck_entries), and the owner's format check
--     counts copies by it (validateDeck): scrubbed names would stop the
--     merge and make every private card a copy of one "Private card";
--   * an entry's stored values are the authority for an unchanged import
--     (lib/decks/effective-entry.ts printingIsAuthority) — restored from the
--     card they would not be the same values (a land's colours, a split
--     card's cost), and "restore from the card" can't know a pasted name
--     the owner linked a card onto;
--   * 0151's guide redaction looks up the entry's own copy of a hidden
--     card's name (the title the guide was written with);
--   * every scrub or restore would be an UPDATE of deck_cards: 0143's
--     statement trigger would touch the deck's updated_at (its "recent"
--     sort, the share image's cache-buster) whenever a card's visibility
--     changes, and the owner's own RETURNING reads would hand back blanks.
--   Read-time masking changes no row: privatising, publishing, a
--   moderation hide or a forced-private save takes effect on the next read,
--   the owner's view is byte for byte what it was, and "Edited" (which
--   reads ids, the source and the card — lib/decks/entry-status.ts) and the
--   stored counts (0143) cannot move.
--
-- What a VISITOR sees differently: a hidden entry's cost, mana value,
-- colours and rarity are gone (its name and type line already were, on the
-- page). The add path writes a name alone, so production rows mostly held
-- none of those; where one did (an older writer, the seeds), a visitor's
-- breakdown counts the card without them. A GONE card's entry (above) was
-- a plain name to visitors; it is "Private card" now. The deck's default
-- cover no longer takes a hidden entry's colours from the entry, for ANY
-- viewer, the owner included (lib/decks/cover.ts: the same rule, so the
-- default is one picture for everyone — it already counted a private CARD
-- for nobody). Otherwise the owner sees what they saw.
-- One count moves in an edge case: list_public_creators (0149) counts a
-- creator's public decks by `exists (an entry)` as the caller reads it — a
-- public deck whose EVERY entry is hidden no longer counts there (the stored
-- card_count, which the deck lists, hubs and sitemap read, is untouched).
--
-- Unchanged: the write policies (owners only), 0143's counts and guards,
-- 0144's link guard, 0149's notifications and public pairs (definer, or
-- only ever about public cards), 0150's picks, 0151's guide function (a
-- definer: it reads the stored text to redact it) and the deck_cards
-- grants (0097).
--
-- Grants: deck_shows_card() and deck_entry_hidden() are every API role's
-- (the policy runs them for anon too; pure functions of their arguments,
-- they read nothing).
-- deck_entries_for_viewer() is anon's, authenticated's and the service
-- role's (PUBLIC revoked). No table grant changes.
--
-- Deploy: either order is safe. The app before it reads the table: on this
-- migration its visitors' deck pages lose the hidden rows for the minutes
-- until the new deployment is live (fewer rows, nothing wrong is shown, no
-- error). The app after it reads the function, and the table where the
-- function is missing (a database this migration hasn't reached) — as
-- before.
--
-- Ships through a PR; never applied ad-hoc. Idempotent. Composes with 0151
-- (its decks policy decides who may read a deck at all; its deck_cards read
-- policy — every SELECT policy on the table, whatever its name — is
-- replaced here) and applies on a database without it.

-- ===========================================================================
-- The one rule: may a deck show this card to someone who isn't its owner?
-- ===========================================================================

create or replace function public.deck_shows_card(
  p_card_visibility text,
  p_card_owner uuid,
  p_deck_owner uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- A public card, or the deck owner's own unlisted one (the cards' RLS +
  -- canLinkIntoDeck: another creator's card only while it is public).
  select coalesce(
    p_card_visibility = 'public'
      or (p_card_visibility = 'unlisted' and p_card_owner = p_deck_owner),
    false
  );
$$;

comment on function public.deck_shows_card(text, uuid, uuid) is
  'Whether a deck shows a card to anyone but the deck''s owner: a public card, or the deck owner''s own unlisted one (lib/decks/entry-status.ts canLinkIntoDeck + the cards'' RLS). 0152.';

-- An entry is hidden from anyone but its deck's owner: no printing behind
-- it, and a linked card the deck doesn't show (a card the caller can't read
-- comes in as a NULL visibility: hidden), or no card left of one it brought
-- (its source — lib/decks/entry-status.ts bringsCard).
create or replace function public.deck_entry_hidden(
  p_card_id uuid,
  p_scryfall_id text,
  p_source text,
  p_card_visibility text,
  p_card_owner uuid,
  p_deck_owner uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_scryfall_id is null
     and case
           when p_card_id is not null
             then not public.deck_shows_card(p_card_visibility, p_card_owner, p_deck_owner)
           else coalesce(p_source in ('creator', 'link', 'ai_generate', 'ai_remix'), false)
         end;
$$;

comment on function public.deck_entry_hidden(uuid, text, text, text, uuid, uuid) is
  'Whether a deck entry is hidden from anyone but its deck''s owner (0152): no printing, and a linked card the deck does not show, or no card left of one the entry brought (its source). The deck_cards read policy and deck_entries_for_viewer share it.';

-- ===========================================================================
-- 1. The entries' read: a hidden entry is its deck owner's alone
-- ===========================================================================

-- EVERY select policy on the table, whatever its name (0055's, 0151's, this
-- migration's on a re-run, one a later rename left behind): permissive
-- policies are OR'd, so one left beside this would hand the rows back.
do $drop$
declare
  v_name name;
begin
  for v_name in
    select p.polname
    from pg_policy p
    where p.polrelid = 'public.deck_cards'::regclass
      and p.polcmd = 'r'
  loop
    execute format('drop policy %I on public.deck_cards', v_name);
  end loop;
end
$drop$;

create policy "Deck cards: the owner's, and a visitor's where the card shows"
  on public.deck_cards
  for select
  using (
    -- The deck under the CALLER's rules (0151's decks policy: public, the
    -- owner's, an unlisted deck by its link header).
    exists (
      select 1
      from public.decks d
      where d.id = deck_cards.deck_id
        and (
          d.owner_id = (select auth.uid())
          -- Not hidden. The card is read under the caller's RLS: one they
          -- can't read comes in as NULL — not shown.
          or deck_cards.scryfall_id is not null
          or not public.deck_entry_hidden(
            deck_cards.card_id,
            deck_cards.scryfall_id,
            deck_cards.source,
            (select c.visibility from public.cards c where c.id = deck_cards.card_id),
            (select c.owner_id from public.cards c where c.id = deck_cards.card_id),
            d.owner_id
          )
        )
    )
  );

-- ===========================================================================
-- 2. The deck page's read: every row, a hidden one masked
-- ===========================================================================

create or replace function public.deck_entries_for_viewer(p_deck_id uuid)
returns setof public.deck_cards
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_is_owner boolean;
  v_row record;
  v_entry public.deck_cards;
begin
  -- A deck the caller may open: public, unlisted (its id is its link —
  -- 0151's deck_guide_for_viewer) or their own. Anything else: no rows.
  select d.owner_id into v_owner
  from public.decks d
  where d.id = p_deck_id
    and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid());
  if not found then
    return;
  end if;
  v_is_owner := coalesce(v_owner = auth.uid(), false);

  for v_row in
    select e as entry,
           public.deck_entry_hidden(e.card_id, e.scryfall_id, e.source, c.visibility, c.owner_id, v_owner) as hidden
    from public.deck_cards e
    left join public.cards c on c.id = e.card_id
    where e.deck_id = p_deck_id
  loop
    v_entry := v_row.entry;
    if v_row.hidden and not v_is_owner then
      -- Every value the row holds FROM the card (0055's columns). A column
      -- added to deck_cards later that copies a card's text is added here.
      v_entry.name := 'Private card';
      v_entry.type_line := null;
      v_entry.mana_cost := null;
      v_entry.mana_value := null;
      v_entry.color_identity := '{}'::text[];
      v_entry.rarity := null;
      v_entry.set_code := null;
      v_entry.collector_number := null;
      v_entry.image_url := null;
    end if;
    return next v_entry;
  end loop;
  return;
end;
$$;

comment on function public.deck_entries_for_viewer(uuid) is
  'A deck''s entries as its page shows them to the caller (0152): the owner''s rows as stored; for anyone else who may open the deck (public, unlisted by its id, or their own) every row, a hidden one (deck_entry_hidden) masked — name "Private card", the card''s values cleared.';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.deck_shows_card(text, uuid, uuid) from public;
grant execute on function public.deck_shows_card(text, uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.deck_entry_hidden(uuid, text, text, text, uuid, uuid) from public;
grant execute on function public.deck_entry_hidden(uuid, text, text, text, uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.deck_entries_for_viewer(uuid) from public;
grant execute on function public.deck_entries_for_viewer(uuid) to anon, authenticated, service_role;
