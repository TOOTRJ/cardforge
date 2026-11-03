-- ---------------------------------------------------------------------------
-- 31_moderation_lock.sql — the moderation lock (migration 0156,
-- lib/moderation/lock.ts), so a preview branch, the dev database and the
-- local stack have something to look at:
--
--   * …7a1 "Gloomvein Effigy" — dev_pro's card that moderation HID: private,
--     moderation_hidden_at set (reason 'report'), with the actioned report
--     that hid it (dev_free's). dev_pro sees "Hidden by moderation" in My
--     Cards and on the card page, can't publish it from the editor, the bulk
--     bar or a deck; dev_admin sees it under /admin/moderation "Hidden
--     cards" with Unhide.
--   * …7a2 "Ashen Whisper" — dev_pro's UNLISTED card with a PENDING report
--     (dev_free's), so dev_admin can press "Hide card" in the queue and see
--     the lock land. Unlisted, like 24_card_nickname.sql's rows, so the
--     seeded public gallery stays on one 24-card page for the e2e specs.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent: fixed ids + ON CONFLICT DO
-- NOTHING. No credential in here (the repo is public). A row whose account
-- is missing (this file run on its own) is skipped. The seed runs as the
-- database owner, which 0156's guard lets set the lock (an API role can't).
-- On a database 0156 hasn't reached the file is skipped whole.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

do $seed$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cards' and column_name = 'moderation_hidden_at'
  ) then
    raise notice '31_moderation_lock: migration 0156 has not run here — skipped';
    return;
  end if;
  if not exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000002'::uuid) then
    return;
  end if;

  insert into public.cards (
    id, owner_id, game_system_id, title, slug, cost, color_identity, card_type, subtypes,
    rarity, rules_text, power, toughness, artist_credit, art_url, frame_style, visibility,
    moderation_hidden_at, moderation_hidden_reason, created_at, updated_at
  )
  select
    c.id, 'd0000000-0000-4000-a000-000000000002'::uuid,
    (select id from public.game_systems order by created_at limit 1),
    c.title, c.slug, c.cost, c.colors, c.card_type, c.subtypes, c.rarity, c.rules_text,
    c.power, c.toughness, 'PipGlyph Studio',
    'https://pipglyph.com/defaults/avatars/avatar-' || lpad(c.art::text, 2, '0') || '.webp',
    '{"template":"m15","finish":"regular"}'::jsonb,
    c.visibility, c.hidden_at, c.hidden_reason,
    now() - interval '6 days', now() - interval '6 days'
  from (values
    ('c0000000-0000-4000-a000-0000000007a1'::uuid, 'Gloomvein Effigy', 'gloomvein-effigy', '{2}{B}', array['black'], 'creature', array['Horror'], 'uncommon',
       E'When Gloomvein Effigy enters, each opponent loses 1 life.', '2', '2', 7,
       'private', now() - interval '2 days', 'report'),
    ('c0000000-0000-4000-a000-0000000007a2'::uuid, 'Ashen Whisper', 'ashen-whisper', '{1}{R}', array['red'], 'instant', array[]::text[], 'common',
       E'Ashen Whisper deals 2 damage to any target.', null, null, 9,
       'unlisted', null, null)
  ) as c (id, title, slug, cost, colors, card_type, subtypes, rarity, rules_text, power, toughness, art,
          visibility, hidden_at, hidden_reason)
  on conflict (id) do nothing;

  -- dev_free's reports: the one moderation actioned (…7a1, resolved by
  -- dev_admin) and one still pending (…7a2).
  if exists (select 1 from public.profiles where id = 'd0000000-0000-4000-a000-000000000003'::uuid) then
    insert into public.card_reports (id, card_id, reporter_id, reason, details, status, created_at, resolved_at, resolved_by)
    values
      ('e0000000-0000-4000-a000-0000000007a1'::uuid, 'c0000000-0000-4000-a000-0000000007a1'::uuid,
       'd0000000-0000-4000-a000-000000000003'::uuid, 'other', 'Seeded report (dev data).', 'actioned',
       now() - interval '3 days', now() - interval '2 days', 'd0000000-0000-4000-a000-000000000001'::uuid),
      ('e0000000-0000-4000-a000-0000000007a2'::uuid, 'c0000000-0000-4000-a000-0000000007a2'::uuid,
       'd0000000-0000-4000-a000-000000000003'::uuid, 'spam', 'Seeded report (dev data).', 'pending',
       now() - interval '1 day', null, null)
    on conflict (id) do nothing;
  end if;
end
$seed$;
