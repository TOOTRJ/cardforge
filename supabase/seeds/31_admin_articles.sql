-- ---------------------------------------------------------------------------
-- 31_admin_articles.sql — composer articles (migration 0153) so a preview
-- branch, the dev database and the local stack show the backlog at
-- /admin/articles (sign in as dev_admin):
--
--   * "Seed: how the article backlog works" — LIVE since yesterday: it shows
--     on /articles, /learn/design, the sitemap, /llms.txt and the RSS feed,
--     with dev_admin's byline, a cover, and its FAQ printed under the body;
--   * "Seed: a scheduled article" — SCHEDULED three days out (404 until then;
--     /api/cron/publish-articles announces it when its time passes);
--   * "Seed: a second scheduled article" — six days out (the backlog's order);
--   * "Seed: an unfinished draft" — a DRAFT whose image has no alt text, so
--     the composer's checklist blocks Schedule / Publish now.
--
-- Times are relative to the seed run (now() ± days). Never against
-- production. Idempotent: fixed ids + ON CONFLICT DO NOTHING (a reseed keeps
-- what an admin changed). No credential in here (the repo is public).
-- Article ids a1530000-…-0001 to …-0004.
-- ---------------------------------------------------------------------------

do $guard$
begin
  if (select count(*) from auth.users where email not like '%@dev.pipglyph.test'
                                        and email not like '%@pipglyph.test') > 25 then
    raise exception 'Refusing to seed dev data: this database has real users. Wrong target?';
  end if;
end
$guard$;

insert into public.articles (
  id, slug, title, seo_title, description, body, tags, category, faq,
  cover_url, cover_alt, cover_width, cover_height, author_id,
  is_published, publish_at, announced_at, created_by
)
select
  v.id, v.slug, v.title, v.seo_title, v.description, v.body, v.tags, v.category, v.faq::jsonb,
  v.cover_url, v.cover_alt, v.cover_width, v.cover_height,
  (select p.id from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid),
  v.is_published, v.publish_at, v.announced_at,
  (select p.id from public.profiles p where p.id = 'd0000000-0000-4000-a000-000000000001'::uuid)
from (values
  (
    'a1530000-0000-4000-a000-000000000001'::uuid,
    'seed-how-the-article-backlog-works',
    'Seed: how the article backlog works',
    'How the PipGlyph article backlog works',
    'Seed data for previews: a composer article that went live yesterday, with a byline, a cover and its FAQ printed under the body.',
    $body$The article backlog lets an admin write guides ahead of time and release them one at a time, so the site gains a steady stream of new pages instead of a pile on one day. This seeded article is live so a preview shows what a published composer article looks like next to the MDX guides.

## How does an article go from draft to live?

An admin writes it in the composer at /admin/articles, saves it as a draft and previews the saved version. When the checklist has no required fixes left, the admin schedules it for a time in UTC or publishes it at once. A scheduled article is public the moment its time passes, and the publish job then refreshes every list that names it and tells search engines through IndexNow.

## What does the checklist look for?

It looks for what the research behind it ranks highest: the answer in the opening paragraph, sections headed by the questions readers ask, links to other guides and to the tools, alt text on every picture, a summary of the right length and a named author. Missing alt text, a missing category, an unsafe link or a body that is too thin block publishing. Everything else is advice the admin may overrule.

<Figure src="/article-media/composer-seed/backlog.svg" alt="A timeline from draft to scheduled to live" caption="Drafts feed the queue; each scheduled article goes out at its own time." width="1600" height="900" />

## Where does a published article appear?

On its own page at /articles/ and its slug, on the all-articles index, on its category shelf under /learn, on the tag hubs it shares with other guides, in the sitemap with its real date, in /llms.txt and in the RSS feed. Try the [card creator](/create) or read [how to design balanced custom cards](/articles/designing-balanced-custom-mtg-cards) to follow the links this article makes.

## What happens on an edit?

An edit of a live article updates the page at once. The public updated date moves only when the admin marks the edit as a real revision, because a date that changes for every typo teaches readers and search engines to ignore it.$body$,
    array['card design', 'guides'],
    'design',
    '[{"q":"Is a seeded article real content?","a":"No. Seeded articles exist only on preview branches, the dev database and local resets, so testers can see a live composer article; production never runs the seeds."},{"q":"Who can write articles?","a":"Only admins can write, schedule and publish articles. The database refuses every other account through row-level security, whatever the app sends."},{"q":"When does a scheduled article go live?","a":"A scheduled article goes live at its publish time in UTC, and the publish job announces it within ten minutes so every list and the sitemap name it."}]',
    '/article-media/composer-seed/backlog.svg',
    'A timeline from draft to scheduled to live',
    1600, 900,
    true, now() - interval '1 day', now() - interval '1 day'
  ),
  (
    'a1530000-0000-4000-a000-000000000002'::uuid,
    'seed-a-scheduled-article',
    'Seed: a scheduled article',
    null,
    'Seed data for previews: an article scheduled three days after the seed ran. Its URL answers 404 until its time passes.',
    $body$This article is in the backlog: it is scheduled, so its page is not public yet and its URL answers 404 until the publish time passes. Open it in /admin/articles to see the schedule controls, the next open slot and the checklist.

## What can an admin change while it waits?

Everything. The slug stays editable until the article has been public once; after that the URL is locked, because renaming a published page would break every link to it.

## How is the backlog ordered?

By publish time, earliest first, so the list shows what goes out next. The composer suggests the next open slot a few days after the last scheduled article and warns when two articles would go out within two days of each other.

## Read next

The [all-articles index](/articles) lists what is live, and the [card creator](/create) is where the guides send readers. A scheduled article also links to [the guide on balanced custom cards](/articles/designing-balanced-custom-mtg-cards) so the link checker has a real target.

$body$ || repeat('Seed paragraph text keeps the body above the minimum length for testing the schedule. ', 30),
    array['card design', 'guides'],
    'design',
    '[]',
    null, null, null, null,
    true, now() + interval '3 days', null
  ),
  (
    'a1530000-0000-4000-a000-000000000003'::uuid,
    'seed-a-second-scheduled-article',
    'Seed: a second scheduled article',
    null,
    'Seed data for previews: a second article in the backlog, six days after the seed ran, to show the release order.',
    $body$A second scheduled article shows the backlog's order: it goes out three days after the first. Move its time in the composer and the list on /admin/articles re-sorts.

## Why spread releases out?

A steady cadence keeps the site fresh, gives each article its own crawl and share, and lets each one be checked on its own before the next goes out.

## Where to go from here

See [how to playtest custom cards](/articles/how-to-playtest-custom-mtg-cards), browse the [community gallery](/gallery) and open the [card creator](/create).

$body$ || repeat('Seed paragraph text keeps the body above the minimum length for testing the schedule. ', 30),
    array['guides'],
    'design',
    '[]',
    null, null, null, null,
    true, now() + interval '6 days', null
  ),
  (
    'a1530000-0000-4000-a000-000000000004'::uuid,
    'seed-an-unfinished-draft',
    'Seed: an unfinished draft',
    null,
    'Seed data for previews: a draft the checklist blocks, because its image has no alt text.',
    $body$## Draft notes

This draft opens with a heading and holds an image without alt text, so the checklist shows a required fix and the composer keeps Schedule and Publish now disabled until it is fixed.

![](/article-media/composer-seed/backlog.svg)
$body$,
    array['guides'],
    'design',
    '[]',
    null, null, null, null,
    false, null, null
  )
) as v (
  id, slug, title, seo_title, description, body, tags, category, faq,
  cover_url, cover_alt, cover_width, cover_height,
  is_published, publish_at, announced_at
)
on conflict do nothing;
