-- 0149_deck_tiles_trending.sql — trending decks, "In N decks" on cards, and
-- two deck notifications (2026-10-28 deck plan: TODO DK8.2, DK8.4, DK8.6).
--
-- 0. ONE ANSWER TO "IS THIS A REAL CREATOR" (owner decisions 2026-10-29 and
--    2026-10-30, the anti-spam rule). owner_is_creator(owner): the account
--    is no admin (0091's owner_is_admin) and has at least one PUBLIC card of
--    its own — a creator, not a throwaway account. Every place that asks
--    reads this function, never a restated predicate: another user's deck
--    on a card's page (section 1), the decks that may trend (section 2) and
--    the /creators directory — 0148's list_public_creators is redefined over
--    it here (same signature, result and people; its `not owner_is_admin`
--    filter on makers who already own a public card becomes the call).
--
-- 1. ONE RULE FOR "THE PUBLIC DECKS THAT NAME A CARD" (DK8.4; owner decision
--    2026-10-29, first written as 0144's public_decks_containing_card). A
--    card is named by the card OWNER's own public, non-empty decks, and by
--    another user's public, non-empty deck only while the card is PUBLIC
--    and the deck's owner is a real creator (section 0) — 0144's predicate,
--    with ONE narrowing: a card on the MAYBEBOARD alone is not in the deck
--    (0144 counted it). Everything else already says so — the stored
--    card_count (0143), the tiles' colours and fan, the deck page's own
--    fan — so the decks on a card's page now agree with them. The rule
--    lives in ONE function, public_deck_card_pairs(cards, deck), the (card,
--    deck) pairs it allows (at most 200 card ids a call, capped inside it),
--    and everything that asks "which public decks hold this card" reads it:
--      * public_decks_containing_card(card, limit) — 0144's list (the card
--        page's "In decks" row, its JSON-LD isPartOf and, since this PR, its
--        "Decks with this card" tiles), redefined over the pairs: same
--        signature and order, the same result but for the maybeboard;
--      * public_deck_counts_for_cards(cards[]) — NEW: the batched count the
--        gallery tile's "In N decks" reads (at most 200 ids a call; a card
--        no public deck names is left out — the app reads it as 0);
--      * the deck_card_added notification below.
--    So the count, the list and the notification can never disagree. All
--    three readers are SECURITY INVOKER: a page's anon client reads what anon
--    may read, nothing more (a private card names no deck for a visitor).
--
-- 2. TRENDING DECKS (DK8.2). list_trending_decks(limit) ranks public,
--    non-empty decks of real creators (section 0: no admin-owned deck, no
--    throwaway account's — likes from a few accounts can't put a spam deck
--    on /decks and the gallery) by their likes of the LAST 7 DAYS
--    (deck_likes.created_at; the owner's own like doesn't count, as the
--    cards' trending skips it), then all-time likes, then the newest edit.
--    Only decks with at least one such like: an empty row hides itself in
--    the app. Returns the deck rows in rank order (at most 24). SECURITY
--    INVOKER — anon reads public decks and their likes (0055 / 0102), so no
--    definer is needed. Its lookup is per deck: deck_likes gains
--    (deck_id, created_at), which also serves every (deck_id) read the
--    single-column index served, so that one is dropped.
--
-- 3. NOTIFICATIONS (DK8.6). Two kinds join the type CHECK (0140's list plus
--    'deck_like' and 'deck_card_added'); copy in lib/notifications/
--    describe.ts; delivered in real time by 0075's publication.
--      * deck_like — someone liked your PUBLIC deck (never your own like,
--        never a private or unlisted deck). payload { deckId, slug, title }.
--        ONE per liker and deck, ever: a unique partial index on (actor,
--        deck) and ON CONFLICT DO NOTHING. Not retracted on unlike — a
--        retraction would let a like / unlike loop toast the owner again
--        (users can't delete notifications since 0088, so the index holds).
--      * deck_card_added — someone ELSE's public deck now names your cards,
--        by section 1's rule (so never your own deck, a private or unlisted
--        one, an admin's, or one from an account with no public card). ONE
--        row per RECIPIENT AND DECK (unique partial index on (recipient,
--        deck)) — never one per card: a deck published with 14 of your
--        cards, or a batch "Add to deck", is ONE toast, ONE bell row, ONE
--        digest line. actor = the deck's owner; payload { deckId, slug,
--        title, cardIds, count } (your cards in that deck, sorted, and how
--        many); card_id = the card when there is ONE, else NULL. Later
--        additions to the same deck MERGE into that row (cardIds / count
--        grow, slug / title refresh) and, only when the set grew, mark it
--        unread again — an UPDATE, which raises no realtime toast (the
--        stream listens to INSERTs) — rather than a new row: the news is
--        kept without a second toast, and an add / remove / add loop of the
--        same card changes nothing. Fired when an entry gains a card (an
--        insert, or an update that changes card_id) — as a DEFERRED
--        constraint trigger, so it runs at commit, after 0143's statement
--        trigger has stored the deck's card_count (the rule reads it), every
--        entry of one commit merging into the one row — and when a deck
--        turns public (its other creators' cards, at once). Not fired when a
--        card or the adder's first card turns public later.
--    Both writers are SECURITY DEFINER triggers (users have no INSERT on
--    notifications) and never fail the write that fired them: a failure is
--    a WARNING and the like / entry / deck still saves.
--
-- Grants: the three readers and trending (and owner_is_creator and the
-- pairs function they call — an invoker's callee needs EXECUTE too) are
-- public reads: PUBLIC revoked, EXECUTE to anon, authenticated and
-- service_role. list_public_creators keeps 0148's signature and grants
-- (`create or replace` keeps its ACL; restated).
-- public_decks_containing_card keeps its signature (`create or replace` keeps
-- its ACL; restated). notify_deck_cards_added and the three trigger
-- functions are invoked by triggers alone (EXECUTE revoked from PUBLIC and
-- the API roles). The CHECK and the indexes carry no privileges.
--
-- Backward compatible with the code before it: nothing old calls the new
-- functions, and the redefined list returns what 0144's did but for the
-- maybeboard-only decks (intended, section 1).
--
-- Ships through a PR; never applied ad-hoc. Idempotent.

-- ===========================================================================
-- 0. A real creator: one answer
-- ===========================================================================

-- SECURITY INVOKER: a public card is readable by anyone; owner_is_admin is
-- 0091's definer (anon may call it).
create or replace function public.owner_is_creator(p_owner_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not public.owner_is_admin(p_owner_id)
    and exists (
      select 1 from public.cards own
      where own.owner_id = p_owner_id and own.visibility = 'public'
    );
$$;

revoke all on function public.owner_is_creator(uuid) from public;
grant execute on function public.owner_is_creator(uuid) to anon, authenticated, service_role;

-- 0148's /creators directory, over the one answer: its makers (owners of a
-- public card) are kept where they are real creators — the same people as
-- 0148's `not owner_is_admin(...)` (a maker has a public card by its own
-- definition). Same signature, result, order and paging; only that filter
-- changes. The makers CTE stays MATERIALIZED, so the call is once per maker.
create or replace function public.list_public_creators(
  p_sort text default 'cards',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  public_cards bigint,
  public_decks bigint,
  likes bigint,
  last_card_at timestamptz,
  recent_card_ids uuid[],
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with makers as materialized (
    select
      c.owner_id,
      count(*)::bigint as public_cards,
      coalesce(sum(c.likes_count), 0)::bigint as likes,
      max(c.created_at) as last_card_at
    from public.cards c
    where c.visibility = 'public'
    group by c.owner_id
  ),
  ranked as (
    select
      m.owner_id,
      p.username,
      p.display_name,
      p.avatar_url,
      m.public_cards,
      m.likes,
      m.last_card_at,
      row_number() over (
        order by
          case when p_sort = 'recent' then m.last_card_at end desc nulls last,
          case when p_sort = 'liked' then m.likes end desc nulls last,
          m.public_cards desc,
          m.last_card_at desc,
          p.username asc
      ) as rn,
      count(*) over () as total
    from makers m
    join public.profiles p on p.id = m.owner_id
    where public.owner_is_creator(m.owner_id)
  ),
  page as (
    select r.*
    from ranked r
    order by r.rn
    limit greatest(1, least(coalesce(p_limit, 24), 60))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    pg.owner_id as id,
    pg.username,
    pg.display_name,
    pg.avatar_url,
    pg.public_cards,
    (
      select count(*)
      from public.decks d
      where d.owner_id = pg.owner_id
        and d.visibility = 'public'
        and exists (select 1 from public.deck_cards dc where dc.deck_id = d.id)
    )::bigint as public_decks,
    pg.likes,
    pg.last_card_at,
    array(
      select c.id
      from public.cards c
      where c.owner_id = pg.owner_id
        and c.visibility = 'public'
      order by c.created_at desc, c.id
      limit 3
    ) as recent_card_ids,
    pg.total
  from page pg
  order by pg.rn;
$$;

revoke all on function public.list_public_creators(text, integer, integer) from public;
grant execute on function public.list_public_creators(text, integer, integer)
  to anon, authenticated, service_role;

-- ===========================================================================
-- 1. The public decks that name a card: one rule
-- ===========================================================================

create or replace function public.public_deck_card_pairs(
  p_card_ids uuid[],
  p_deck_id uuid default null
)
returns table (card_id uuid, deck_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct c.id, d.id
  from public.cards c
  join public.deck_cards dc on dc.card_id = c.id
  join public.decks d on d.id = dc.deck_id
  -- At most 200 card ids a call, whoever asks (anon included).
  where c.id = any((p_card_ids)[1:200])
    and (p_deck_id is null or d.id = p_deck_id)
    -- The maybeboard is not the deck (card_count, the tiles, the fans).
    and dc.board <> 'maybe'
    and d.visibility = 'public'
    and d.card_count > 0
    and (
      -- The card owner's own deck.
      d.owner_id = c.owner_id
      -- Another user's: only while the card is public, and only from a
      -- real creator (no admin, a public card of their own — section 0).
      or (
        c.visibility = 'public'
        and public.owner_is_creator(d.owner_id)
      )
    );
$$;

revoke all on function public.public_deck_card_pairs(uuid[], uuid) from public;
grant execute on function public.public_deck_card_pairs(uuid[], uuid) to anon, authenticated, service_role;

-- 0144's list, over the pairs: same signature, result and order.
create or replace function public.public_decks_containing_card(p_card_id uuid, p_limit integer default 5)
returns table (slug text, title text)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.slug, d.title
  from public.public_deck_card_pairs(array[p_card_id]) p
  join public.decks d on d.id = p.deck_id
  order by d.updated_at desc, d.id
  limit least(greatest(coalesce(p_limit, 5), 1), 24);
$$;

revoke all on function public.public_decks_containing_card(uuid, integer) from public;
grant execute on function public.public_decks_containing_card(uuid, integer) to anon, authenticated, service_role;

-- The gallery tile's "In N decks": one call per page of cards.
create or replace function public.public_deck_counts_for_cards(p_card_ids uuid[])
returns table (card_id uuid, deck_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.card_id, count(*)::integer
  from public.public_deck_card_pairs((p_card_ids)[1:200]) p
  group by p.card_id;
$$;

revoke all on function public.public_deck_counts_for_cards(uuid[]) from public;
grant execute on function public.public_deck_counts_for_cards(uuid[]) to anon, authenticated, service_role;

-- ===========================================================================
-- 2. Trending decks
-- ===========================================================================

create index if not exists deck_likes_deck_id_created_at_idx
  on public.deck_likes (deck_id, created_at);
drop index if exists public.deck_likes_deck_id_idx;

create or replace function public.list_trending_decks(p_limit integer default 8)
returns setof public.decks
language sql
stable
security invoker
set search_path = ''
as $$
  select d.*
  from public.decks d
  cross join lateral (
    select count(*) as recent
    from public.deck_likes l
    where l.deck_id = d.id
      and l.created_at >= now() - interval '7 days'
      and l.user_id <> d.owner_id
  ) likes
  where d.visibility = 'public'
    and d.card_count > 0
    and likes.recent > 0
    and public.owner_is_creator(d.owner_id)
  order by likes.recent desc, d.likes_count desc, d.updated_at desc, d.id
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

revoke all on function public.list_trending_decks(integer) from public;
grant execute on function public.list_trending_decks(integer) to anon, authenticated, service_role;

-- ===========================================================================
-- 3. Notifications: deck_like and deck_card_added
-- ===========================================================================

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed',
      'deck_like', 'deck_card_added'
    )
  );

create unique index if not exists notifications_deck_like_once_idx
  on public.notifications (actor_id, (payload ->> 'deckId'))
  where type = 'deck_like';

create unique index if not exists notifications_deck_card_added_per_deck_idx
  on public.notifications (recipient_id, (payload ->> 'deckId'))
  where type = 'deck_card_added';

-- deck_like: the liker, the deck's owner, a public deck only.
create or replace function public.notify_on_deck_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_slug text;
  v_title text;
  v_visibility text;
begin
  select d.owner_id, d.slug, d.title, d.visibility
    into v_owner, v_slug, v_title, v_visibility
  from public.decks d
  where d.id = new.deck_id;
  if v_owner is null or v_owner = new.user_id or v_visibility <> 'public' then
    return new;
  end if;
  begin
    insert into public.notifications (recipient_id, actor_id, type, payload)
    values (
      v_owner, new.user_id, 'deck_like',
      jsonb_build_object('deckId', new.deck_id, 'slug', v_slug, 'title', v_title)
    )
    on conflict (actor_id, (payload ->> 'deckId')) where type = 'deck_like'
    do nothing;
  exception when others then
    raise warning 'notify_on_deck_like: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

revoke all on function public.notify_on_deck_like() from public, anon, authenticated;

drop trigger if exists deck_likes_notify on public.deck_likes;
create trigger deck_likes_notify
  after insert on public.deck_likes
  for each row execute function public.notify_on_deck_like();

-- deck_card_added: the pairs of section 1's rule in this deck whose card is
-- another user's, as ONE row per recipient and deck — merged into the row
-- that recipient already has for the deck (cardIds / count grow; unread
-- again only when they grew), else inserted. The pairs read takes 200 ids a
-- call, so a big deck is read in slices (each merging into the one row).
-- Called by the two triggers below (their SECURITY DEFINER owner runs it:
-- it reads every row).
create or replace function public.notify_deck_cards_added(p_deck_id uuid, p_card_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slice integer := 0;
  v_ids uuid[];
  r record;
  v_merged uuid[];
  v_before integer;
begin
  while v_slice * 200 < coalesce(cardinality(p_card_ids), 0) loop
    v_ids := p_card_ids[v_slice * 200 + 1 : (v_slice + 1) * 200];
    v_slice := v_slice + 1;
    for r in
      select c.owner_id as recipient, d.owner_id as actor, d.id as deck_id, d.slug, d.title,
             array_agg(c.id order by c.id) as card_ids
      from public.public_deck_card_pairs(v_ids, p_deck_id) p
      join public.cards c on c.id = p.card_id
      join public.decks d on d.id = p.deck_id
      where c.owner_id <> d.owner_id
      group by c.owner_id, d.owner_id, d.id, d.slug, d.title
    loop
      -- Twice at most: a row a concurrent commit inserted between the read
      -- and the insert is merged into on the second pass.
      for attempt in 1..2 loop
        select array(
                 select x from (
                   select jsonb_array_elements_text(coalesce(n.payload -> 'cardIds', '[]'::jsonb))::uuid as x
                   union
                   select unnest(r.card_ids)
                 ) u
                 order by x
               ),
               jsonb_array_length(coalesce(n.payload -> 'cardIds', '[]'::jsonb))
          into v_merged, v_before
        from public.notifications n
        where n.type = 'deck_card_added'
          and n.recipient_id = r.recipient
          and n.payload ->> 'deckId' = r.deck_id::text
        for update;

        if found then
          update public.notifications n
          set payload = jsonb_build_object(
                'deckId', r.deck_id, 'slug', r.slug, 'title', r.title,
                'cardIds', to_jsonb(v_merged), 'count', cardinality(v_merged)
              ),
              card_id = case when cardinality(v_merged) = 1 then v_merged[1] end,
              read_at = case when cardinality(v_merged) > v_before then null else n.read_at end
          where n.type = 'deck_card_added'
            and n.recipient_id = r.recipient
            and n.payload ->> 'deckId' = r.deck_id::text;
          exit;
        end if;

        insert into public.notifications (recipient_id, actor_id, type, card_id, payload)
        values (
          r.recipient, r.actor, 'deck_card_added',
          case when cardinality(r.card_ids) = 1 then r.card_ids[1] end,
          jsonb_build_object(
            'deckId', r.deck_id, 'slug', r.slug, 'title', r.title,
            'cardIds', to_jsonb(r.card_ids), 'count', cardinality(r.card_ids)
          )
        )
        on conflict (recipient_id, (payload ->> 'deckId')) where type = 'deck_card_added'
        do nothing;
        exit when found;
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function public.notify_deck_cards_added(uuid, uuid[]) from public, anon, authenticated;

-- An entry gains a card: judged at COMMIT (deferred), when the deck's
-- stored card_count includes it and the rows are final.
create or replace function public.notify_on_deck_card_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.card_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.card_id is not distinct from old.card_id then
    return null;
  end if;
  begin
    perform public.notify_deck_cards_added(new.deck_id, array[new.card_id]);
  exception when others then
    raise warning 'notify_on_deck_card_link: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.notify_on_deck_card_link() from public, anon, authenticated;

drop trigger if exists deck_cards_notify_card_added on public.deck_cards;
create constraint trigger deck_cards_notify_card_added
  after insert or update of card_id on public.deck_cards
  deferrable initially deferred
  for each row
  when (new.card_id is not null)
  execute function public.notify_on_deck_card_link();

-- A deck turns public: its other creators' cards, at once.
create or replace function public.notify_on_deck_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.notify_deck_cards_added(
      new.id,
      array(
        select distinct dc.card_id
        from public.deck_cards dc
        where dc.deck_id = new.id and dc.card_id is not null
      )
    );
  exception when others then
    raise warning 'notify_on_deck_published: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function public.notify_on_deck_published() from public, anon, authenticated;

drop trigger if exists decks_notify_published on public.decks;
create trigger decks_notify_published
  after update of visibility on public.decks
  for each row
  when (new.visibility = 'public' and old.visibility is distinct from 'public')
  execute function public.notify_on_deck_published();
