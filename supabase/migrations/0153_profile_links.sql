-- 0153_profile_links.sql — a profile's extra LINKS, its STORE cards, and a
-- server-side search of a creator's public cards for the profile page.
--
-- 1. profile_links — the MTG sites, socials and support pages a creator
--    links to beyond the seven social COLUMNS on profiles (which stay: the
--    card page reads them). One row per link: `kind` from ONE registry
--    (lib/profile/link-kinds.ts — the CHECK below lists exactly its keys, a
--    unit test holds them together), an https URL, an optional label (the
--    "other" kind's name), and a position. At most 12 per profile.
--
-- 2. profile_stores — the "Visit store" cards: where a creator SELLS cards
--    (TCGplayer, eBay, Whatnot, Cardmarket… lib/profile/store-platforms.ts,
--    held to the CHECK the same way), an https URL, an optional title, a
--    position. At most 4 per profile.
--
--    Both: the PUBLIC reads (a profile is public — the page lists them for
--    anyone), the OWNER writes (RLS on owner_id = auth.uid()). The database
--    holds the shape — https://, lengths, no whitespace, the kinds and the
--    caps; the per-platform host allow-lists and the strong-language check
--    on titles and labels are the app's (shared zod schemas, run by the
--    Settings actions), and the profile page re-checks every row it reads
--    before drawing it as an href (a row written straight through the API
--    skips the action). A deleted profile takes its rows with it.
--
--    The Settings editors save a whole list at once through
--    set_profile_links(jsonb) / set_profile_stores(jsonb): ONE transaction
--    (delete the caller's rows, insert the new list in order), SECURITY
--    INVOKER — RLS still decides, auth.uid() is the owner, nobody else's
--    rows are reachable. The caps are a BEFORE INSERT trigger under a
--    per-owner advisory lock (two tabs saving at once can't pass 12 / 4).
--
-- 3. Profile card search (the profile page's "All cards"): ONE filter,
--    profile_cards_filtered(owner, search, colour, card type) — the owner's
--    PUBLIC cards only (unlisted is link-only, as listPublicCardsByOwner
--    has it), a title / nickname search FOLDED both sides the way the
--    gallery's is (0136: the printed ’ ‘ “ ” — – read as the typed ' ' " "
--    - -, typedForMatching's table; a unit test holds the fold), LIKE
--    wildcards escaped, the gallery's colour rule — read by
--    list_profile_cards (ordered, paged, ≤ 60 a page) and
--    count_profile_cards (the result count the pager prints). SECURITY
--    INVOKER: RLS on cards still decides, and the public filter is explicit.
--
-- Grants (CLAUDE.md "Every migration states its grants"; new projects grant
-- nothing by default): the two tables — select to anon, select / insert /
-- update / delete to authenticated, all to service_role; RLS narrows it.
-- The functions: the setters to authenticated (+ service_role), the card
-- search to anon / authenticated / service_role, the trigger function to
-- nobody (a trigger runs it). Every function revokes PUBLIC first.
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- 1. profile_links -----------------------------------------------------------

create table if not exists public.profile_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  url text not null,
  label text,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint profile_links_kind check (kind in (
    'moxfield', 'archidekt', 'mtggoldfish', 'tappedout', 'deckstats',
    'untapped', 'melee', 'cardsphere',
    'twitch', 'reddit', 'threads', 'mastodon', 'facebook', 'artstation', 'deviantart',
    'linktree', 'substack',
    'patreon', 'kofi',
    'other'
  )),
  constraint profile_links_url check (
    url ~ '^https://[^\s/?#]+\.[^\s/?#]+' and url !~ '\s' and char_length(url) <= 2048
  ),
  constraint profile_links_label check (
    label is null or (char_length(label) between 1 and 40 and btrim(label) <> '')
  ),
  constraint profile_links_other_named check (kind <> 'other' or label is not null),
  constraint profile_links_position check (position between 0 and 99)
);

create index if not exists profile_links_owner_position_idx
  on public.profile_links (owner_id, position);

comment on table public.profile_links is
  'A profile''s extra links (lib/profile/link-kinds.ts): MTG sites, socials, support pages, one "other". Public read, owner write, ≤ 12 per profile.';

alter table public.profile_links enable row level security;

drop policy if exists "Profile links: public read" on public.profile_links;
create policy "Profile links: public read"
  on public.profile_links for select
  using (true);

drop policy if exists "Profile links: owner insert" on public.profile_links;
create policy "Profile links: owner insert"
  on public.profile_links for insert
  with check (owner_id = auth.uid());

drop policy if exists "Profile links: owner update" on public.profile_links;
create policy "Profile links: owner update"
  on public.profile_links for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Profile links: owner delete" on public.profile_links;
create policy "Profile links: owner delete"
  on public.profile_links for delete
  using (owner_id = auth.uid());

-- 2. profile_stores ----------------------------------------------------------

create table if not exists public.profile_stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null,
  url text not null,
  title text,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint profile_stores_platform check (platform in (
    'tcgplayer', 'ebay', 'whatnot', 'cardmarket', 'cardtrader', 'manapool',
    'mercari', 'etsy', 'facebook', 'website'
  )),
  constraint profile_stores_url check (
    url ~ '^https://[^\s/?#]+\.[^\s/?#]+' and url !~ '\s' and char_length(url) <= 2048
  ),
  constraint profile_stores_title check (
    title is null or (char_length(title) between 1 and 60 and btrim(title) <> '')
  ),
  constraint profile_stores_position check (position between 0 and 99)
);

create index if not exists profile_stores_owner_position_idx
  on public.profile_stores (owner_id, position);

comment on table public.profile_stores is
  'A profile''s store cards (lib/profile/store-platforms.ts): where the creator sells cards. Public read, owner write, ≤ 4 per profile.';

alter table public.profile_stores enable row level security;

drop policy if exists "Profile stores: public read" on public.profile_stores;
create policy "Profile stores: public read"
  on public.profile_stores for select
  using (true);

drop policy if exists "Profile stores: owner insert" on public.profile_stores;
create policy "Profile stores: owner insert"
  on public.profile_stores for insert
  with check (owner_id = auth.uid());

drop policy if exists "Profile stores: owner update" on public.profile_stores;
create policy "Profile stores: owner update"
  on public.profile_stores for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Profile stores: owner delete" on public.profile_stores;
create policy "Profile stores: owner delete"
  on public.profile_stores for delete
  using (owner_id = auth.uid());

-- The caps ------------------------------------------------------------------

create or replace function public.profile_links_enforce_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cap integer := case when tg_table_name = 'profile_stores' then 4 else 12 end;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.owner_id::text));
  if tg_table_name = 'profile_stores' then
    select count(*) into v_count from public.profile_stores where owner_id = new.owner_id;
  else
    select count(*) into v_count from public.profile_links where owner_id = new.owner_id;
  end if;
  if v_count >= v_cap then
    raise exception 'profile_links_cap_exceeded' using errcode = '23514',
      detail = format('%s holds at most %s rows per profile', tg_table_name, v_cap);
  end if;
  return new;
