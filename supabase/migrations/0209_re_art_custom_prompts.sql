-- 0209_re_art_custom_prompts.sql — Re-art deck (beta tool `re-art-deck`,
-- 0191): the maker's OWN prompts, for the deck and for single cards.
--
-- Until now a picture's prompt was a fixed template (the card's name, type
-- and a line of its text, then the deck's style block), with at most 300
-- characters of the maker's words in it. The maker can now write the deck's
-- prompt themselves, and give any card words of its own.
--
-- 1. deck_art_styles gains `mode` ('preset': the template and the style
--    block, as before — every stored row; 'custom': the maker's own prompt)
--    and `prompt` (that prompt, up to 1,500 characters; it may name
--    {card}, {name}, {type}, {flavor} and {rules}, filled in per card by
--    lib/tools/re-art/model.ts). The style's version moves on when either
--    changes, as for the preset and the theme (the server compares them).
--    The table's grants are table-level (0191), so they cover the columns.
--
-- 2. deck_reart_prompts — one card's own words, by deck ENTRY (a real
--    card's entry has no card of the maker's until a run makes one, and the
--    entry is what a run names): up to 600 characters, and `only_words`
--    (true: these words ARE the card's prompt; false: they are the card's
--    subject, painted in the deck's style or prompt). Written by the server
--    (service role) after the tool's gate; the owner reads their own while
--    the tool is open to them. Gone with its deck or its entry.
--
-- Nothing here is charged for, and no stored card changes. Grants are
-- explicit (0097). Idempotent. Ships through a PR; never applied ad-hoc.

-- ===========================================================================
-- 1. The deck's own prompt
-- ===========================================================================

alter table public.deck_art_styles
  add column if not exists mode text not null default 'preset',
  add column if not exists prompt text not null default '';

alter table public.deck_art_styles
  drop constraint if exists deck_art_styles_mode_check;
alter table public.deck_art_styles
  add constraint deck_art_styles_mode_check check (mode in ('preset', 'custom'));

-- lib/tools/re-art/model.ts REART_PROMPT_MAX, cleaned by the server.
alter table public.deck_art_styles
  drop constraint if exists deck_art_styles_prompt_check;
alter table public.deck_art_styles
  add constraint deck_art_styles_prompt_check check (char_length(prompt) <= 1500);

comment on column public.deck_art_styles.mode is
  'Re-art deck (0209): ''preset'' = the tool''s template with the preset and the theme; ''custom'' = the maker''s own prompt (column prompt).';
comment on column public.deck_art_styles.prompt is
  'Re-art deck (0209): the maker''s own prompt for every card of the deck (mode ''custom''), up to 1,500 characters; {card}, {name}, {type}, {flavor} and {rules} are filled in per card by the app.';

-- ===========================================================================
-- 2. One card's own words
-- ===========================================================================

create table if not exists public.deck_reart_prompts (
  deck_id uuid not null references public.decks (id) on delete cascade,
  entry_id uuid not null references public.deck_cards (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  -- lib/tools/re-art/model.ts REART_CARD_WORDS_MAX, cleaned by the server.
  prompt text not null check (char_length(prompt) between 1 and 600),
  -- True: the words are the card's whole prompt (the deck's style or prompt
  -- is left out). False: they are the card's subject, in the deck's look.
  only_words boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deck_id, entry_id)
);

create index if not exists deck_reart_prompts_entry_idx on public.deck_reart_prompts (entry_id);
create index if not exists deck_reart_prompts_owner_idx on public.deck_reart_prompts (owner_id, updated_at desc);

comment on table public.deck_reart_prompts is
  'Re-art deck beta tool (0209): one card''s own words for its picture, by deck entry — the card''s subject in the deck''s look, or (only_words) its whole prompt. Written by the server only; the owner reads their own while has_tool_access(''re-art-deck'').';

alter table public.deck_reart_prompts enable row level security;

drop policy if exists "Deck re-art prompts: owner reads" on public.deck_reart_prompts;
create policy "Deck re-art prompts: owner reads"
  on public.deck_reart_prompts for select
  to authenticated
  using (owner_id = (select auth.uid()) and public.has_tool_access('re-art-deck'));

-- The deck is the row owner's own, and the entry is one of that deck's (a
-- crafted service-role write could otherwise file words under another
-- user's deck, or on an entry of another deck).
create or replace function public.deck_reart_prompts_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.decks d where d.id = new.deck_id and d.owner_id = new.owner_id
  ) or not exists (
    select 1 from public.deck_cards dc where dc.id = new.entry_id and dc.deck_id = new.deck_id
  ) then
    raise exception 'deck_reart_prompt_not_owner'
      using errcode = '42501',
            hint = 'A card''s Re-art words belong to an entry of the owner''s own deck.';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists deck_reart_prompts_check_owner on public.deck_reart_prompts;
create trigger deck_reart_prompts_check_owner
  before insert or update on public.deck_reart_prompts
  for each row execute function public.deck_reart_prompts_check_owner();

revoke all on function public.deck_reart_prompts_check_owner() from public, anon, authenticated;

revoke all on public.deck_reart_prompts from public, anon, authenticated;
grant select on public.deck_reart_prompts to authenticated;
grant select, insert, update, delete on public.deck_reart_prompts to service_role;
