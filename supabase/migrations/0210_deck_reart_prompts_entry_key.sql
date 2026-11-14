-- 0210_deck_reart_prompts_entry_key.sql — the API reads a deck's entries
-- again.
--
-- 0209 keyed deck_reart_prompts on (deck_id, entry_id): two foreign keys —
-- one to decks, one to deck_cards — that together were the table's PRIMARY
-- KEY. The database API (PostgREST) reads a table shaped like that as a
-- MANY-TO-MANY link between the two tables it points at. decks and
-- deck_cards already have their own link (deck_cards.deck_id), so from that
-- migration on every embedded read between the two that did not name its
-- foreign key was refused as ambiguous (PGRST201, "more than one
-- relationship was found for 'decks' and 'deck_cards'"):
--
--   * every deck tile's colours and card fan (lib/decks/tile-art.ts) — the
--     tiles drew their default cover, on every page that lists decks;
--   * Bulk Customize's read of a deck's entries (every one "skipped");
--   * Re-art deck's step ("This card is no longer in your deck.").
--
-- The reads failed; nothing was written wrongly and nothing was charged
-- (each stops before its charge).
--
-- The fix: an entry belongs to ONE deck, so `entry_id` alone identifies a
-- card's words. The primary key becomes (entry_id), and (deck_id, entry_id)
-- stays UNIQUE — the app's upsert and 0209's seed name those two columns.
-- With the deck's foreign key out of the primary key the table is no longer
-- a link between decks and deck_cards, and the unnamed reads answer again.
-- (From the same PR on, the app's reads name their foreign key and no
-- longer depend on this.)
--
-- The pair's unique constraint is added BEFORE the key is swapped, and the
-- swap is ONE statement: at no moment is (deck_id, entry_id) without a
-- unique constraint (an upsert in that moment would be refused).
--
-- No row changes. The grants, RLS, the read policy and the owner trigger are
-- 0209's, untouched. Idempotent. Ships through a PR; never applied ad-hoc.
--
-- api-junction: checked — the composite key is REMOVED here.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.deck_reart_prompts'::regclass
      and conname = 'deck_reart_prompts_deck_entry_key'
  ) then
    alter table public.deck_reart_prompts
      add constraint deck_reart_prompts_deck_entry_key unique (deck_id, entry_id);
  end if;
end
$$;

alter table public.deck_reart_prompts
  drop constraint if exists deck_reart_prompts_pkey,
  add constraint deck_reart_prompts_pkey primary key (entry_id);

-- The primary key's own index covers entry_id now.
drop index if exists public.deck_reart_prompts_entry_idx;

comment on table public.deck_reart_prompts is
  'Re-art deck beta tool (0209): one card''s own words for its picture, by deck entry — the card''s subject in the deck''s look, or (only_words) its whole prompt. Keyed on entry_id alone since 0210 (a key over both foreign keys made the API read the table as a decks ↔ deck_cards link). Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

-- The API re-reads the schema on DDL by itself; said once more, by name.
notify pgrst, 'reload schema';
