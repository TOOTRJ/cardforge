-- Set icons. A set may carry an optional symbol shown in its cards' type-line
-- set-symbol slot (in place of the default Spellwright mark): either an uploaded
-- image (icon_url) or a preset Keyrune set-symbol code (icon_code, e.g. "mh3").
-- Cards denormalize their primary set's icon so the renderers (live preview +
-- Satori bake, both select *) need no join; primary_set_id records the source so
-- a set-icon edit can re-sync the set's cards.

alter table public.card_sets
  add column if not exists icon_url text,
  add column if not exists icon_code text;

alter table public.card_sets
  drop constraint if exists card_sets_icon_url_length,
  add constraint card_sets_icon_url_length
    check (icon_url is null or char_length(icon_url) <= 2048);

alter table public.card_sets
  drop constraint if exists card_sets_icon_code_format,
  add constraint card_sets_icon_code_format
    check (icon_code is null or (char_length(icon_code) between 1 and 32 and icon_code ~ '^[a-z0-9]+$'));

alter table public.cards
  add column if not exists primary_set_id uuid references public.card_sets (id) on delete set null,
  add column if not exists set_icon_url text,
  add column if not exists set_icon_code text;

alter table public.cards
  drop constraint if exists cards_set_icon_url_length,
  add constraint cards_set_icon_url_length
    check (set_icon_url is null or char_length(set_icon_url) <= 2048);

alter table public.cards
  drop constraint if exists cards_set_icon_code_format,
  add constraint cards_set_icon_code_format
    check (set_icon_code is null or (char_length(set_icon_code) between 1 and 32 and set_icon_code ~ '^[a-z0-9]+$'));

create index if not exists cards_primary_set_id_idx
  on public.cards (primary_set_id)
  where primary_set_id is not null;
