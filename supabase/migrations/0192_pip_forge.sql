-- 0192_pip_forge.sql — the Pip Forge beta tool's pips (tool `pip-forge`,
-- lib/tools/catalog.ts; /dashboard/tools/pip-forge).
--
-- A forged pip is one glyph FLUX drew from its maker's words, cleaned for
-- card size and painted on PipGlyph's own disc, plus the COLOUR CARD a text
-- call wrote for it (name, philosophy, values, mechanics with one new
-- keyword, what it can't do, a basic land type and its gap on a six-colour
-- wheel). Its two files live in the maker's own set-covers folder (written
-- by the service role through lib/media/user-storage.ts):
--   pip-<version>.png    the pip, 256 px — the custom-pip format
--   glyph-<v0>.png       the glyph alone, what a new disc colour is painted
--                        from (no AI)
-- `files` holds their public URLs, which the storage orphan sweep reads like
-- every other text column (scripts/lib/storage-orphans.mjs URL_SOURCES). A
-- recolour writes a new pip version and points the row at it.
--
-- A forged pip is NOT one of the maker's six overrides: "Use as a pip" copies
-- its PNG into custom_pips through the one custom-pip writer
-- (lib/pips/write-pip.ts) — custom_pips is untouched here. Never a card: no
-- card limit.
--
-- Access: the owner's own rows, and only while the tool is open to them
-- (has_tool_access, 0182) — a tester whose grant ends keeps the rows (and
-- every override keeps its copy) but reads none until the tool is theirs
-- again. Rows are WRITTEN by the server alone (the forge route and the
-- recolour action, after their own access, credit and moderation checks):
-- the URLs in `files` must be the server's own uploads, the colour card the
-- server's own read of the model's answer. The owner may rename (the `name`
-- column alone) and delete a row.
--
-- The AI label `forge_pip` (one credit a pip) joins card_ai_calls' list —
-- rewritten WHOLE from 0190's, the latest that defines it.
--
-- No tool_releases row: like every new tool, Pip Forge ships admin-only on
-- production plus the testers an admin grants at /admin/tools, until an
-- admin releases it (tester grants for previews live in the seed alone).
--
-- Grants are explicit (0097). Idempotent. Ships through a PR; never applied
-- ad-hoc.

-- ===========================================================================
-- 1. forged_pips
-- ===========================================================================

create table if not exists public.forged_pips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  prompt text not null check (char_length(prompt) between 1 and 400),
  idea text check (idea is null or char_length(idea) between 1 and 600),
  disc_color text not null check (disc_color ~ '^#[0-9a-f]{6}$'),
  version uuid not null,
  files jsonb not null
    check (jsonb_typeof(files) = 'object' and octet_length(files::text) <= 2000),
  colour_card jsonb not null
    check (jsonb_typeof(colour_card) = 'object' and octet_length(colour_card::text) <= 12000),
  legibility_16 numeric(4, 3) not null check (legibility_16 >= 0 and legibility_16 <= 1),
  legibility_24 numeric(4, 3) not null check (legibility_24 >= 0 and legibility_24 <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forged_pips_owner_recent_idx
  on public.forged_pips (owner_id, updated_at desc);

comment on table public.forged_pips is
  'Pip Forge beta tool (0192): a maker''s forged pips — the current pip file and its glyph (files: pip / glyph in set-covers), its disc colour, the colour card the AI wrote for it, and its 16 / 24 px legibility. Written by the server only; the owner reads, renames and deletes while has_tool_access(''pip-forge''). Never an override by itself (custom_pips holds a copy), never a card.';

alter table public.forged_pips enable row level security;

drop policy if exists "Forged pips: owner reads" on public.forged_pips;
create policy "Forged pips: owner reads"
  on public.forged_pips for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('pip-forge'));

drop policy if exists "Forged pips: owner renames" on public.forged_pips;
create policy "Forged pips: owner renames"
  on public.forged_pips for update
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('pip-forge'))
  with check (owner_id = (select auth.uid()) and public.has_tool_access('pip-forge'));

drop policy if exists "Forged pips: owner deletes" on public.forged_pips;
create policy "Forged pips: owner deletes"
  on public.forged_pips for delete
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('pip-forge'));

-- No insert policy: an API role never writes a row (the service role does).

-- updated_at is the server's (the library's "recent first" order); an
-- update never moves a row to another owner or rewrites its birth.
create or replace function public.forged_pips_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists forged_pips_touch on public.forged_pips;
create trigger forged_pips_touch
  before insert or update on public.forged_pips
  for each row execute function public.forged_pips_touch();

revoke all on function public.forged_pips_touch() from public, anon, authenticated;

revoke all on public.forged_pips from public, anon, authenticated;
grant select, delete on public.forged_pips to authenticated;
grant update (name) on public.forged_pips to authenticated;
grant select, insert, update, delete on public.forged_pips to service_role;

-- ===========================================================================
-- 2. The AI label
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
      'forge_pip'
    ])
  );
