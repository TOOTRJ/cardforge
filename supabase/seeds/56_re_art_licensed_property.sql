-- ---------------------------------------------------------------------------
-- 56_re_art_licensed_property.sql — Re-art deck's record of what a maker
-- confirmed (migration 0214, deck_ip_attestations), so a preview branch, the
-- dev database and the local stack hold one row to read:
--
--   * dev_pro once confirmed a MADE-UP property ("Emberfall Chronicles")
--     for a deck that is gone since (deck_id NULL: the record outlives its
--     deck). The sentence is the app's own, word for word
--     (lib/tools/re-art/model.ts reartIpStatement — a unit test holds the
--     two together).
--   * No deck is made to name a property: "Re-art sampler" (52) keeps its
--     style, so the studio opens as before and naming one is the tester's
--     own first step (the confirmation, then its record).
--
-- Never against production. Idempotent (a fixed id, ON CONFLICT). No
-- credential. Skipped when the account is missing.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.deck_ip_attestations (id, owner_id, deck_id, ip_name, statement, created_at)
select 'e0000000-0000-4000-a000-0000000000a1'::uuid,
       'd0000000-0000-4000-a000-000000000002'::uuid,
       null,
       'Emberfall Chronicles',
       'I hold the rights to Emberfall Chronicles, or its rights holder''s permission, to make art of it with AI and to publish that art on PipGlyph. I am responsible for this, and PipGlyph may ask me for proof and remove the art.',
       now() - interval '30 days'
where exists (select 1 from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000002'::uuid)
on conflict (id) do nothing;
