-- 0120 — frame_requests: the "most-requested missing frames" log (TODO 1.6).
--
-- One row per Scryfall import whose printing PipGlyph can't reproduce
-- exactly: the frame signature registry (lib/scryfall/frame-signatures.ts)
-- answered `nearest` or `unsupported`, or its `exact` frame isn't verified
-- in the card's colour yet. The admin page /admin/frame-requests counts the
-- rows per signature + set, and that order decides which frames get built
-- next (frames plan 4.7 / 4.11, the borderless and full-art families).
--
--   signature        a registry rule key (FRAME_SIGNATURE_KEYS) — validated
--                    in the app (lib/frames/frame-requests.ts), not here, so
--                    a new rule is a code change, not a migration
--   label            the registry's exactLabel ("Borderless frame")
--   set_code /       the printing imported (Scryfall set + collector number,
--   collector_number scryfall_id) — a sample link on the admin page
--   status           nearest | unsupported (an exact import writes nothing)
--   template         the frame the card landed on
--   art_flag         TODO 1.18: the imported art_crop is the M15 window on a
--                    borderless printing ('window-cropped') or carries printed
--                    frame pieces on a full-art / textless one ('frame-in-crop')
--   source           the import dialog, or the /create?deckCard pre-fill
--
-- Writes: ONLY through record_frame_request(), which stamps auth.uid() and
-- skips silently once the caller wrote 30 rows in the last hour (a user
-- clicking through printings can't flood the log). No insert/update/delete
-- policies: the API roles can't write the table directly.
-- Reads: admins. The select policy lets an admin session read rows; the
-- admin page reads the aggregate through admin_frame_request_counts()
-- (service role, called after the is_admin check — like admin_funnel_counts).
--
-- Ships through a PR; never applied ad-hoc.

create table if not exists public.frame_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  signature text not null check (char_length(signature) between 1 and 120),
  label text not null check (char_length(label) between 1 and 160),
  set_code text check (set_code is null or char_length(set_code) <= 10),
  collector_number text check (collector_number is null or char_length(collector_number) <= 16),
  scryfall_id uuid,
  status text not null check (status in ('nearest', 'unsupported')),
  template text check (template is null or char_length(template) <= 40),
  art_flag text check (art_flag is null or art_flag in ('window-cropped', 'frame-in-crop')),
  source text not null default 'import' check (source in ('import', 'deck_prefill')),
  created_at timestamptz not null default now()
);

create index if not exists frame_requests_signature_created_idx
  on public.frame_requests (signature, created_at desc);
create index if not exists frame_requests_created_idx
  on public.frame_requests (created_at);
-- record_frame_request's per-user hourly cap reads this.
create index if not exists frame_requests_user_created_idx
  on public.frame_requests (user_id, created_at desc)
  where user_id is not null;

alter table public.frame_requests enable row level security;

drop policy if exists "Frame requests: admin read" on public.frame_requests;
create policy "Frame requests: admin read"
  on public.frame_requests for select
  using (public.viewer_is_admin());

-- The one write path. Raises on bad input (the app validates first, so a
-- raise here is a bug, not a user error); returns quietly past the cap.
create or replace function public.record_frame_request(
  p_signature text,
  p_label text,
  p_set text,
  p_collector text,
  p_scryfall_id uuid,
  p_status text,
  p_template text,
  p_art_flag text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'record_frame_request: sign in first' using errcode = '42501';
  end if;
  if p_signature is null or char_length(p_signature) not between 1 and 120 then
    raise exception 'record_frame_request: bad signature' using errcode = '22023';
  end if;
  if p_label is null or char_length(p_label) not between 1 and 160 then
    raise exception 'record_frame_request: bad label' using errcode = '22023';
  end if;
  if p_set is not null and char_length(p_set) > 10 then
    raise exception 'record_frame_request: bad set' using errcode = '22023';
  end if;
  if p_collector is not null and char_length(p_collector) > 16 then
    raise exception 'record_frame_request: bad collector number' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('nearest', 'unsupported') then
    raise exception 'record_frame_request: bad status' using errcode = '22023';
  end if;
  if p_template is not null and char_length(p_template) > 40 then
    raise exception 'record_frame_request: bad template' using errcode = '22023';
  end if;
  if p_art_flag is not null and p_art_flag not in ('window-cropped', 'frame-in-crop') then
    raise exception 'record_frame_request: bad art flag' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('import', 'deck_prefill') then
    raise exception 'record_frame_request: bad source' using errcode = '22023';
  end if;

  -- 30 rows an hour per user is far past any real import session.
  if (
    select count(*)
    from public.frame_requests r
    where r.user_id = v_uid
      and r.created_at > now() - interval '1 hour'
  ) >= 30 then
    return;
  end if;

  insert into public.frame_requests (
    user_id, signature, label, set_code, collector_number, scryfall_id,
    status, template, art_flag, source
  ) values (
    v_uid, p_signature, p_label, p_set, p_collector, p_scryfall_id,
    p_status, p_template, p_art_flag, p_source
  );
end;
$$;

-- The admin page's one read: requests per signature + set since p_since
-- (null = all time), most requested first. label / status / template and
-- the sample printing come from the group's latest row.
create or replace function public.admin_frame_request_counts(p_since timestamptz default null)
returns table (
  signature text,
  label text,
  set_code text,
  status text,
  template text,
  n bigint,
  users bigint,
  last_seen timestamptz,
  sample_scryfall_id uuid,
  sample_collector text,
  art_flags text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.signature,
    (array_agg(r.label order by r.created_at desc))[1] as label,
    r.set_code,
    (array_agg(r.status order by r.created_at desc))[1] as status,
    (array_agg(r.template order by r.created_at desc))[1] as template,
    count(*)::bigint as n,
    count(distinct r.user_id)::bigint as users,
    max(r.created_at) as last_seen,
    (array_agg(r.scryfall_id order by r.created_at desc)
      filter (where r.scryfall_id is not null))[1] as sample_scryfall_id,
    (array_agg(r.collector_number order by r.created_at desc)
      filter (where r.collector_number is not null))[1] as sample_collector,
    coalesce(
      array_agg(distinct r.art_flag) filter (where r.art_flag is not null),
      '{}'::text[]
    ) as art_flags
  from public.frame_requests r
  where p_since is null or r.created_at >= p_since
  group by r.signature, r.set_code
  order by count(*) desc, max(r.created_at) desc
  limit 500
$$;

-- Grants (every migration states them — new projects don't auto-grant, and
-- production auto-grants everything, so the revokes make both match).
grant select on public.frame_requests to authenticated; -- RLS: admins only
grant select, insert, update, delete on public.frame_requests to service_role;
revoke all on public.frame_requests from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.frame_requests from authenticated;

revoke all on function public.record_frame_request(text, text, text, text, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.record_frame_request(text, text, text, text, uuid, text, text, text, text)
  to authenticated;

revoke all on function public.admin_frame_request_counts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_frame_request_counts(timestamptz)
  to service_role;
