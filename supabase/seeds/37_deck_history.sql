-- ---------------------------------------------------------------------------
-- 37_deck_history.sql — a change history to restore from (TODO DK5.13,
-- migration 0164), so a preview branch, the dev database and the local stack
-- can open dev_pro's "Cinderwing Dragonstorm" → History and see versions on
-- both sides of the Plus 30-day line:
--
--   60 days ago  the deck as seeded (its entries' "added" rows)
--   40 days ago  Sol Ring 1 → 2 copies          (Pro only: past 30 days)
--   12 days ago  Emberlash moved to the Sideboard
--    3 days ago  Sol Ring 2 → 1 copy
--    1 day ago   Emberlash back to the Mainboard
--
-- The four changes are REAL writes, logged by 0164's trigger like any other
-- (then dated back), and they cancel out: the deck reads exactly as seed 10
-- left it. "Restore this version" on the 12-days-ago row gives Sol Ring ×2
-- and Emberlash on the Sideboard; on the 40-days-ago row, Sol Ring ×2 alone.
--
-- Runs after 36_card_ai_provenance.sql (config.toml → [db.seed] sql_paths,
-- filename order). Never against production. Idempotent: only while the deck
-- has no logged UPDATE yet (a tester's own edits are never dated back), and
-- only where the deck and both entries exist. No credential in here (the
-- repo is public).
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
declare
  v_deck constant uuid := 'b0000000-0000-4000-a000-000000000001';
  v_ring constant uuid := 'a0000000-0000-4000-a000-000000000004';
  v_bolt constant uuid := 'a0000000-0000-4000-a000-000000000003';
  v_mark bigint;
begin
  if to_regclass('public.deck_entry_changes') is null then
    return;
  end if;
  if (select count(*) from public.deck_cards where deck_id = v_deck and id in (v_ring, v_bolt)) <> 2 then
    return;
  end if;
  if exists (select 1 from public.deck_entry_changes where deck_id = v_deck and op = 'update') then
    return;
  end if;

  -- The deck as seeded: its "added" rows 60 days back (written by the
  -- trigger on a fresh branch; a database seeded before 0164 has none, so
  -- they are written here, one per entry).
  insert into public.deck_entry_changes (deck_id, entry_id, op, before, after, changed_at)
  select dc.deck_id, dc.id, 'insert', null, public.deck_entry_change_snapshot(dc), now() - interval '60 days'
  from public.deck_cards dc
  where dc.deck_id = v_deck
    and not exists (select 1 from public.deck_entry_changes c where c.deck_id = v_deck and c.entry_id = dc.id);
  update public.deck_entry_changes set changed_at = now() - interval '60 days'
  where deck_id = v_deck and op = 'insert';

  select coalesce(max(id), 0) into v_mark from public.deck_entry_changes;
  update public.deck_cards set quantity = quantity + 1 where id = v_ring;
  update public.deck_entry_changes set changed_at = now() - interval '40 days' where id > v_mark;

  select coalesce(max(id), 0) into v_mark from public.deck_entry_changes;
  update public.deck_cards set board = 'side' where id = v_bolt;
  update public.deck_entry_changes set changed_at = now() - interval '12 days' where id > v_mark;

  select coalesce(max(id), 0) into v_mark from public.deck_entry_changes;
  update public.deck_cards set quantity = quantity - 1 where id = v_ring;
  update public.deck_entry_changes set changed_at = now() - interval '3 days' where id > v_mark;

  select coalesce(max(id), 0) into v_mark from public.deck_entry_changes;
  update public.deck_cards set board = 'main' where id = v_bolt;
  update public.deck_entry_changes set changed_at = now() - interval '1 day' where id > v_mark;
end
$seed$;
