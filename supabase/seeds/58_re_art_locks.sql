-- ---------------------------------------------------------------------------
-- 58_re_art_locks.sql — Re-art deck's locked cards (migration 0216,
-- deck_reart_locks), so a preview branch, the dev database and the local
-- stack show one:
--
--   * "Sol Ring" in dev_pro's "Re-art sampler" (52_re_art_deck.sql) is
--     LOCKED: the studio shows it "Locked", a run and a sample leave it as
--     it is, and "Unlock" is one press away.
--
-- Never against production. Idempotent (ON CONFLICT). No credential. A row
-- whose deck or entry is missing is skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.deck_reart_locks (entry_id, deck_id, owner_id)
select 'a0000000-0000-4000-a000-00000000d104'::uuid, 'b0000000-0000-4000-a000-0000000000d1'::uuid,
       'd0000000-0000-4000-a000-000000000002'::uuid
where exists (
  select 1 from public.deck_cards dc
  join public.decks d on d.id = dc.deck_id
  where dc.id = 'a0000000-0000-4000-a000-00000000d104'::uuid
    and dc.deck_id = 'b0000000-0000-4000-a000-0000000000d1'::uuid
    and d.owner_id = 'd0000000-0000-4000-a000-000000000002'::uuid
)
on conflict (entry_id) do nothing;
