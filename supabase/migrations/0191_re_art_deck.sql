-- 0191_re_art_deck.sql — the Re-art deck beta tool (tool `re-art-deck`,
-- lib/tools/catalog.ts; /dashboard/tools/re-art-deck).
--
-- Re-art deck gives every card of one of the maker's decks NEW art in ONE
-- shared style (a style preset and the deck's own words about its world).
-- It is built on Bulk Customize (0186): a deck entry that stands for a REAL
-- card becomes the maker's own card exactly as a Bulk Customize batch makes
-- it (the same planner, the same save, the entry linked to its new card);
-- an entry that is already the maker's own card gets its new picture ON
-- that card (an edit of its art alone, through the card action). Another
-- creator's card is never touched, and an emblem is never re-arted.
--
-- 1. deck_art_styles — the deck's style, one row per deck: the preset and
--    the maker's words, and a VERSION that moves on every change. A card
--    painted in the current version is "in this style"; a run over the
--    deck skips it, and a change of style starts a new look. Written by the
--    server (service role) after the tool's gate; the owner reads their own.
--
-- 2. deck_reart_cards — which of a deck's cards Re-art has painted, in which
--    style version, and — for a card that had art of its own before — the
--    picture it had (previous_*), so the maker can put it back. Holding that
--    URL here is what keeps the old picture: the storage orphan sweep reads
--    every text column of every API table (scripts/lib/storage-orphans.mjs
--    URL_SOURCES). Written by the server after each step; the owner reads
--    their own. Gone with its deck or its card (ON DELETE CASCADE).
--
-- 3. ai_generation_jobs.kind gains 'deck_reart' (one step per card, claimed
--    by claim_job_step, written by patch_job_step, its credit settled with
--    its done-write — 0106 — and its plan server-only — 0163). Rewritten
--    whole from 0186's list. A partial unique index keeps ONE live run per
--    deck, so no card is painted (or charged) by two runs at once, and
--    patch_job_step is redefined (from 0106) so a cancelled job stays
--    cancelled when a step still in flight lands.
--
-- 4. card_ai_calls gains 'deck_reart_art' (one row per picture painted; one
--    credit each, two for a double-faced card). Rewritten whole from 0190's
--    list (0190 added 'draft_table_sheet'; 0187 does not redefine it).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ===========================================================================
-- 1. The deck's style
-- ===========================================================================

create table if not exists public.deck_art_styles (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- A style preset's id (lib/ai/presets.ts STYLE_PRESETS) or 'surprise'.
  preset text not null check (preset ~ '^[a-z][a-z0-9-]{1,39}$'),
  -- The maker's own words about the deck's world (lib/tools/re-art/model.ts
  -- REART_THEME_MAX), cleaned by the server.
  theme text not null default '' check (char_length(theme) <= 300),
  version integer not null default 1 check (version between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deck_art_styles_owner_idx
  on public.deck_art_styles (owner_id, updated_at desc);

comment on table public.deck_art_styles is
  'Re-art deck beta tool (0191): one art style per deck — a preset, the maker''s words, and a version that moves on every change. Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

alter table public.deck_art_styles enable row level security;

drop policy if exists "Deck art styles: owner reads" on public.deck_art_styles;
create policy "Deck art styles: owner reads"
  on public.deck_art_styles for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The owner is the deck's (a crafted service-role write could otherwise
-- file a style under another user's deck).
create or replace function public.deck_art_styles_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) then
    raise exception 'deck_art_style_not_owner'
      using errcode = '42501',
            hint = 'A deck''s art style belongs to the deck''s owner.';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists deck_art_styles_check_owner on public.deck_art_styles;
create trigger deck_art_styles_check_owner
  before insert or update on public.deck_art_styles
  for each row execute function public.deck_art_styles_check_owner();

revoke all on function public.deck_art_styles_check_owner() from public, anon, authenticated;

revoke all on public.deck_art_styles from public, anon, authenticated;
grant select on public.deck_art_styles to authenticated;
grant select, insert, update, delete on public.deck_art_styles to service_role;

-- ===========================================================================
-- 2. The cards Re-art painted
-- ===========================================================================

create table if not exists public.deck_reart_cards (
  deck_id uuid not null references public.decks (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  style_version integer not null check (style_version between 1 and 100000),
  -- The job whose step painted it last (no FK: a job row may be pruned).
  job_id uuid,
  -- The deck entry a MADE card came from (no FK: an entry may be removed).
  -- A run that finds it unlinked links it again instead of making a second
  -- card.
  entry_id uuid,
  -- The picture(s) Re-art painted last — what a re-roll replaces.
  art_url text check (art_url is null or char_length(art_url) <= 2048),
  back_art_url text check (back_art_url is null or char_length(back_art_url) <= 2048),
  -- True when Re-art MADE the card (from a real card's entry): there is no
  -- picture of the maker's to put back.
  made boolean not null default false,
  -- The card's own picture(s) before Re-art first painted it (the maker's
  -- "Put the old art back"). Never overwritten by a later re-roll.
  previous_art_url text check (previous_art_url is null or char_length(previous_art_url) <= 2048),
  previous_art_position jsonb
    check (previous_art_position is null or (jsonb_typeof(previous_art_position) = 'object' and octet_length(previous_art_position::text) <= 400)),
  previous_back_art_url text check (previous_back_art_url is null or char_length(previous_back_art_url) <= 2048),
  previous_back_art_position jsonb
    check (previous_back_art_position is null or (jsonb_typeof(previous_back_art_position) = 'object' and octet_length(previous_back_art_position::text) <= 400)),
  -- The artist credit(s) that went with that art (the AI picture carries
  -- the AI credit; the restore puts these back).
  previous_artist_credit text check (previous_artist_credit is null or char_length(previous_artist_credit) <= 200),
  previous_back_artist_credit text check (previous_back_artist_credit is null or char_length(previous_back_artist_credit) <= 200),
  painted_at timestamptz not null default now(),
  primary key (deck_id, card_id)
);

create index if not exists deck_reart_cards_card_idx on public.deck_reart_cards (card_id);
create index if not exists deck_reart_cards_entry_idx on public.deck_reart_cards (entry_id) where entry_id is not null;
create index if not exists deck_reart_cards_owner_idx on public.deck_reart_cards (owner_id, painted_at desc);

comment on table public.deck_reart_cards is
  'Re-art deck beta tool (0191): the deck''s cards Re-art painted, in which style version, and the picture an existing card had before (previous_*: kept so the maker can put it back — the storage orphan sweep keeps any URL a text column names). Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

alter table public.deck_reart_cards enable row level security;

drop policy if exists "Deck re-art cards: owner reads" on public.deck_reart_cards;
create policy "Deck re-art cards: owner reads"
  on public.deck_reart_cards for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The deck AND the card are the row owner's own.
create or replace function public.deck_reart_cards_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) or not exists (
    select 1 from public.cards c where c.id = new.card_id and c.owner_id = new.owner_id
  ) then
    raise exception 'deck_reart_card_not_owner'
      using errcode = '42501',
            hint = 'Re-art records only its owner''s own cards on their own decks.';
  end if;
  return new;
end;
$$;

drop trigger if exists deck_reart_cards_check_owner on public.deck_reart_cards;
create trigger deck_reart_cards_check_owner
  before insert or update on public.deck_reart_cards
  for each row execute function public.deck_reart_cards_check_owner();

revoke all on function public.deck_reart_cards_check_owner() from public, anon, authenticated;

revoke all on public.deck_reart_cards from public, anon, authenticated;
grant select on public.deck_reart_cards to authenticated;
grant select, insert, update, delete on public.deck_reart_cards to service_role;

-- ===========================================================================
-- 3. The job kind
-- ===========================================================================

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_kind_check;

alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_kind_check
  check (kind in ('deck', 'deck_remix', 'card', 'card_remix', 'card_fill', 'bulk_customize', 'deck_reart'));

-- ONE live Re-art run per deck: two starts at the same moment (two tabs, a
-- double press) can't both insert one — the second gets a unique violation
-- and is told to wait. The start closes (cancels) an older stopped run
-- before it inserts. (The plan is server-only; `request` names the deck.)
create unique index if not exists ai_generation_jobs_one_live_reart_per_deck
  on public.ai_generation_jobs (owner_id, (request->>'deck_id'))
  where kind = 'deck_reart' and status = 'generating';

-- A CANCELLED job stays cancelled. patch_job_step (0106) recomputed the
-- status from the steps and so wrote 'generating' back on a cancelled job
-- whose step was still in flight — which re-opened it (claim_job_step
-- refuses a cancelled job: 0073 "closed for good"), and with the index above
-- would have raised a unique violation and LOST that step's done-write and
-- its settle_spend. The 0106 body, with that one change; the step is still
-- merged and its charge still settled. Same grants as 0106.
create or replace function public.patch_job_step(
  p_job_id uuid,
  p_step_key text,
  p_patch jsonb
) returns public.ai_generation_jobs
language plpgsql
security invoker
as $$
declare
  v_job public.ai_generation_jobs;
  v_steps jsonb;
  v_status text;
  v_spend_ref text := nullif(p_patch->>'spend_ref', '');
begin
  select * into v_job
    from public.ai_generation_jobs
    where id = p_job_id
    for update;
  if not found then
    return null;
  end if;

  select jsonb_agg(
           case when elem->>'key' = p_step_key then elem || p_patch else elem end
           order by ord
         )
    into v_steps
    from jsonb_array_elements(v_job.steps) with ordinality as t(elem, ord);

  -- Honest terminal states: 'done' only when EVERY step succeeded;
  -- successes + failures = 'done_with_errors'; all failures = 'failed'.
  -- A cancelled job keeps its status (0191).
  v_status := case
    when v_job.status = 'cancelled' then 'cancelled'
    when exists (
      select 1 from jsonb_array_elements(v_steps) e
      where e->>'status' in ('pending', 'running')
    ) then 'generating'
    when not exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'failed'
    ) then 'done'
    when exists (
      select 1 from jsonb_array_elements(v_steps) e where e->>'status' = 'done'
    ) then 'done_with_errors'
    else 'failed'
  end;

  update public.ai_generation_jobs
    set steps = v_steps, status = v_status, updated_at = now()
    where id = p_job_id
    returning * into v_job;

  -- Settle the charge that completed this step, atomically with the step
  -- write. A stamped ref with no ledger row is worth a log line, never a
  -- failed patch — the work is already committed.
  if p_patch->>'status' = 'done' and v_spend_ref is not null then
    if not public.settle_spend(v_spend_ref) then
      raise warning 'patch_job_step: no ledger spend for ref % (job %, step %)',
        v_spend_ref, p_job_id, p_step_key;
    end if;
  end if;

  return v_job;
end;
$$;

revoke all on function public.patch_job_step(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.patch_job_step(uuid, text, jsonb) to service_role;

-- ===========================================================================
-- 4. The AI label
-- ===========================================================================

alter table public.card_ai_calls
  drop constraint if exists card_ai_calls_action_check;

alter table public.card_ai_calls
  add constraint card_ai_calls_action_check check (
    action = any (array[
      'improve_wording',
      'suggest_cost',
      'suggest_rarity',
      'generate_flavor',
      'generate_art_prompt',
      'check_balance',
      'generate_from_concept',
      'generate_random_card',
      'generate_random_art',
      'fill_card',
      'generate_deck',
      'remix_card',
      'remix_art',
      'generate_set_icon',
      'generate_deck_cards',
      'generate_card_ideas',
      'generate_deck_ideas',
      'analyze_deck',
      'build_collection_deck',
      'bulk_customize_art',
      'draft_table_sheet',
      'deck_reart_art'
    ])
  );
