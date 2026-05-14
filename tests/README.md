# Tests

Phase 11 chunk 16 seeded a two-tier test layer:

- **Unit tests** (`tests/unit/`) — Vitest, run in Node. Cover pure
  `lib/` helpers: validation schemas, Scryfall import mapper, mana-cost
  tokenizer.
- **End-to-end tests** (`tests/e2e/`) — Playwright, run against a live
  `npm run dev` server. Cover marketing flows out of the box; auth /
  create / Scryfall flows are scaffolded but `.fixme()`'d pending a
  test Supabase project.

## Running locally

```bash
# unit
npm run test:unit              # one-shot
npm run test:unit:watch        # watch mode

# e2e — one-time setup
npx playwright install chromium

# e2e — run
npm run test:e2e

# both
npm test
```

## Environment vars for full e2e coverage

The auth / create / Scryfall e2e specs need a Supabase test project. Set
the following in `.env.local` (or in your CI secret store):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# optional — used by tests/e2e/auth.spec.ts to create a seeded user
SUPABASE_E2E_USER_EMAIL=...
SUPABASE_E2E_USER_PASSWORD=...
```

The marketing smoke test (`tests/e2e/marketing.spec.ts`) runs without
Supabase configured — it just verifies the public homepage + gallery
shell render.

## Conventions

- One file per logical area (`validation.test.ts`, `import-mapper.test.ts`).
- Use `describe` blocks for the function under test; individual `it`
  cases assert one behavior each.
- Don't mock the database — unit tests cover pure functions only. E2E
  tests run against the real stack.
- E2E specs that depend on env vars should `test.skip` (with a
  documented reason) when the vars are absent, so a contributor without
  the secrets sees a clear skip rather than a confusing failure.
