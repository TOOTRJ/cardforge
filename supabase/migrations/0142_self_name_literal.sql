-- 0142_self_name_literal.sql — the cards stored with a literal `~` or
-- CARDNAME keep their look (TODO 6.2, owner 2026-10-21).
--
-- From this change both renderers draw `~` and the word CARDNAME in rules
-- text as the card's printed name (lib/cards/self-name.ts) — at RENDER
-- time: the stored text keeps the token, so a rename follows. A card stored
-- BEFORE it whose text already holds one printed the token as typed; drawn
-- as the name now, it would change its look without its owner touching it
-- (CLAUDE.md "Additions vs corrections": an addition is opt-in for a stored
-- card). So every such row is flagged, once:
--
--   frame_style.selfName = "literal"   the renderers draw the token as typed
--                                      (the creator's Text step offers its
--                                      owner "Print ~ as the card's name",
--                                      an edit's frame_anatomy.selfName:
--                                      "name", which removes the key).
--
-- Read on the dev database 2026-10-21 (read-only): 0 of 468 cards hold a
-- `~` or CARDNAME in any text. Production was not read (never touched by
-- the builder); this statement flags whatever is there, and nothing when
-- nothing is.
--
-- What counts: the rules text, a second face's / back's rules text
-- (back_face->>'rules_text') and the structured rows (face_content: walker
-- abilities, saga chapters and intro, station tiers) — the texts the
-- renderers substitute in. Flavour text is never substituted, so it is not
-- read. CARDNAME is matched as a capitalised word, as the renderers do.
--
-- Only `frame_style` is written on a flagged row. It is not a render column
-- (0126's guard) and no search column (0086's trigger does not fire); the
-- stored bake stays exact — it already shows the token as typed. 0134's
-- updated_at guard DOES fire (frame_style is not one of the columns it
-- ignores): a flagged row's updated_at moves to the migration's time — its
-- share image's cache-buster and its sitemap lastmod with it; nothing
-- re-bakes. A row already carrying the key is left alone (idempotent).
--
-- Grants: none — no new object; `cards` is granted at table level (0097).
--
-- Ships through a PR; never applied ad-hoc.

update public.cards
set frame_style = coalesce(frame_style, '{}'::jsonb) || '{"selfName": "literal"}'::jsonb
where not (coalesce(frame_style, '{}'::jsonb) ? 'selfName')
  and (
    rules_text ~ '~|\mCARDNAME\M'
    or coalesce(back_face->>'rules_text', '') ~ '~|\mCARDNAME\M'
    or coalesce(face_content::text, '') ~ '~|\mCARDNAME\M'
  );
