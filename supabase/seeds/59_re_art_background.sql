-- ---------------------------------------------------------------------------
-- 59_re_art_background.sql — Re-art deck's runs that keep painting after
-- their page is closed (migration 0218), so a preview branch, the dev
-- database and the local stack show the bell's words for one:
--
--   * dev_pro has ONE `reart_run` notification: "Re-art deck finished
--     re-arting “Re-art sampler”: 4 cards painted." It links to the deck in
--     the tool (52_re_art_deck.sql).
--
-- No row is seeded in deck_reart_background or deck_reart_background_tokens:
-- a carried run needs a live job and a live sign-in, and a paused one would
-- offer a "Continue it" that could only fail. Start a run to see those.
--
-- Never against production. Idempotent (NOT EXISTS). No credential. Skipped
-- when the account or the deck is missing.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.notifications (recipient_id, actor_id, type, payload, created_at)
select
  'd0000000-0000-4000-a000-000000000002'::uuid,
  null,
  'reart_run',
  jsonb_build_object(
    'jobId', null,
    'deckId', 'b0000000-0000-4000-a000-0000000000d1',
    'deckTitle', d.title,
    'state', 'finished',
    'reason', null,
    'painted', 4,
    'failed', 0,
    'waiting', 0,
    'seed', true
  ),
  now() - interval '3 hours'
from public.decks d
where d.id = 'b0000000-0000-4000-a000-0000000000d1'::uuid
  and d.owner_id = 'd0000000-0000-4000-a000-000000000002'::uuid
  and exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
  and not exists (
    select 1 from public.notifications n
    where n.recipient_id = 'd0000000-0000-4000-a000-000000000002'::uuid and n.type = 'reart_run'
  );
