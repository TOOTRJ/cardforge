-- ---------------------------------------------------------------------------
-- 34_card_ai_provenance.sql — AI provenance (migration 0161, TODO CP1), so a
-- preview branch, the dev database and the local stack show each card-page
-- label without spending a credit:
--
--   * …016 "Archivist of Lost Hours" (dev_pro, public) — every text part it
--     has marked as the AI's: "Card generated with AI".
--   * …017 "Cinderwing Broodling" (dev_pro, public) — its flavour alone:
--     "AI helped with parts of this card".
--
-- "Art generated with AI" can't be seeded: the label is DERIVED from the
-- picture's address (an `ai-…` object the server's AI art store wrote), and a
-- seed has no picture to put there. Generate a picture in the creator (one
-- credit) and save to see it — and upload your own over it to see it go.
--
-- Editing either card's rules / flavour as dev_pro drops that part (the
-- database's guard), which is the label following the edit.
--
-- Runs after 10_dev_data.sql (config.toml → [db.seed] sql_paths, filename
-- order). Never against production. Idempotent (sets the same list). The
-- seed runs as the database owner, which 0161's guard lets write the column
-- (an API role can't). On a database 0161 hasn't reached the file is skipped
-- whole. No credential in here (the repo is public).
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
    where table_schema = 'public' and table_name = 'cards' and column_name = 'ai_fields'
  ) then
    raise notice '34_card_ai_provenance: migration 0161 has not run here — skipped';
    return;
  end if;

  update public.cards
  set ai_fields = array['cost', 'rules_text', 'stats', 'title', 'type_line']
  where id = 'c0000000-0000-4000-a000-000000000016'::uuid;

  update public.cards
  set ai_fields = array['flavor_text']
  where id = 'c0000000-0000-4000-a000-000000000017'::uuid;
end
$seed$;
