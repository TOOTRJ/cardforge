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
