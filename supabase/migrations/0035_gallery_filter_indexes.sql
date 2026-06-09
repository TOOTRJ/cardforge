-- 0035_gallery_filter_indexes.sql — speed up gallery facet filters as the public
-- catalog grows. listPublicCardsRich() filters public cards by card_type / rarity
-- and orders by updated_at desc; the existing (visibility, updated_at) index
-- doesn't cover the facet column. These partial composite indexes match the
-- exact filter+sort shape and stay small by excluding private/unlisted rows.

create index if not exists cards_public_type_updated_idx
  on public.cards (card_type, updated_at desc)
  where visibility = 'public';

create index if not exists cards_public_rarity_updated_idx
  on public.cards (rarity, updated_at desc)
  where visibility = 'public';
