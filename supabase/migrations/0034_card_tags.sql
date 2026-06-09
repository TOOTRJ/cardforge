-- 0034_card_tags.sql — freeform tags on cards for discovery.
-- Stored as a normalized lowercase text[] (the app layer trims/lowercases/dedupes
-- and caps element length). A GIN index powers tag-containment gallery filters.

alter table public.cards
  add column if not exists tags text[] not null default '{}';

alter table public.cards
  drop constraint if exists cards_tags_count;
alter table public.cards
  add constraint cards_tags_count check (cardinality(tags) <= 12);

create index if not exists cards_tags_gin on public.cards using gin (tags);
