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
-- below, the ONE rule here. An entry is HIDDEN from a visitor when it links
-- a card the deck does not show them AND has no printing behind it (an
-- entry with a printing holds the REAL card's name, which the page shows
-- beside "Private card" by design). The deck's OWNER is never a visitor.
--
-- THE FIX: read-time, nothing stored changes.
--   1. The entries' read policy: the deck's owner reads every row of their
--      deck (as before); anyone else who may read the deck (0151's decks
--      policy — the unlisted-deck link header included) reads every row
--      but a hidden one. A direct API read (anon or another signed-in user,
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
-- breakdown counts the card without them and the deck's default cover no
-- longer takes a private card's colours from its entry (lib/decks/cover.ts
-- already counted a private CARD for nobody). The owner sees what they saw.
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
-- Grants: deck_shows_card() is every API role's (the policy runs it for
-- anon too; a pure function of its three arguments, it reads nothing).
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
-- policy, of the same name as 0055's, is replaced here) and applies on a
-- database without it.

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

-- ===========================================================================
-- 1. The entries' read: a hidden entry is its deck owner's alone
-- ===========================================================================

-- 0055 / 0151's policy (one name), and this migration's on a re-run.
drop policy if exists "Deck cards: visible when parent deck is readable" on public.deck_cards;
drop policy if exists "Deck cards: the owner's, and a visitor's where the card shows" on public.deck_cards;
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
          -- Not hidden: no card, a printing behind it, or a card the deck
          -- shows.
          or deck_cards.card_id is null
          or deck_cards.scryfall_id is not null
          or exists (
            select 1
            from public.cards c
            where c.id = deck_cards.card_id
              and public.deck_shows_card(c.visibility, c.owner_id, d.owner_id)
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
           e.card_id is not null
             and e.scryfall_id is null
             and not coalesce(public.deck_shows_card(c.visibility, c.owner_id, v_owner), false) as hidden
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
  'A deck''s entries as its page shows them to the caller (0152): the owner''s rows as stored; for anyone else who may open the deck (public, unlisted by its id, or their own) every row, an entry linking a card the deck does not show them with no printing behind it masked — name "Private card", the card''s values cleared.';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on function public.deck_shows_card(text, uuid, uuid) from public;
grant execute on function public.deck_shows_card(text, uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.deck_entries_for_viewer(uuid) from public;
grant execute on function public.deck_entries_for_viewer(uuid) to anon, authenticated, service_role;
