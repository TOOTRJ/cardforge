-- ---------------------------------------------------------------------------
-- 57_re_art_kept_rolls.sql — Re-art deck's earlier pictures (migration 0215,
-- deck_reart_rolls), so a preview branch, the dev database and the local
-- stack can try "Earlier pictures" WITHOUT painting anything:
--
--   * two cards of dev_pro's "Re-art sampler" (52_re_art_deck.sql) each have
--     one earlier picture kept: "Unfinished Masterwork" and "Archivist of
--     Lost Hours". A seed can't put a painted picture in storage, so each
--     points at one of the built-in pictures the seed cards already use
--     (10_dev_data.sql: the same addresses a card's art may hold) — "Use
--     this one" puts it on the card, for free;
--   * nothing is recorded as painted (no deck_reart_cards row): the cards
--     read "not painted yet", as 52 leaves them.
--
-- Never against production. Idempotent (fixed ids, ON CONFLICT). No
-- credential. Rows whose deck or card is missing are skipped.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.deck_reart_rolls (id, deck_id, card_id, owner_id, style_version, art_url, artist_credit, image_model, method, painted_at)
select r.id, 'b0000000-0000-4000-a000-0000000000d1'::uuid, r.card_id, 'd0000000-0000-4000-a000-000000000002'::uuid,
       1, r.art_url, 'PipGlyph Studio', null, 'paint', now() - r.age
from (values
  ('e0000000-0000-4000-a000-0000000000b1'::uuid, 'c0000000-0000-4000-a000-000000000018'::uuid,
     'https://pipglyph.com/defaults/banners/banner-07.webp', interval '2 days'),
  ('e0000000-0000-4000-a000-0000000000b2'::uuid, 'c0000000-0000-4000-a000-000000000016'::uuid,
     'https://pipglyph.com/defaults/banners/banner-11.webp', interval '3 days')
) as r (id, card_id, art_url, age)
where exists (
  select 1 from public.decks d
  where d.id = 'b0000000-0000-4000-a000-0000000000d1'::uuid
    and d.owner_id = 'd0000000-0000-4000-a000-000000000002'::uuid
)
  and exists (
    select 1 from public.cards c
    where c.id = r.card_id and c.owner_id = 'd0000000-0000-4000-a000-000000000002'::uuid
  )
on conflict (id) do nothing;
