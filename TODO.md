# TODO

- [ ] **Point `.env.local` at the local Supabase stack** instead of
      production (docs/ENVIRONMENTS.md §1). Deliberately deferred on
      2026-07-09 — until then, local dev reads AND WRITES the live DB, so
      no destructive local experiments. When switching: `npm run db:start`,
      copy the keys from `supabase status`, optionally keep a
      `.env.production-peek` to swap in consciously.
