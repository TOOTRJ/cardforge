# Migrations

Migrations ship ONLY through a PR. The Supabase GitHub integration applies
them to a preview branch when the PR opens and to production on merge (see
`CLAUDE.md` and `docs/ENVIRONMENTS.md`). Never apply a migration via
`supabase db push`, the Supabase MCP `apply_migration`, or the dashboard SQL
editor — ad-hoc applies write timestamped versions into the migration history
and break the integration (this happened once; repaired 2026-07-09). The only
manual fallback is the guard-railed `npm run db:push:prod`.

New migrations: the next `NNNN_name.sql` (highest existing number + 1, created
by hand — `supabase migration new` emits a timestamped filename that breaks
the ordering), with the header wording used since 0055: "Ships through a PR;
never applied ad-hoc."

The "Apply via the Supabase CLI (`supabase db push`) or the Supabase MCP"
lines in headers up to 0054 (0054 itself says `npm run db:push:*`) predate
Supabase branching and are superseded by the rule above.

## Grants are part of the migration

Production is an **old** Supabase project: anything `postgres` creates in
`public` is auto-granted to `anon` / `authenticated` / `service_role`. **New
projects — which every preview branch and the `dev` branch are — don't.**
0001–0096 relied on the old behaviour without saying so; `0097` stated the
whole schema's grants explicitly (generated from production's own ACLs, grants
only, so a no-op there) and aligned the default privileges.

From now on a migration that creates a table or function says who may use it
(`grant … on table … to authenticated, service_role;`,
`grant execute on function … to …;`). Never "fix" a permission error with a
blanket `grant all on all tables in schema public` — that silently undoes the
deliberate lockdowns (0073 job RPCs, 0074 profile billing columns, 0088
notifications, 0095 email tables).

## Storage: users have no write policy

