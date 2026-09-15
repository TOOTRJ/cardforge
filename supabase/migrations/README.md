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
