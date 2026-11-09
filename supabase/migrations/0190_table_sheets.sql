-- 0190_table_sheets.sql — the Rule 0 table sheet beta tool (tool
-- `rule0-sheet`, lib/tools/catalog.ts; the sheet lives at
-- /deck/<slug>/table-sheet, the tool's page at /dashboard/tools/rule0-sheet).
--
-- Before a Commander game the table has its "Rule 0" talk: the deck's
-- bracket, its plan, and which cards are custom or proxies. The sheet says
-- most of that from what the deck already stores (its bracket, its entries'
-- statuses, the Game Changers list in lib/tools/rule0/game-changers.ts);
-- what only the OWNER can say is stored here, one row per deck:
--
--   game_plan       how the deck plays (≤ 1000 characters);
--   win_conditions  how it wins, one per line (≤ 600);
--   table_notes     anything else to raise at the table (≤ 600);
--   shared          the owner's switch: anyone who can open the DECK may
--                   open its sheet (false = the owner's alone);
--   ai_drafted_at   when the plan was last drafted by AI (1 credit, the
--                   route /api/tools/rule0-sheet/draft — reserved, settled
--                   once written, refunded on failure).
--
-- 1. deck_table_sheets + its RLS:
--      * the owner reads, writes and deletes their own row while the tool is
--        open to them (has_tool_access, 0182) and the deck is theirs;
--      * anyone else reads a row only when it is SHARED, the deck reads for
--        them (the decks policy decides: public, or unlisted and NAMED by
--        the request's x-pipglyph-deck header — 0151, lib/decks/deck-link.ts;
--        a private deck never) AND the tool is still open to the deck's
--        OWNER (deck_table_sheet_live): a paused tool, or a tester whose
--        grant ended, takes the shared sheets down with it.
-- 2. tool_access_for(slug, user) — has_tool_access's rule for ANOTHER user
--    (the sheet's owner), internal: no API role executes it. Its body is
--    0182's with auth.uid() replaced by p_user, held equal by
--    tests/unit/db/table-sheets-migration.test.ts.
-- 3. deck_table_sheet_live(deck) — the shared-read check, definer: shared,
--    the deck public or unlisted, the tool open to its owner.
-- 4. card_ai_calls gains 'draft_table_sheet' (0186's list plus it).
--
-- Grants are explicit (0097): visitors (anon too — a table's guest has no
-- account) SELECT; the owner's writes are column grants. Idempotent. Ships
-- through a PR; never applied ad-hoc.

-- ===========================================================================
-- 2. The access rule for another user (internal)
-- ===========================================================================
create or replace function public.tool_access_for(p_slug text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      p.id,
      coalesce(p.is_admin, false) as is_admin,
      greatest(
        case
          when p.subscription_tier in ('plus', 'pro')
           and public.subscription_perks_on(p.subscription_status, p.payment_failed_at)
          then case p.subscription_tier when 'pro' then 2 else 1 end
          else 0
        end,
        case
          when p.comp_tier in ('plus', 'pro')
           and (p.comp_expires_at is null or p.comp_expires_at > now())
          then case p.comp_tier when 'pro' then 2 else 1 end
          else 0
        end
      ) as tier_rank
    from public.profiles p
    where p.id = p_user
  ),
  rel as (
    select r.release_tier, r.paused
    from public.tool_releases r
    where r.slug = p_slug
  )
  select coalesce((
    select me.is_admin
        or (
          not coalesce((select rel.paused from rel), false)
          and (
            exists (
              select 1 from rel
              where rel.release_tier is not null
                and me.tier_rank >= case rel.release_tier when 'pro' then 2 when 'plus' then 1 else 0 end
            )
            or exists (
              select 1 from public.tool_access_grants g
              where g.tool_slug = p_slug
                and g.user_id = me.id
                and (g.expires_at is null or g.expires_at > now())
            )
          )
        )
    from me
  ), false);
$$;

comment on function public.tool_access_for(text, uuid) is
  'has_tool_access (0182) for a given user instead of the caller (0190) — the same body with auth.uid() replaced by p_user (a test holds them equal). Internal: called by definer functions only (deck_table_sheet_live); no API role executes it.';

revoke all on function public.tool_access_for(text, uuid) from public, anon, authenticated;
grant execute on function public.tool_access_for(text, uuid) to service_role;

-- ===========================================================================
-- 1. deck_table_sheets
-- ===========================================================================
create table if not exists public.deck_table_sheets (
  deck_id uuid primary key references public.decks (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  game_plan text check (game_plan is null or char_length(game_plan) between 1 and 1000),
  win_conditions text check (win_conditions is null or char_length(win_conditions) between 1 and 600),
  table_notes text check (table_notes is null or char_length(table_notes) between 1 and 600),
  shared boolean not null default false,
  ai_drafted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deck_table_sheets_owner_idx
  on public.deck_table_sheets (owner_id, updated_at desc);

comment on table public.deck_table_sheets is
  'Rule 0 table sheet beta tool (0190): what only a deck''s owner can say before a game — the game plan, win conditions (one per line), table notes — and whether anyone who can open the deck may open its sheet (shared). Everything else on the sheet is derived from the deck at render time. Owner writes while has_tool_access(''rule0-sheet''); a shared row reads for anyone the deck reads for, while the tool is open to the deck''s owner.';

-- ===========================================================================
-- 3. The shared-read check
-- ===========================================================================
create or replace function public.deck_table_sheet_live(p_deck uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.deck_table_sheets s
    join public.decks d on d.id = s.deck_id
    where s.deck_id = p_deck
      and s.shared
      and d.owner_id = s.owner_id
      and d.visibility in ('public', 'unlisted')
      and public.tool_access_for('rule0-sheet', s.owner_id)
  );
$$;

comment on function public.deck_table_sheet_live(uuid) is
  'Whether a deck''s table sheet is open to visitors (0190): shared by its owner, the deck public or unlisted (never private), and the rule0-sheet tool still open to the deck''s owner. The read policy adds the caller''s own decks check (an unlisted deck only when the request names it).';

revoke all on function public.deck_table_sheet_live(uuid) from public, anon, authenticated;
grant execute on function public.deck_table_sheet_live(uuid) to anon, authenticated, service_role;

alter table public.deck_table_sheets enable row level security;

drop policy if exists "Table sheets: owner reads" on public.deck_table_sheets;
create policy "Table sheets: owner reads"
  on public.deck_table_sheets for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('rule0-sheet'));

-- A visitor: the deck reads for them (the decks policy — an unlisted deck
-- only when named by the request) AND the sheet is live.
drop policy if exists "Table sheets: shared reads" on public.deck_table_sheets;
create policy "Table sheets: shared reads"
  on public.deck_table_sheets for select
  to anon, authenticated
  using (
    shared
    and exists (select 1 from public.decks d where d.id = deck_id)
    and public.deck_table_sheet_live(deck_id)
  );

drop policy if exists "Table sheets: owner inserts" on public.deck_table_sheets;
create policy "Table sheets: owner inserts"
  on public.deck_table_sheets for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.has_tool_access('rule0-sheet')
    and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid()))
  );

drop policy if exists "Table sheets: owner updates" on public.deck_table_sheets;
create policy "Table sheets: owner updates"
  on public.deck_table_sheets for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('rule0-sheet'))
  with check (
    owner_id = (select auth.uid())
    and public.has_tool_access('rule0-sheet')
    and exists (select 1 from public.decks d where d.id = deck_id and d.owner_id = (select auth.uid()))
  );

drop policy if exists "Table sheets: owner deletes" on public.deck_table_sheets;
create policy "Table sheets: owner deletes"
  on public.deck_table_sheets for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('rule0-sheet'));