end;
$$;

revoke all on function public.profile_links_enforce_cap() from public;

drop trigger if exists profile_links_enforce_cap on public.profile_links;
create trigger profile_links_enforce_cap
  before insert on public.profile_links
  for each row execute function public.profile_links_enforce_cap();

drop trigger if exists profile_stores_enforce_cap on public.profile_stores;
create trigger profile_stores_enforce_cap
  before insert on public.profile_stores
  for each row execute function public.profile_links_enforce_cap();

-- The setters (one transaction per save) -------------------------------------

create or replace function public.set_profile_links(p_links jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_links, '[]'::jsonb)) <> 'array' then
    raise exception 'profile_links_not_a_list' using errcode = '22023';
  end if;
  delete from public.profile_links where owner_id = v_owner;
  insert into public.profile_links (owner_id, kind, url, label, position)
  select v_owner, e.value ->> 'kind', e.value ->> 'url',
         nullif(btrim(coalesce(e.value ->> 'label', '')), ''),
         (e.ordinality - 1)::smallint
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) with ordinality as e (value, ordinality)
  order by e.ordinality;
end;
$$;

create or replace function public.set_profile_stores(p_stores jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_stores, '[]'::jsonb)) <> 'array' then
    raise exception 'profile_stores_not_a_list' using errcode = '22023';
  end if;
  delete from public.profile_stores where owner_id = v_owner;
  insert into public.profile_stores (owner_id, platform, url, title, position)
  select v_owner, e.value ->> 'platform', e.value ->> 'url',
         nullif(btrim(coalesce(e.value ->> 'title', '')), ''),
         (e.ordinality - 1)::smallint
  from jsonb_array_elements(coalesce(p_stores, '[]'::jsonb)) with ordinality as e (value, ordinality)
  order by e.ordinality;
