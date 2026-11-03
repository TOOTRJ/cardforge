-- 0162 — AI provenance (TODO CP1, owner 2026-10-30): the card page says how
-- much of a card AI made — "Card generated with AI", "AI helped with parts
-- of this card", "Art generated with AI" — and the label FOLLOWS EDITS. The
-- vocabulary and the page's rule are lib/cards/ai-provenance.ts; the
-- server's writers lib/cards/ai-provenance-server.ts.
--
-- 1. cards.ai_fields (text[], NOT NULL, default '{}'): the PARTS of the card
--    whose current content AI wrote — 'title', 'cost', 'type_line',
--    'rules_text', 'flavor_text', 'stats', 'art' and the second face's
--    'back.…' twins. A CHECK keeps it to that list. Not an edit:
--    set_cards_updated_at ignores it (a provenance write after a save, or a
--    derived art part, moves no "dateModified").
--
-- 2. card_ai_art_url(url): true for the address of a picture the server's
--    AI art store wrote — `…/storage/v1/object/public/card-art/<uuid>/ai-…`.
--    Only lib/ai/random-art.ts persistGeneratedArt names an object `ai-…`
--    (every upload, import and watermark has another name), no user has
--    written storage since 0126, and a remix's copy of an AI picture keeps
--    the prefix (lib/cards/remix-media.ts). Immutable, pure.
--
-- 3. cards_track_ai_fields (BEFORE INSERT OR UPDATE, every row; SECURITY
--    INVOKER on purpose: current_user is the caller's role):
--    * an API role (anon / authenticated) never writes the list: an INSERT
--      naming a part, or an UPDATE changing the list, is refused with
--      insufficient_privilege — a user can neither mark a hand-made card as
--      AI nor strip the label by a direct API write;
--    * an API role's UPDATE that CHANGES a text part's content drops that
--      part (the maker rewrote it — per part, from the columns that changed,
--      never guessed from the text; CLAUDE.md's edit rule makes a changed
--      column a field the maker touched). A part is its columns
--      (card_ai_field_paths, held to lib/cards/ai-provenance.ts
--      AI_FIELD_PATHS by a unit test; the rules part is `rules_text` AND
--      `face_content`, the rows a walker / saga / station draws first);
--      "changed" reads JSON null, "" and [] as one empty value — but
--      `printed_types`' NULL (the built line) and "" (emptied) as two;
--    * the ART parts are re-derived on EVERY write, by every role, from the
--      picture's address (2): an AI picture replaced by the maker's own
--      upload drops the label by itself, and the AI paths need no writer
--      for it;
--    * the service role (the server's AI paths) and the database owner keep
--      the text parts they write.
--
-- 4. add_card_ai_fields(card, owner, parts): the server's one writer of
--    text parts (the AI jobs for the cards they write; the card actions for
--    the parts the creator claims once a receipt matches). Adds, never
--    removes; only the owner's card. Service role only.
--
-- 5. card_ai_receipts: what the AI wrote, as the server received it — a
--    card_fill job's fields, the cards a card / deck job designed and every
--    "Get ideas" batch, each written when the server PLANS it — so a
--    creator's claim ("this field still holds the AI's text") and an AI
--    job's own marking are checked against a row no user can write (a job
--    row's plan is owner-insertable, 0059, so it is never the proof). Service role only (RLS on, no policy); the
--    weekly prune keeps 90 days (lib/cards/ai-provenance-server.ts reads
--    30).
--
-- 6. Backfill — only where a server-written row PROVES it:
--    a. art: every card whose picture (either face) is in the AI art store
--       (2) gets 'art' / 'back.art' — the trigger derives it on a no-op
--       update of the rows that qualify;
--    b. text: a card an AI JOB created — an ai_generation_jobs step of kind
--       'card' / 'deck' / 'deck_remix' with status 'done' naming the card,
--       by the card's owner, AND a server-written trace of that step: the
--       credit_ledger spend whose key is the step's spend_ref (the charge
--       that completed it), or the card's picture in the AI art store. (Job
--       rows are owner-INSERTABLE — 0059's insert policy — so a job row
--       alone proves nothing.) Its text parts are marked only where the
--       card STILL holds the job's text: for 'card' / 'deck', each part
--       equal to the plan's designed card (print typography folded on both
--       sides — quotes, dashes, a line's list mark, case, spaces — and a
--       cost compared as its pips in any order); for
--       'deck_remix', the title the AI renamed it to (the step's label, when
--       it differs from the printing's name).
--    NOT backfilled: AI fills and ideas poured into the creator (a fill's
--    row names no card for a new one, and idea batches were owner-written)
--    — those cards say nothing until the maker saves them again with a
--    fill. The owner's read-only production count is in the PR body.
--
-- Grants (CLAUDE.md "Every migration states its grants"; revoke first — a
-- new project grants nothing, prod's old one auto-grants):
--   * card_ai_receipts: service_role only;
--   * add_card_ai_fields: service_role only;
--   * card_ai_art_url, card_ai_field_paths, card_ai_norm: pure helpers the
--     trigger calls — and a trigger's calls run as the CALLER, so every role
--     that writes a card keeps EXECUTE on them (revoked from PUBLIC, granted
--     to anon, authenticated and service_role by name; they read no table);
--   * track_card_ai_fields (trigger): no API role may call it (revoked; a
--     trigger fires regardless of EXECUTE);
--   * cards.ai_fields rides 0097's table-level privileges on public.cards —
--     the trigger is its gate.
--
-- Ships through a PR; never applied ad-hoc.

-- The ALTERs and the trigger take an ACCESS EXCLUSIVE lock on public.cards:
-- give up after 10 s rather than queue every card read behind a long one.
set local lock_timeout = '10s';

-- 1. The column ---------------------------------------------------------------

alter table public.cards
  add column if not exists ai_fields text[] not null default '{}';

comment on column public.cards.ai_fields is
  'The parts of the card whose current content AI wrote (TODO CP1, 0162): title, cost, type_line, rules_text, flavor_text, stats, art and back.… — written only by the server (add_card_ai_fields); a part an API-role update changes is dropped and the art parts are derived from the picture''s address (cards_track_ai_fields). Not an edit (set_cards_updated_at ignores it).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cards_ai_fields_known'
      and conrelid = 'public.cards'::regclass
  ) then
    alter table public.cards
      add constraint cards_ai_fields_known
      check (
        ai_fields <@ array[
          'title', 'cost', 'type_line', 'rules_text', 'flavor_text', 'stats', 'art',
          'back.title', 'back.cost', 'back.type_line', 'back.rules_text', 'back.flavor_text', 'back.stats', 'back.art'
        ]::text[]
      );
  end if;
end;
$$;

-- 2. The helpers --------------------------------------------------------------

create or replace function public.card_ai_art_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_url ~ '/storage/v1/object/public/card-art/[0-9a-fA-F-]{36}/ai-[^/]*$', false);
$$;

