-- 0125 — anon_render_hits: the limiter on ANONYMOUS live card renders
-- (TODO 7.8).
--
-- /api/cards/[id]/png renders a card LIVE (a Satori render per request) when
-- it can't serve the stored bake: a Square PNG or a JPEG where a corner keeps
-- what was drawn there (the art-to-edge templates, the drawn top corners of
-- Bloomburrow, LOTR and Tarkir draconic), or any download of a card with no
-- servable bake (a sweep window). A signed-out caller's live renders are
-- counted here and capped (lib/cards/anon-render-limit.ts); signed-in
-- viewers, stored-bake serves and 304s never reach it.
--
--   key_hash      HMAC-SHA-256 of the caller's network (an IPv4 address or an
--                 IPv6 /64) under the server's secret, 32 hex digits. No raw
--                 identifier is stored (the funnel rule: anonymous rows carry
--                 none), and without the secret a key can't be tied back to
--                 an address.
--   window_start  the minute (date_trunc) the hits fell in
--   hits          live renders allowed in that minute
--
-- Writes: ONLY through hit_anon_render_limit(key, per_minute, per_hour),
-- called by the route with the service role (it has no session to write
-- with). Under a per-key advisory lock it reads the current minute and the
-- last hour; over either limit it answers (false, seconds until a slot
-- frees) and counts nothing, else it counts the hit and answers (true, 0).
-- Each call first drops every window the hour no longer reads, so the table
-- holds at most an hour of minutes per active key — no prune job.
-- Reads: nobody else. RLS on with no policy, the API roles revoked: the
-- table and the function are service-role only.
--
-- Ships through a PR; never applied ad-hoc.

create table if not exists public.anon_render_hits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$'),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (key_hash, window_start)
);

create index if not exists anon_render_hits_window_idx
  on public.anon_render_hits (window_start);

alter table public.anon_render_hits enable row level security;

create or replace function public.hit_anon_render_limit(
  p_key_hash text,
  p_per_minute integer,
  p_per_hour integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_minute integer;
  v_hour integer;
  v_oldest timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{32}$' then
    raise exception 'anon render limit: the key must be 32 hex digits';
  end if;
  if p_per_minute is null or p_per_minute < 1
     or p_per_hour is null or p_per_hour < p_per_minute then
    raise exception 'anon render limit: bad limits (% / %)', p_per_minute, p_per_hour;
  end if;

  -- One call per key at a time: two concurrent renders can't both slip in
  -- under the limit.
  perform pg_advisory_xact_lock(hashtextextended('anon_render_hits:' || p_key_hash, 0));

  -- Every key's windows the hour no longer reads.
  delete from public.anon_render_hits as h
   where h.window_start <= v_window - interval '1 hour';

  select coalesce(sum(h.hits) filter (where h.window_start = v_window), 0)::integer,
         coalesce(sum(h.hits), 0)::integer,
         min(h.window_start)
    into v_minute, v_hour, v_oldest
    from public.anon_render_hits as h
   where h.key_hash = p_key_hash
     and h.window_start > v_window - interval '1 hour';

  if v_minute >= p_per_minute then
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now()))))::integer;
    return;
  end if;

  if v_hour >= p_per_hour then
    -- The oldest counted minute leaves the hour at window_start + 1 hour.
    return query
    select false,
           greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - now()))))::integer;
    return;
  end if;

  insert into public.anon_render_hits as h (key_hash, window_start, hits)
  values (p_key_hash, v_window, 1)
  on conflict (key_hash, window_start) do update set hits = h.hits + 1;

  return query select true, 0;
end;
$$;

-- Grants (every migration states them — new projects don't auto-grant, and
-- production auto-grants new objects to the API roles, so the revokes make
-- both match). Functions are executable by PUBLIC by default: revoked too.
revoke all on table public.anon_render_hits from public, anon, authenticated;
grant select, insert, update, delete on table public.anon_render_hits to service_role;

revoke all on function public.hit_anon_render_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.hit_anon_render_limit(text, integer, integer)
  to service_role;
