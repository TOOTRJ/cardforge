-- 0054_cards_view_count_idx.sql — index the "most viewed" gallery sort.
--
-- listPublicCardsRich's sort=viewed path orders public cards by view_count
-- desc; every other gallery sort (likes_count 0043, updated_at/created_at,
-- type/rarity 0035) already has a matching index. Partial on visibility so
-- the index only carries rows the gallery can actually show.
--
-- Apply via `npm run db:push:staging` / `npm run db:push:prod`.

create index if not exists cards_view_count_public_idx
  on public.cards (view_count desc)
  where visibility = 'public';