-- The columns each TEXT part stands for (lib/cards/ai-provenance.ts
-- AI_FIELD_PATHS — a unit test holds the two tables together).
create or replace function public.card_ai_field_paths()
returns table (part text, path text[])
language sql
immutable
set search_path = ''
as $$
  values
    ('title', array['title']),
    ('cost', array['cost']),
    ('type_line', array['card_type']),
    ('type_line', array['supertype']),
    ('type_line', array['subtypes']),
    ('type_line', array['printed_types']),
    ('rules_text', array['rules_text']),
    ('rules_text', array['face_content']),
    ('flavor_text', array['flavor_text']),
    ('stats', array['power']),
    ('stats', array['toughness']),
    ('stats', array['loyalty']),
    ('stats', array['defense']),
    ('back.title', array['back_face', 'title']),
    ('back.cost', array['back_face', 'cost']),
    ('back.type_line', array['back_face', 'card_type']),
    ('back.type_line', array['back_face', 'supertype']),
    ('back.type_line', array['back_face', 'subtypes']),
    ('back.type_line', array['back_face', 'printed_types']),
    ('back.rules_text', array['back_face', 'rules_text']),
    ('back.flavor_text', array['back_face', 'flavor_text']),
    ('back.stats', array['back_face', 'power']),
    ('back.stats', array['back_face', 'toughness']),
    ('back.stats', array['back_face', 'loyalty']),
    ('back.stats', array['back_face', 'defense'])
$$;

