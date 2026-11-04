-- 0164 — Clone a deck with "remixed from" credit, and similar decks
-- (TODO DK5.16). NOTE: numbered after 0163 (#722, merged 2026-11-03); the
-- number is checked again at merge and renumbered if another PR lands first.
--
-- 1. LINEAGE. public.deck_remix_sources — one row per CLONE: the deck it was
--    copied from (ON DELETE SET NULL: the credit then reads "another deck")
--    and that deck's owner at the time. A table of its own, never a column
--    on decks: every deck reader selects `decks.*`, and a deck's id is its
--    LINK (0151: an unlisted deck opens for a request that names its slug or
--    id), so a source id on a public clone's row would hand out an unlisted
--    deck's link. No API role reads or writes the table: clone_deck() writes
--    it, deck_remix_credit() reads it.
--
-- 2. CLONE. clone_deck(source, title, slug, masked) — the caller's copy of a deck
--    they may open (public; unlisted, by its id — its link; or their own),
--    in ONE transaction: a PRIVATE deck (the cloner publishes it when it is
--    theirs) with the source's format, type and bracket — never its
--    description or cover (the source owner's words and upload) — and its
--    entries as the caller may see them, by the deck rules:
--      * a linked PipGlyph card comes along only when the CLONE may link it
--        (canLinkIntoDeck / guard_deck_card_link: the caller's own card, or
--        a public one). Any other card's link is dropped;
--      * an entry with a printing keeps it (and its real card's name, which
--        every visitor reads already) — it loses only the link;
--      * an entry with NO printing whose card can't come along (another
--        user's private or unlisted card), or whose card is gone (no card
--        left and its source says it came with one — deck_entry_hidden's
--        rule), is SKIPPED: never a name, cost or colour of a card the
--        caller can't read;
--      * a plain line (no card, no printing, a non-card source) is copied;
--      * a kept printing whose card can't come along is copied as the
--        source's page shows it to the caller: the entries in `masked`
--        (the app's strong-language rule — ONE detector,
--        lib/moderation/profanity.ts, which SQL can't run — the same rows
--        publicDeckItems masks for this viewer) as "Private card" with no
--        type line, never their stored name or type line. Display only:
--        0152 hides no printing row, so this is the page's rule carried
--        into the copy, and a caller who passes fewer ids masks less of
--        THEIR OWN copy of text the API reads them already.
--    Each copied row keeps its board, quantity, order, printing fields,
--    cover pick and source (descriptive, 0144). The entry cap holds: more
--    than 500 rows to copy refuses the clone (deck_entry_limit, as
--    import_deck_entries). It makes NO card, so saved-card capacity is
--    untouched; decks are unlimited (0147). The slug follows
--    createDeckAction's rule (the app's slug, then -2, -3 … on a taken
--    slug — another deck's, or one a renamed deck keeps, 0155). SECURITY
--    DEFINER (it writes the lineage), so it states every rule itself: the
--    caller signed in, the source readable by them, the link rule above.
--    Returns { deckId, slug, copied, skipped }.
--
--    The LINEAGE row is written only for another owner's deck: a
--    "Duplicate" of the caller's own deck is credited to nobody.
--
-- 3. NOTIFICATION. 'deck_cloned' joins the type CHECK (0161's list + it,
--    nothing dropped): the source's owner hears ONCE per cloner and deck
--    (a unique partial index, as deck_like's), never for their own clone.
--    Its payload names the SOURCE deck (their own) — the clone is private.
--    It can never fail the clone. Copy: lib/notifications/describe.ts.
--
-- 4. CREDIT. deck_remix_credit(deck) — for a caller who may open the clone
--    (public; unlisted by its id; their own): one row when it is a clone,
--    the source's slug, title and owner's handle only while the source is
--    PUBLIC (or the caller's own), else nulls ("Remixed from another
--    deck": never an unlisted or private deck's name or link). No row: not
--    a clone.
--
-- 5. SIMILAR DECKS. list_similar_decks(deck, limit) — for a PUBLIC,
--    non-empty deck, other public non-empty decks of real creators
--    (owner_is_creator, 0149's anti-spam rule) that share its COMMANDER, or
--    its colour identity AND at least 4 cards (SIMILAR_DECKS_MIN_SHARED in
--    lib/decks/similar-decks.ts, held to this by a test). Cards are matched
--    only by what every visitor reads: a printing by its real card's name,
--    a PUBLIC PipGlyph card by its id — never a hidden entry; basic lands,
--    the sideboard and the maybeboard don't count, and neither does a
--    STAPLE: a card in more than 10 % of the public non-empty decks AND in
--    more than 20 of them (SIMILAR_DECKS_STAPLE_SHARE /
--    SIMILAR_DECKS_STAPLE_MIN_DECKS — the floor keeps a small catalogue
--    from calling every card a staple), so Sol Ring and Command Tower alone
--    never make two decks "similar" (a shared COMMANDER still does). The
--    "same commander or ≥ 4 shared" filter runs BEFORE any colour is read:
--    only that shortlist's colours are computed. A deck's colours are its
--    entries' letters, an entry with none (a card added from the creator:
--    deck_cards.color_identity is '{}') falling back to its PUBLIC card's
--    own colours (cards.color_identity words → letters; its frame colour,
--    so a gold or colourless frame adds none). Ranked by a shared
--    commander, then shared cards, then likes. SECURITY DEFINER (one join,
--    not 0152's policy per row), so every filter is stated here; it reads
--    nothing of a deck that isn't public. Cookie-free callers (the page's
--    public client, cached an hour: listSimilarDecks). A partial
--    expression index makes the name match an index lookup.
--
-- 6. SCRYFALL LOG. scryfall_calls' CHECK (0143's list + 'deck_tokens',
--    nothing dropped): a deck page view whose "Tokens & emblems" lookup
--    reached Scryfall is logged on the signed-in viewer
--    (lib/scryfall/rate-limit.ts — logged, never checked). Its grants and
--    RLS are 0013's / 0097's.
--
-- Grants (new projects auto-grant nothing — CLAUDE.md): the table is the
-- service role's alone (revoked from public, anon, authenticated);
-- clone_deck(uuid, text, text, uuid[]) is authenticated's and the service role's; deck_remix_credit()
-- and list_similar_decks() are anon's, authenticated's and the service
-- role's (PUBLIC revoked). No other grant changes.
--
-- Idempotent. Ships through a PR; never applied ad-hoc.

-- ===========================================================================
-- 1. Lineage
-- ===========================================================================

create table if not exists public.deck_remix_sources (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  source_deck_id uuid references public.decks (id) on delete set null,
  source_owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.deck_remix_sources is
  'Which deck a deck was cloned from (0164, TODO DK5.16): written by clone_deck(), read through deck_remix_credit(). No API role touches it (a deck id is its link, 0151).';

create index if not exists deck_remix_sources_source_idx
  on public.deck_remix_sources (source_deck_id)
  where source_deck_id is not null;

alter table public.deck_remix_sources enable row level security;

revoke all on table public.deck_remix_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.deck_remix_sources to service_role;

-- ===========================================================================
-- 3. The notification kind (before clone_deck, which writes it)
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
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending',
      'deck_cloned'
    )
  );

create unique index if not exists notifications_deck_cloned_once_idx
  on public.notifications (actor_id, (payload ->> 'deckId'))
  where type = 'deck_cloned';

-- ===========================================================================
-- 2. clone_deck
-- ===========================================================================

-- A draft of this file shipped a three-argument clone_deck on preview
-- branches; the four-argument one replaces it.
drop function if exists public.clone_deck(uuid, text, text);

create or replace function public.clone_deck(
  p_source_deck_id uuid,
  p_title text,
  p_slug text,
  p_masked_entry_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_source public.decks;
  v_new_id uuid;
  v_slug text;
  v_suffix text;
  v_attempt integer := 0;
  v_to_copy integer := 0;
  v_skipped integer := 0;
  v_copied integer := 0;
  v_masked uuid[] := coalesce(p_masked_entry_ids, '{}'::uuid[]);
begin
  if v_caller is null then
    raise exception 'not_authenticated: sign in to copy a deck'
      using errcode = 'insufficient_privilege';
  end if;
  if p_slug is null or btrim(p_slug) = '' or p_title is null or btrim(p_title) = '' then
    raise exception 'clone_invalid: a copy needs a title and a slug'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A deck the caller may open: public, unlisted (its id is its link — 0153's
  -- deck_entries_for_viewer asks the same) or their own.
  select d.* into v_source
  from public.decks d
  where d.id = p_source_deck_id
    and (d.visibility in ('public', 'unlisted') or d.owner_id = v_caller);
  if not found then
    raise exception 'deck_not_found: no deck to copy'
      using errcode = 'no_data_found';
  end if;

  -- What comes along (the header's rules), counted before anything is written.
  select count(*) filter (where k.kept), count(*) filter (where not k.kept)
    into v_to_copy, v_skipped
  from (
    select (
             e.scryfall_id is not null
             or (c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller))
             or (e.card_id is null
                 and coalesce(e.source not in ('creator', 'link', 'ai_generate', 'ai_remix'), true))
           ) as kept
    from public.deck_cards e
    left join public.cards c on c.id = e.card_id
    where e.deck_id = v_source.id
  ) k;

  if v_to_copy > 500 then
    raise exception 'deck_entry_limit: a deck holds at most 500 entries'
      using errcode = 'check_violation',
            detail = format('existing=0,adding=%s', v_to_copy);
  end if;

  -- The deck: private, the source's format, type and bracket. The slug is
  -- the app's, suffixed while taken (createDeckAction's slugCandidate).
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 50 then
      raise exception 'deck_slug_taken: every suffixed slug is taken'
        using errcode = 'unique_violation';
    end if;
    if v_attempt = 1 then
      v_slug := left(btrim(p_slug), 80);
    else
      v_suffix := '-' || v_attempt::text;
      v_slug := rtrim(left(btrim(p_slug), 80 - length(v_suffix)), '-') || v_suffix;
    end if;
    begin
      insert into public.decks (owner_id, title, slug, format, visibility, deck_type, bracket)
      values (v_caller, left(btrim(p_title), 120), v_slug, v_source.format, 'private',
              v_source.deck_type, v_source.bracket)
      returning id into v_new_id;
      exit;
    exception when unique_violation then
      -- Another deck's slug, or one a renamed deck still redirects from.
      null;
    end;
  end loop;

  insert into public.deck_cards (
    deck_id, board, quantity, position, scryfall_id, name, set_code,
    collector_number, type_line, mana_cost, mana_value, color_identity,
    rarity, image_url, card_id, source, featured_rank
  )
  select v_new_id, s.board, s.quantity,
         (row_number() over (order by s.position, s.created_at, s.id) - 1)::integer,
         s.scryfall_id,
         -- A kept printing whose card can't come along, masked for this
         -- caller (strong language): as the page shows it to them.
         case when s.masked then 'Private card' else s.name end,
         s.set_code, s.collector_number,
         case when s.masked then null else s.type_line end,
         s.mana_cost, s.mana_value, coalesce(s.color_identity, '{}'::text[]),
         s.rarity, s.image_url,
         case when s.keep_card then s.card_id end,
         s.source, s.featured_rank
  from (
    select e.*,
           (c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller)) as keep_card,
           (e.card_id is not null
            and not (c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller))
            and e.id = any(v_masked)) as masked
    from public.deck_cards e
    left join public.cards c on c.id = e.card_id
    where e.deck_id = v_source.id
  ) s
  where s.scryfall_id is not null
     or s.keep_card
     or (s.card_id is null
         and coalesce(s.source not in ('creator', 'link', 'ai_generate', 'ai_remix'), true));
  get diagnostics v_copied = row_count;

  -- Another owner's deck: the lineage ("Remixed from …") and the source's
  -- owner hears once per cloner and deck. A duplicate of the caller's own
  -- deck is neither (no credit to themselves, no notice).
  if v_source.owner_id <> v_caller then
    insert into public.deck_remix_sources (deck_id, source_deck_id, source_owner_id)
    values (v_new_id, v_source.id, v_source.owner_id);

    begin
      insert into public.notifications (recipient_id, actor_id, type, payload)
      values (
        v_source.owner_id, v_caller, 'deck_cloned',
        jsonb_build_object('deckId', v_source.id, 'slug', v_source.slug, 'title', v_source.title)
      )
      on conflict (actor_id, (payload ->> 'deckId')) where type = 'deck_cloned'
      do nothing;
    exception when others then
      raise warning 'clone_deck notification: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  return jsonb_build_object(
    'deckId', v_new_id,
    'slug', v_slug,
    'copied', v_copied,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.clone_deck(uuid, text, text, uuid[]) is
  'The caller''s PRIVATE copy of a deck they may open (public, unlisted by its id, or their own), with lineage and the source owner''s deck_cloned notice for another owner''s deck (0164, TODO DK5.16). A card the copy may not link is dropped; an entry with no printing whose card can''t come along is skipped; a kept printing the app masks for the caller is copied as "Private card"; ≤ 500 rows.';

