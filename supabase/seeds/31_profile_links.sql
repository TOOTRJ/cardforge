-- ---------------------------------------------------------------------------
-- 31_profile_links.sql — extra profile LINKS and STORE cards (migration
-- 0153), so a preview branch, the dev database and the local stack have a
-- profile to look at: dev_pro ("Priya Prosmith") with MTG-site, social and
-- support links and three store cards; dev_artist with two links and one
-- store. dev_free and dev_new keep none (the empty states).
--
-- Every URL is a made-up handle on the real platform's host, so it passes
-- the app's per-platform allow-lists (lib/profile/link-kinds.ts,
-- lib/profile/store-platforms.ts) and the profile draws it. No credential in
-- here (the repo is public).
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING; a row whose account is missing (this file run on its own) is
-- skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.profile_links (id, owner_id, kind, url, label, position)
select l.id, l.owner_id, l.kind, l.url, l.label, l.position
from (values
  ('e1530000-0000-4000-a000-000000000001'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'moxfield', 'https://moxfield.com/users/dev_pro_priya', null, 0),
  ('e1530000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'archidekt', 'https://archidekt.com/u/dev_pro_priya', 'My cube', 1),
  ('e1530000-0000-4000-a000-000000000003'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'twitch', 'https://www.twitch.tv/dev_pro_priya', null, 2),
  ('e1530000-0000-4000-a000-000000000004'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'patreon', 'https://www.patreon.com/devpropriya', null, 3),
  ('e1530000-0000-4000-a000-000000000005'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'kofi', 'https://ko-fi.com/devpropriya', null, 4),
  ('e1530000-0000-4000-a000-000000000006'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'other', 'https://pipglyph.com/help', 'Design notes', 5),
  ('e1530000-0000-4000-a000-000000000007'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'artstation', 'https://www.artstation.com/dev_artist_ari', null, 0),
  ('e1530000-0000-4000-a000-000000000008'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'reddit', 'https://www.reddit.com/user/dev_artist_ari', null, 1)
) as l (id, owner_id, kind, url, label, position)
where exists (select 1 from public.profiles where id = l.owner_id)
on conflict (id) do nothing;

insert into public.profile_stores (id, owner_id, platform, url, title, position)
select s.id, s.owner_id, s.platform, s.url, s.title, s.position
from (values
  ('e1531000-0000-4000-a000-000000000001'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'tcgplayer', 'https://shop.tcgplayer.com/sellerfeedback/0d1e2f3a', 'Commander singles, shipped daily', 0),
  ('e1531000-0000-4000-a000-000000000002'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'whatnot', 'https://www.whatnot.com/user/dev_pro_priya', null, 1),
  ('e1531000-0000-4000-a000-000000000003'::uuid, 'd0000000-0000-4000-a000-000000000002'::uuid, 'ebay', 'https://www.ebay.com/str/devpropriya', 'Graded foils & sealed', 2),
  ('e1531000-0000-4000-a000-000000000004'::uuid, 'd0000000-0000-4000-a000-000000000004'::uuid, 'etsy', 'https://www.etsy.com/shop/DevArtistAlters', 'Hand-painted alters', 0)
) as s (id, owner_id, platform, url, title, position)
where exists (select 1 from public.profiles where id = s.owner_id)
on conflict (id) do nothing;
