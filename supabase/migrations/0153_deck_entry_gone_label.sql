-- 0153_deck_entry_gone_label.sql — a deleted card's deck entry reads
-- "No longer available" to visitors, not "Private card" (owner decision
-- 2026-10-29, the follow-up to 0152).
--
-- 0152 hides an entry from anyone but its deck's owner when it has no
-- printing behind it AND either it links a card the deck doesn't show them
-- (a private card, another creator's card that is no longer public), or its
-- card is GONE: no card left (0055's ON DELETE SET NULL) and its source says
-- the entry came WITH a card (deck_entry_hidden's second branch). Its
-- deck_entries_for_viewer masked both alike, as "Private card". For a
-- deleted card that says something untrue about it (there is no card to be
-- private), so a gone entry's mask now reads "No longer available" — the
-- words its status badge already shows (lib/decks/deck-view.ts
-- NO_LONGER_AVAILABLE; lib/decks/private-card-name.ts GONE_CARD_NAME, which
-- a unit test holds to this file). A private or withheld card still reads
-- "Private card". Everything else is 0152's, word for word: who may open
-- the deck, which rows are hidden (deck_entry_hidden, untouched), every
-- column the mask clears, the owner's rows as stored. Nothing stored
-- changes; the read policy is untouched.
--
-- Telling the two apart needs no new helper: a HIDDEN entry with no card
-- left is the gone case (a hidden entry has no printing, by
-- deck_entry_hidden; a linked one has a card_id).
--
-- 0151's guide redaction (deck_guide_for_viewer) is not changed: its hidden
-- set is "a linked card the visitor's list hides", so a deleted card's name
-- in an old guide is not redacted at all (it never said "Private card"
-- there). Folding the gone case into it means rewriting that function's
-- redaction set; not done here.
--
-- ACCEPTED GAP (owner, 2026-10-29). An entry written before 0144 has no
-- source, so when its card is deleted it is not "gone" to the database —
-- deck_entry_hidden can't tell it from a pasted name or an entry its owner
-- unlinked (which clears the source on purpose), and it stays visible to
-- visitors with its stored name, as before 0152. Production holds 391 entries
-- that would read so once their card is deleted (`source is null and card_id
-- is not null and scryfall_id is null`). Erratum in
-- supabase/migrations/README.md.
--
-- Grants: deck_entries_for_viewer keeps its signature and its grants
-- (`create or replace` keeps the ACL); restated as 0152's: PUBLIC revoked,
-- EXECUTE to anon, authenticated and service_role. No other grant changes.
--
-- Deploy: either order is safe. The app before it labels every hidden row
-- "Private card" itself (publicDeckItems), so until the new deployment is
-- live a deleted card still reads "Private card" — as today. The new app
-- labels it "No longer available" from the entry's own shape
-- (lib/decks/private-card-name.ts isGoneForViewer), on a database with or
-- without this migration.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

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
      -- A deleted card (no card left: the gone branch of deck_entry_hidden)
      -- reads "No longer available"; a card the deck doesn't show,
      -- "Private card".
      v_entry.name := case when v_entry.card_id is null then 'No longer available' else 'Private card' end;
      -- Every value the row holds FROM the card (0055's columns). A column
      -- added to deck_cards later that copies a card's text is added here.
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
  'A deck''s entries as its page shows them to the caller (0152, 0153): the owner''s rows as stored; for anyone else who may open the deck (public, unlisted by its id, or their own) every row, a hidden one (deck_entry_hidden) masked — name "Private card", or "No longer available" for a deleted card, the card''s values cleared.';

revoke all on function public.deck_entries_for_viewer(uuid) from public;
grant execute on function public.deck_entries_for_viewer(uuid) to anon, authenticated, service_role;