-- updated_at is the server's; the row's deck, owner and birth never move.
create or replace function public.deck_table_sheets_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.deck_id := old.deck_id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deck_table_sheets_touch on public.deck_table_sheets;
create trigger deck_table_sheets_touch
  before insert or update on public.deck_table_sheets
  for each row execute function public.deck_table_sheets_touch();

revoke all on function public.deck_table_sheets_touch() from public, anon, authenticated;

revoke all on public.deck_table_sheets from public, anon, authenticated;
grant select on public.deck_table_sheets to anon, authenticated;
grant insert (deck_id, owner_id, game_plan, win_conditions, table_notes, shared, ai_drafted_at)
  on public.deck_table_sheets to authenticated;
-- deck_id and owner_id are in the UPDATE grant only because an upsert's
-- ON CONFLICT DO UPDATE sets every column it was sent: the touch trigger
-- pins both to the old row, so an update can never move a sheet.
grant update (deck_id, owner_id, game_plan, win_conditions, table_notes, shared, ai_drafted_at)
  on public.deck_table_sheets to authenticated;
grant delete on public.deck_table_sheets to authenticated;
grant select, insert, update, delete on public.deck_table_sheets to service_role;

-- ===========================================================================
-- 4. The AI draft's label (0186's list plus it)
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
      'draft_table_sheet'
    ])
  );