revoke all on function public.clone_deck(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.clone_deck(uuid, text, text, uuid[]) to authenticated, service_role;

-- ===========================================================================
-- 4. deck_remix_credit
-- ===========================================================================

create or replace function public.deck_remix_credit(p_deck_id uuid)
returns table (source_slug text, source_title text, source_owner_username text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when shown then s.slug end,
    case when shown then s.title end,
    case when shown then p.username end
  from public.deck_remix_sources r
  join public.decks d on d.id = r.deck_id
  left join public.decks s on s.id = r.source_deck_id
  left join public.profiles p on p.id = s.owner_id
  cross join lateral (
    select coalesce(s.visibility = 'public' or s.owner_id = auth.uid(), false) as shown
  ) v
  where r.deck_id = p_deck_id
    and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid());
$$;

comment on function public.deck_remix_credit(uuid) is
  'A clone''s "remixed from" credit (0164): one row for a clone the caller may open — the source''s slug, title and owner''s handle while the source is public (or the caller''s own), else nulls.';

revoke all on function public.deck_remix_credit(uuid) from public;
grant execute on function public.deck_remix_credit(uuid) to anon, authenticated, service_role;

-- ===========================================================================
-- 5. list_similar_decks
-- ===========================================================================

create index if not exists deck_cards_printing_name_idx
  on public.deck_cards (lower(btrim(name)))
  where scryfall_id is not null;

create or replace function public.list_similar_decks(p_deck_id uuid, p_limit integer default 4)
returns setof public.decks
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select d.id
    from public.decks d
    where d.id = p_deck_id
      and d.visibility = 'public'
      and d.card_count > 0
  ),
  -- The source's cards as every visitor reads them: a printing by its real
  -- card's name, a public PipGlyph card (no printing) by its id. Basic lands
  -- and the side boards never count.
  source_keys as (
    select distinct
           case when e.scryfall_id is not null then lower(btrim(e.name)) end as name_key,
           case when e.scryfall_id is null then e.card_id end as card_key,
           e.board = 'commander' as commander
    from source s
    join public.deck_cards e on e.deck_id = s.id
    left join public.cards c on c.id = e.card_id
    where e.board in ('main', 'commander')
      and e.quantity > 0
      and coalesce(e.type_line, '') not ilike 'basic %'
      and (e.scryfall_id is not null or (c.id is not null and c.visibility = 'public'))
  ),
  hits as (
    select e.deck_id, 'n:' || k.name_key as card, k.commander and e.board = 'commander' as same_commander
    from source_keys k
    join public.deck_cards e
      on k.name_key is not null
     and e.scryfall_id is not null
     and lower(btrim(e.name)) = k.name_key
    where e.board in ('main', 'commander') and e.quantity > 0
    union all
    select e.deck_id, 'c:' || k.card_key::text, k.commander and e.board = 'commander'
    from source_keys k
    join public.deck_cards e
      on k.card_key is not null
     and e.card_id = k.card_key
    where e.board in ('main', 'commander') and e.quantity > 0
  ),
  -- Only public, non-empty decks are ever counted or listed.
  public_hits as (
    select h.deck_id, h.card, h.same_commander
    from hits h
    join public.decks d on d.id = h.deck_id
    where d.visibility = 'public' and d.card_count > 0
  ),
  -- A staple: in more than 10 % of the public non-empty decks and in more
  -- than 20 of them. It never counts as a shared card.
  staples as (
    select ph.card
    from public_hits ph
    cross join (
      select count(*) as n from public.decks where visibility = 'public' and card_count > 0
    ) t
    group by ph.card, t.n
    having count(distinct ph.deck_id) > greatest(20, t.n * 0.10)
  ),
  candidates as (
    select h.deck_id,
           count(distinct h.card) filter (where h.card not in (select card from staples)) as shared,
           bool_or(h.same_commander) as same_commander
    from public_hits h
    where h.deck_id <> p_deck_id
    group by h.deck_id
  ),
  -- The "same commander or ≥ 4 shared" filter BEFORE any colour is read;
  -- real creators only (owner_is_creator, once per shortlisted deck).
  shortlist as (
    select m.deck_id, m.shared, m.same_commander
    from candidates m
    join public.decks d on d.id = m.deck_id
    where (m.same_commander or m.shared >= 4)
      and public.owner_is_creator(d.owner_id)
  ),
  -- Colour identity: the letters of the entries every visitor reads; an
  -- entry with none (a card added from the creator) takes its PUBLIC
  -- card's own colours.
  colours as (
    select e.deck_id,
           coalesce(array_agg(distinct x order by x) filter (where x is not null), '{}'::text[]) as letters
    from public.deck_cards e
    left join public.cards c on c.id = e.card_id
    left join lateral unnest(
      case
        when cardinality(coalesce(e.color_identity, '{}'::text[])) > 0 then e.color_identity
        when c.id is not null and c.visibility = 'public' then array(
          select case w when 'white' then 'W' when 'blue' then 'U' when 'black' then 'B'
                        when 'red' then 'R' when 'green' then 'G' end
          from unnest(c.color_identity) as w
        )
        else '{}'::text[]
      end
    ) as x on true
    where e.deck_id in (select deck_id from shortlist union all select id from source)
      and e.board in ('main', 'commander')
      and e.quantity > 0
      and (e.scryfall_id is not null or (c.id is not null and c.visibility = 'public'))
    group by e.deck_id
  )
  select d.*
  from shortlist m
  join public.decks d on d.id = m.deck_id
  left join colours cc on cc.deck_id = m.deck_id
  left join colours sc on sc.deck_id = p_deck_id
  where m.same_commander
     or (m.shared >= 4 and coalesce(cc.letters, '{}') = coalesce(sc.letters, '{}'))
  order by m.same_commander desc, m.shared desc, d.likes_count desc, d.updated_at desc, d.id
  limit least(greatest(coalesce(p_limit, 4), 1), 12);
$$;

comment on function public.list_similar_decks(uuid, integer) is
  'Public decks like a PUBLIC deck (0164, TODO DK5.16): real creators'' public non-empty decks sharing its commander, or its colour identity and ≥ 4 cards (printings by name, public PipGlyph cards by id; no basics, no side boards, no staple — a card in > 10 % and > 20 of the public decks). Nothing for a deck that isn''t public.';

revoke all on function public.list_similar_decks(uuid, integer) from public;
grant execute on function public.list_similar_decks(uuid, integer) to anon, authenticated, service_role;

-- ===========================================================================
-- 6. scryfall_calls: the deck page's tokens lookup
-- ===========================================================================

alter table public.scryfall_calls
  drop constraint if exists scryfall_calls_action_check;

alter table public.scryfall_calls
  add constraint scryfall_calls_action_check
  check (action in ('search', 'named', 'import_art', 'deck_import', 'deck_import_commit', 'deck_tokens'));
