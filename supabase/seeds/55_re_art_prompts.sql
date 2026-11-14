-- ---------------------------------------------------------------------------
-- 55_re_art_prompts.sql — Re-art deck's own prompts (migration 0209), so a
-- preview branch, the dev database and the local stack can exercise them:
--
--   * one card of dev_pro's "Re-art sampler" (52_re_art_deck.sql) has words
--     of its own: "Archivist of Lost Hours" is painted as an old goblin
--     librarian, in the deck's look (only_words false);
--   * the deck's style is left as 52 seeded it (mode 'preset'), so the
--     studio opens on the template and "Write my own prompt" is one press
--     away.
--
-- Never against production. Idempotent (ON CONFLICT). No credential. Rows
-- whose deck or entry is missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.deck_reart_prompts (deck_id, entry_id, owner_id, prompt, only_words)
select 'b0000000-0000-4000-a000-0000000000d1'::uuid, 'a0000000-0000-4000-a000-00000000d107'::uuid,
       'd0000000-0000-4000-a000-000000000002'::uuid,
       'an old goblin librarian asleep on a heap of overdue books, one candle burning low beside her', false
where exists (
  select 1 from public.deck_cards dc
  join public.decks d on d.id = dc.deck_id
  where dc.id = 'a0000000-0000-4000-a000-00000000d107'::uuid
    and dc.deck_id = 'b0000000-0000-4000-a000-0000000000d1'::uuid
    and d.owner_id = 'd0000000-0000-4000-a000-000000000002'::uuid
)
on conflict (deck_id, entry_id) do nothing;