end;
$$;

-- 3. Profile card search -----------------------------------------------------

create or replace function public.profile_cards_filtered(
  p_owner uuid,
  p_search text default null,
  p_color text default null,
  p_card_type text default null
)
returns setof public.cards
language sql
stable
security invoker
set search_path = public
as $$
  select c.*
  from public.cards c
  cross join (
    select case when nullif(btrim(coalesce(p_search, '')), '') is null then null
                else '%' || translate(
                       replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_'),
                       '’‘“”—–', '''''""--') || '%' end as like_q
  ) p
  where c.owner_id = p_owner
    and c.visibility = 'public'
    and (p_card_type is null or c.card_type = p_card_type)
    and (
      p_color is null
      or (p_color = 'colorless' and (cardinality(c.color_identity) = 0 or 'colorless' = any(c.color_identity)))
      or (p_color = 'multicolor' and (coalesce(c.color_count, 0) > 1 or 'multicolor' = any(c.color_identity)))
      or (p_color not in ('colorless', 'multicolor') and p_color = any(c.color_identity))
    )
    and (
      p.like_q is null
      or translate(c.title, '’‘“”—–', '''''""--') ilike p.like_q escape '\'
      or translate(coalesce(c.nickname, ''), '’‘“”—–', '''''""--') ilike p.like_q escape '\'
    );
$$;

create or replace function public.list_profile_cards(
  p_owner uuid,
  p_search text default null,
  p_color text default null,
  p_card_type text default null,
  p_sort text default 'recent',
  p_limit integer default 24,
  p_offset integer default 0
)
returns setof public.cards
language sql
stable
security invoker
set search_path = public
as $$
  select f.*
  from public.profile_cards_filtered(p_owner, p_search, p_color, p_card_type) f
  order by
    case when p_sort = 'newest' then f.created_at end desc,
    case when p_sort = 'popular' then f.likes_count end desc,
    case when p_sort = 'name' then lower(f.title) end asc,
    f.updated_at desc,
    f.id
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

create or replace function public.count_profile_cards(
  p_owner uuid,
  p_search text default null,
  p_color text default null,
  p_card_type text default null
)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
  from public.profile_cards_filtered(p_owner, p_search, p_color, p_card_type);
$$;

-- Grants --------------------------------------------------------------------

grant select on table public.profile_links, public.profile_stores to anon;
grant select, insert, update, delete on table public.profile_links, public.profile_stores to authenticated;
grant all on table public.profile_links, public.profile_stores to service_role;

revoke all on function public.set_profile_links(jsonb) from public;
revoke all on function public.set_profile_stores(jsonb) from public;
grant execute on function public.set_profile_links(jsonb) to authenticated, service_role;
grant execute on function public.set_profile_stores(jsonb) to authenticated, service_role;

revoke all on function public.profile_cards_filtered(uuid, text, text, text) from public;
revoke all on function public.list_profile_cards(uuid, text, text, text, text, integer, integer) from public;
revoke all on function public.count_profile_cards(uuid, text, text, text) from public;
grant execute on function public.profile_cards_filtered(uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.list_profile_cards(uuid, text, text, text, text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.count_profile_cards(uuid, text, text, text) to anon, authenticated, service_role;