-- One spelling of "empty": a missing key, JSON null, "" and [] alike (the
-- editor resends a second face whole; an emptied field may travel as "").
-- Never for `printed_types` (the trigger reads it raw, JSON null = missing):
-- there NULL is the built line and "" an emptied one — they print
-- differently (TODO 3b.16).
create or replace function public.card_ai_norm(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_value in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then null
    else p_value
  end;
$$;

-- 3. The trigger --------------------------------------------------------------

create or replace function public.track_card_ai_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_api boolean := current_user in ('anon', 'authenticated');
  v_text text[];
  v_new jsonb;
  v_old jsonb;
begin
  if v_api then
    if tg_op = 'INSERT' then
      if cardinality(coalesce(new.ai_fields, '{}'::text[])) > 0 then
        raise exception 'ai_fields_server_only: only the server marks what AI made'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.ai_fields is distinct from old.ai_fields then
      raise exception 'ai_fields_server_only: only the server marks what AI made (an edit of the content clears it)'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The text parts the row keeps.
  v_text := array(
    select distinct part from unnest(coalesce(new.ai_fields, '{}'::text[])) as part
    where part not in ('art', 'back.art')
  );

  -- An API role's edit drops every text part whose content it changed.
  if v_api and tg_op = 'UPDATE' and cardinality(v_text) > 0 then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    v_text := array(
      select kept from unnest(v_text) as kept
      where not exists (
        select 1 from public.card_ai_field_paths() as p
        where p.part = kept
          and case
            when p.path[cardinality(p.path)] = 'printed_types'
              then nullif(v_new #> p.path, 'null'::jsonb) is distinct from nullif(v_old #> p.path, 'null'::jsonb)
            else public.card_ai_norm(v_new #> p.path) is distinct from public.card_ai_norm(v_old #> p.path)
          end
      )
    );
  end if;

  -- The pictures, from their addresses — for every role, on every write.
  new.ai_fields := array(
    select distinct part from unnest(
      v_text
      || case when public.card_ai_art_url(new.art_url) then array['art'] else '{}'::text[] end
      || case when public.card_ai_art_url(new.back_face ->> 'art_url') then array['back.art'] else '{}'::text[] end
    ) as part
    order by part
  );
  return new;
end;
$$;

drop trigger if exists cards_track_ai_fields on public.cards;
create trigger cards_track_ai_fields
  before insert or update
  on public.cards
  for each row execute function public.track_card_ai_fields();

-- 4. The server's writer ------------------------------------------------------

create or replace function public.add_card_ai_fields(p_card_id uuid, p_owner_id uuid, p_fields text[])
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_fields text[];
begin
  update public.cards
  set ai_fields = array(
    select distinct part from unnest(ai_fields || coalesce(p_fields, '{}'::text[])) as part
    order by part
  )
  where id = p_card_id
    and owner_id = p_owner_id
  returning ai_fields into v_fields;
  return v_fields;
end;
$$;

-- 5. The receipts ------------------------------------------------------------

create table if not exists public.card_ai_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- 'fill': a card_fill job's fields; 'job': the cards a card / deck job
  -- designed; 'idea': a "Get ideas" batch. Each written when the SERVER
  -- planned it (never from a job row's plan, which its owner may insert).
  source text not null check (source in ('fill', 'idea', 'job')),
  -- An array of row-shaped values (title, cost, card_type, supertype,
  -- subtypes, rules_text, flavor_text, power, toughness, loyalty, defense,
  -- back_face) — one per fill, one per idea of a batch.
  "values" jsonb not null check (jsonb_typeof("values") = 'array'),
  created_at timestamptz not null default now()
);

comment on table public.card_ai_receipts is
  'What the AI wrote, as the server received it (TODO CP1, 0162): a card_fill job''s fields, the cards a card / deck job designed and every "Get ideas" batch, written when the server plans them. The card actions check a creator''s AI-field claim, and an AI job its own marking, against it. Service role only.';

create index if not exists card_ai_receipts_owner_created_idx
  on public.card_ai_receipts (owner_id, created_at desc);

alter table public.card_ai_receipts enable row level security;

-- 6 (first, so the backfill below moves no updated_at). -----------------------

create or replace function public.set_cards_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version'
        - 'moderation_hidden_at' - 'moderation_hidden_reason'
        - 'ai_fields')
     is distinct from
     (to_jsonb(old)
        - 'view_count' - 'likes_count' - 'share_count' - 'updated_at' - 'color_count'
        - 'rendered_image_url' - 'rendered_thumb_url' - 'rendered_back_image_url' - 'rendered_back_thumb_url' - 'rendered_at' - 'layout_version'
        - 'moderation_hidden_at' - 'moderation_hidden_reason'
        - 'ai_fields') then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

-- 7. Backfill ----------------------------------------------------------------

-- a. The pictures: a no-op write lets the trigger derive them (this runs as
--    the database owner — no part is dropped).
update public.cards
set ai_fields = ai_fields
where public.card_ai_art_url(art_url)
   or public.card_ai_art_url(back_face ->> 'art_url');

-- b. The text of the cards an AI job made. The fold is the backfill's alone
--    (dropped below): the plan holds the designer's raw text, the card the
--    text as print sets it (TODO 6.11).
--    Everything print typography (lib/validation/print-typography.ts) does to
--    a typed text is folded on BOTH sides, so the plan's keyboard text meets
--    the card's printed one: curly quotes and apostrophes (‘ ’ “ ”, all it
--    introduces) are the keyboard's; a line's opening list mark or
--    attribution dash (- * • —, "-- Serra") is one mark; any run of hyphens
--    or dashes with the spaces round it (`--`, ` - `, ` — `, "wait—what")
--    is one hyphen; case and runs of whitespace go. Folding both sides
--    alike can only make more texts EQUAL — a near-miss of the AI's own
--    text, never a hand-written one.
create or replace function public.card_ai_backfill_fold(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(p_text, ''), '’‘“”—–', '''''""--')),
          '^[ \t]*[-*•]+[ \t]*', '•', 'gn'),
        '\s*-+\s*', '-', 'g'),
      '\s+', ' ', 'g')),
    ''
  );
$$;

-- A mana cost as a bag of pips: the card stores the cost in print's pip
-- order (lib/cards/mana-order.ts normalizeManaCost), the plan as the
-- designer wrote it. A cost with text outside its braces is folded as text.
create or replace function public.card_ai_backfill_cost(p_cost text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(regexp_replace(coalesce(p_cost, ''), '\{[^}]*\}', '', 'g')) <> ''
      then public.card_ai_backfill_fold(p_cost)
    else (
      select string_agg(pip, '' order by pip)
      from (
        select upper(m[1]) as pip
        from regexp_matches(coalesce(p_cost, ''), '(\{[^}]*\})', 'g') as m
      ) as pips
    )
  end;
$$;

revoke all on function public.card_ai_backfill_fold(text) from public, anon, authenticated;
revoke all on function public.card_ai_backfill_cost(text) from public, anon, authenticated;

with job_steps as (
  select
    j.owner_id,
    j.kind,
    j.plan,
    s.step,
    (s.step ->> 'card_id')::uuid as card_id,
    (substring(s.step ->> 'key' from ':(\d+)$'))::int as step_index
  from public.ai_generation_jobs as j
  cross join lateral jsonb_array_elements(coalesce(j.steps, '[]'::jsonb)) as s(step)
  where j.kind in ('card', 'deck', 'deck_remix')
    and s.step ->> 'status' = 'done'
    and s.step ->> 'card_id' ~ '^[0-9a-fA-F-]{36}$'
    and s.step ->> 'key' ~ '^(card|remix):\d+$'
),
proven as (
  select js.*, c.id as cid
  from job_steps as js
  join public.cards as c on c.id = js.card_id and c.owner_id = js.owner_id
  where public.card_ai_art_url(c.art_url)
     or exists (
       select 1 from public.credit_ledger as l
       where l.user_id = js.owner_id
         and l.delta < 0
         and l.idempotency_key = js.step ->> 'spend_ref'
     )
),
designed as (
  select
    p.cid,
    p.kind,
    p.step,
    p.plan,
    case p.kind
      when 'card' then p.plan -> 'card'
      when 'deck' then p.plan -> 'cards' -> p.step_index
      else null
    end as d,
    case when p.kind = 'deck_remix' then p.plan -> 'entries' -> p.step_index else null end as entry
  from proven as p
),
parts as (
  select dd.cid, part
  from designed as dd
  join public.cards as c on c.id = dd.cid
  cross join lateral (
    select 'title' as part
    where dd.d is not null
      and public.card_ai_backfill_fold(c.title) = public.card_ai_backfill_fold(dd.d ->> 'title')
    union all
    select 'cost'
    where dd.d is not null and c.cost is not null
      and public.card_ai_backfill_cost(c.cost) = public.card_ai_backfill_cost(dd.d ->> 'cost')
    union all
    select 'type_line'
    where dd.d is not null and c.card_type is not null
      and c.printed_types is null
      and c.card_type = dd.d ->> 'card_type'
      and public.card_ai_backfill_fold(c.supertype) is not distinct from public.card_ai_backfill_fold(dd.d ->> 'supertype')
      and public.card_ai_backfill_fold(array_to_string(c.subtypes, ' '))
          is not distinct from public.card_ai_backfill_fold(
            (select string_agg(value, ' ') from jsonb_array_elements_text(coalesce(dd.d -> 'subtypes', '[]'::jsonb)))
          )
    union all
    select 'rules_text'
    where dd.d is not null and c.rules_text is not null
      and public.card_ai_backfill_fold(c.rules_text) = public.card_ai_backfill_fold(dd.d ->> 'rules_text')
    union all
    select 'flavor_text'
    where dd.d is not null and c.flavor_text is not null
      and public.card_ai_backfill_fold(c.flavor_text) = public.card_ai_backfill_fold(dd.d ->> 'flavor_text')
    union all
    select 'stats'
    where dd.d is not null
      and coalesce(c.power, c.toughness, c.loyalty, c.defense) is not null
      and public.card_ai_backfill_fold(c.power) is not distinct from public.card_ai_backfill_fold(dd.d ->> 'power')
      and public.card_ai_backfill_fold(c.toughness) is not distinct from public.card_ai_backfill_fold(dd.d ->> 'toughness')
      and public.card_ai_backfill_fold(c.loyalty) is not distinct from public.card_ai_backfill_fold(dd.d ->> 'loyalty')
      and public.card_ai_backfill_fold(c.defense) is not distinct from public.card_ai_backfill_fold(dd.d ->> 'defense')
    union all
    -- A deck remix renames each card (lib/ai/remix-names.ts): the step's
    -- label is the AI's name once it is done.
    select 'title'
    where dd.kind = 'deck_remix'
      and position(' // ' in coalesce(dd.step ->> 'label', '')) = 0
      and public.card_ai_backfill_fold(c.title) = public.card_ai_backfill_fold(dd.step ->> 'label')
      and public.card_ai_backfill_fold(dd.step ->> 'label') is distinct from public.card_ai_backfill_fold(dd.entry ->> 'name')
  ) as found
),
per_card as (
  select cid, array_agg(distinct part order by part) as found
  from parts
  group by cid
)
update public.cards as c
set ai_fields = array(
  select distinct part from unnest(c.ai_fields || pc.found) as part order by part
)
from per_card as pc
where c.id = pc.cid
  and not (pc.found <@ c.ai_fields);

drop function public.card_ai_backfill_cost(text);
drop function public.card_ai_backfill_fold(text);

-- Grants ---------------------------------------------------------------------

revoke all on table public.card_ai_receipts from public, anon, authenticated;
grant select, insert, delete on table public.card_ai_receipts to service_role;

revoke all on function public.add_card_ai_fields(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.add_card_ai_fields(uuid, uuid, text[]) to service_role;

-- (The trigger's calls run as the caller: every role that writes a card
-- needs these three. Pure; they read no table.)
revoke all on function public.card_ai_art_url(text) from public;
revoke all on function public.card_ai_field_paths() from public;
revoke all on function public.card_ai_norm(jsonb) from public;
grant execute on function public.card_ai_art_url(text) to anon, authenticated, service_role;
grant execute on function public.card_ai_field_paths() to anon, authenticated, service_role;
grant execute on function public.card_ai_norm(jsonb) to anon, authenticated, service_role;

revoke all on function public.track_card_ai_fields() from public, anon, authenticated;