Since `0126` no API role holds an insert, update or delete policy on
`storage.objects` for any bucket (its drift guard dropped every such policy,
whatever it named, so this holds on production too). Buckets stay
public-read by URL; every write is server code on the service role — a
user's folder only through `lib/media/user-storage.ts` (the action checks
auth, the key is forced to `{userId}/{server-made name}`), bakes through
`lib/cards/bake-core.ts`, which opens the owner's folder the same way.
Direct client writes skipped the byte sniff, the metadata strip and the
moderation scan (and could replace a card's watermarked bake). Never add an
owner-folder write policy back; `tests/unit/db/storage-server-writes-migration.test.ts`
replays every storage policy and fails if one appears, and
`tests/e2e/storage-direct-writes.spec.ts` tries the direct writes with a
real session.

**A card's render pointer is the server's too.** `cards_guard_render_columns`
(0126) lets `anon` / `authenticated` only keep or clear
`rendered_image_url`, `rendered_thumb_url`, `rendered_at` and
`layout_version`; setting one (or inserting a card with one) is
`insufficient_privilege`. The save bake persists with the service role
(`lib/cards/bake-render.ts`). A new render-like column (a URL the app draws
as the card's picture) joins that trigger, and any surface that draws one
checks it with `isStoredRenderUrl()` (`lib/cards/render-cdn.ts`) first.

**Every picture URL column is tied to our storage (0127, TODO 3.14b).** One
guard trigger per table (`cards_guard_media_columns`,
`profiles_guard_media_columns`, `decks_guard_media_columns`,
`custom_pips_guard_media_columns`, `deck_cards_guard_media_columns`) lets
`anon` / `authenticated` only keep a column's value, clear it, or set what
`public.media_url_allowed(kind, url, auth.uid())` accepts: a public object on
one of `public.storage_origins`, in the kind's bucket, directly in the
caller's own folder — `cards.art_url` and the second face's art (card-art,
or a built-in image: the seed cards), the custom watermark's `url`
(card-art), `set_icon_url` (set-covers or card-art), `avatar_url` /
`banner_url` (profile-media or a built-in `/defaults/…` image of that kind),
`decks.cover_url` (set-covers, or card-art for an AI cover),
`custom_pips.image_url` (custom-pips, `?v=` allowed); `deck_cards.image_url`
takes a Scryfall printing image (`https://cards.scryfall.io/…`) only. Refused
= `insufficient_privilege` with `media_url_not_allowed: <table>.<column>`
(the save actions turn it into a field error, `lib/media/media-url-errors.ts`).
The service role and `postgres` are not checked; existing rows are
grandfathered (only changes are checked). A remix of someone else's card
copies the parent's pictures into the remixer's folder before it saves
(`lib/cards/remix-media.ts`). `handle_new_user` keeps a signup's metadata
avatar only when it is a Google profile picture. Any surface that DRAWS one of
these columns checks it with `isAllowedMediaUrl()` / `profileMediaSrc()`
(`lib/media/media-urls.ts`) first — the database can't pin the deployment's
host, the app can.

- **A new picture column** joins a guard trigger and a `media_url_allowed`
  kind (and `MEDIA_KIND_BUCKETS` in `lib/media/media-urls.ts` — a unit test
  keeps the two tables equal).
- **`public.storage_origins`** lists production's origins (the custom domain
  and the project host) and the persistent dev branch's; `supabase/seed.sql`
  adds `https://*.supabase.co` (each preview branch has its own host) and the
  local stack — seeds never run on production. **If the storage domain ever
  moves**, a migration adds the new origin BEFORE `NEXT_PUBLIC_SUPABASE_URL`
  changes, or every new upload fails to save.
- **Uploads are rate-limited per user** (30 a minute, 300 a rolling day;
  admins exempt): `public.upload_hits` + `hit_upload_limit()`, service role
  only, called by every upload action before it touches the bytes
  (`lib/media/upload-rate-limit.ts`; AI art and our own bakes aren't counted).

Classification of every row (counts only — production's private rows are the
owner's to read):

```sql
-- Read-only. Every user-media URL column, classified the way 0127 sees it —
-- counts only (no ids, no URLs). Runs before or after 0127 (SQL editor,
-- production).
with v (tbl, col, vis, owner, url, buckets) as (
  select 'cards', 'art_url', c.visibility, c.owner_id, c.art_url, array['card-art'] from public.cards c
  union all select 'cards', 'back_face.art_url', c.visibility, c.owner_id, c.back_face ->> 'art_url', array['card-art'] from public.cards c
  union all select 'cards', 'watermark.url', c.visibility, c.owner_id, c.watermark ->> 'url', array['card-art'] from public.cards c
  union all select 'cards', 'set_icon_url', c.visibility, c.owner_id, c.set_icon_url, array['set-covers', 'card-art'] from public.cards c
  union all select 'profiles', 'avatar_url', 'all', p.id, p.avatar_url, array['profile-media'] from public.profiles p
  union all select 'profiles', 'banner_url', 'all', p.id, p.banner_url, array['profile-media'] from public.profiles p
  union all select 'decks', 'cover_url', d.visibility, d.owner_id, d.cover_url, array['set-covers', 'card-art'] from public.decks d
  union all select 'custom_pips', 'image_url', 'all', cp.owner_id, cp.image_url, array['custom-pips'] from public.custom_pips cp
  union all select 'deck_cards', 'image_url', d.visibility, d.owner_id, dc.image_url, array[]::text[]
    from public.deck_cards dc join public.decks d on d.id = dc.deck_id
),
m as (
  select *, regexp_match(url, '^(https?://[^/]+)/storage/v1/object/public/([^/]+)/([^/]+)/(.+)$') as p from v
)
select tbl, col,
       case when vis in ('public', 'unlisted') then 'public+unlisted' else vis end as rows_of,
       case
         when url is null or url = '' then 'empty'
         when url ~ '^/defaults/' then 'built-in (site-relative)'
         when url ~ '^https://(www\.)?pipglyph\.com/defaults/' then 'built-in (pipglyph.com)'
         when p is not null and p[1] in ('https://auth.pipglyph.com', 'https://zkwkisxoqdhdchqyjwdc.supabase.co') then
           case
             when not (p[2] = any (buckets)) then 'our storage, another bucket'
             when p[3] = owner::text then 'our storage, own folder'
             else 'our storage, ANOTHER user''s folder'
           end
         when url ~ '^https://lh[0-9]+\.googleusercontent\.com/' then 'Google avatar'
         when url ~ '^https://cards\.scryfall\.io/' then 'Scryfall CDN'
         when url ~ '^https://([a-z0-9-]+\.)*scryfall\.(io|com)/' then 'Scryfall, other host'
         else 'OTHER HOST'
       end as class,
       count(*) as n
from m
group by 1, 2, 3, 4
order by 1, 2, 3, 4;
```

## Errata — corrections to merged migration headers

A migration file is never edited after it merges (the integration tracks it
by content), so header comments that have since gone stale are corrected here
instead. Each bullet: what the header says, and what is true now.

- **0001–0054 ("Apply via `supabase db push` / the Supabase MCP")** — 22
  headers (0001, 0002, 0003, 0004, 0006–0013, 0015, 0024, 0027, 0039,
  0042–0046) plus 0054's `npm run db:push:*` line. Superseded: migrations
  apply through PRs only, as described at the top of this file.
- **0011 / 0013 ("not surfaced in the UI today, but a future usage pane is
  easier with this in place")** — that pane shipped. The owner SELECT
  policies on `card_ai_calls` and `scryfall_calls` are load-bearing for the
  0017 per-day aggregate functions and the UsagePanel
  (`components/settings/usage-panel.tsx`, rendered on `/settings` and
  `/dashboard/usage`); do not drop them as unused.
- **0018 (title line `-- Migration: 0011_card_types_mtg`)** — mislabels
  itself; the file is 0018_card_types_mtg. 0011 is the AI rate-limit
  migration.
- **0020 (`generate_random_card` = "GPT-4o text generation",
  `generate_random_art` = "DALL-E 3 image generation")** — the model names
  are historical. Both actions now run on the card-design engine (Claude via
  the Vercel AI Gateway, `lib/ai/provider.ts`) and FLUX text-to-image
  (`lib/ai/image-gen.ts`); the action labels themselves are unchanged
  (`lib/ai/rate-limit.ts`).
- **0027 ("tightening the policy to forbid client billing writes is a
  follow-up")** — done in 0028 (`protect_billing_columns` BEFORE trigger),
  extended in 0029, 0052, 0060 and 0063. Client writes to billing columns are
  silently reverted.
- **0040 ("writes are admin-only for v1 … an admin UI can come later")** —
  the admin UI shipped at `/admin/challenges`
  (`components/admin/challenge-admin.tsx`, `lib/challenges/actions.ts`);
  writes remain `is_admin`-gated.
- **0080 ("those tables' admin writes go through the service role, which is
  why nothing broke")** — not true for `challenges`: its admin writes use the
  admin's own session, so 0074 broke create / edit / close / delete on
  `/admin/challenges` until 0096 moved its three write policies to
  `viewer_is_admin()`. New admin policies must use `viewer_is_admin()`, never
  a subquery on `profiles.is_admin`.
- **0068 / 0073 ("the sweep refunds any aged spend whose step didn't
  complete from that very attempt" / "a `done` step carrying the winning
  spend_ref" as the cron's proof)** — the settlement proof moved off the job
  JSON in 0106: `patch_job_step` stamps `credit_ledger.settled_at` (via
  `settle_spend`) in the same transaction as the done-write, the sync idea
  routes settle their own refs through `settleSpend()`, and the sweep
  refunds aged UNSETTLED spends without reading `ai_generation_jobs` at all.
- **0100 ("ignore the counters when deciding whether a card changed")** —
  the guard also ignores the RENDER columns since 0108 (`rendered_image_url`,
  `rendered_thumb_url`, `rendered_at`, `layout_version`): a bake or a render
  sweep is not an edit, so `updated_at`, the sitemap's lastmod and the card
  page's `dateModified` stay honest. The share-image cache-buster keys on
  `max(updated_at, rendered_at)` (`lib/cards/render-version.ts`).
- **0014 (`"etched"` = "gold-leaf inner border + faint cross-hatch
  overlay")** — since layout v26 the etched finish is a fine cross-hatch and
  sheen masked to the frame's own pixels (`lib/cards/etched-finish.tsx`, the
  same SVG in the preview and the bake): the black border and the art stay
  untouched and there is no gold inner border. The old border never baked as
  described — Satori collapsed it into a strip down the card's left edge.
- **0014 (`"borderless"` = "art well bleeds behind the section panels")** —
  retired. No renderer has drawn it since the MSE-schema rebuild
  (2026-06-01), so a borderless-finish card baked exactly like a regular one,
  and the creator stopped offering it. 0119 reset every stored `borderless`
  finish to `regular` without touching `updated_at` or the render columns
  (no pixel moved, so no re-bake), and `CARD_FINISH_VALUES`
  (`types/card.ts`) no longer lists it; the validator reads a legacy
  `borderless` as `regular`. The finishes are `regular`, `foil`, `etched` and
  `showcase`. Borderless is a frame treatment (its own templates), never a
  finish.
- **0004 / 0007 / 0010 / 0021 / 0039 ("writes are restricted to" / "scoped
  to the owner's first-folder", "owner-scoped writes", "owner-folder
  writes"), 0022's profile-media write policies** and **0038 / 0039 (the owner SELECT policy exists "so their
  own upserts can resolve")** — since 0126 users hold no write policy on
  `storage.objects` at all (see "Storage" above). The two owner SELECT
  policies were kept (reads unchanged) but back no write any more.
- **0021 / 0079 (the render columns "written by the bake")** — until 0126
  the owner could write them too, like any column of their own card (0003's
  UPDATE policy); since 0126 only the service role can set them (see
  "Storage" above).
