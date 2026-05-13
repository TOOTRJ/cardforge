# Chunk 16 — Automated Test Suite

## Goal

Add a real test layer: Vitest for unit tests, Playwright for end-to-end
smoke tests. The repo currently lints / typechecks / builds but has no
test runner. This chunk lays the foundation and seeds it with high-value
tests around validation, mappers, and the happy-path flows.

## Scope

In scope:
- Vitest config + `npm run test:unit`.
- Playwright config + `npm run test:e2e` (assumes a running dev server).
- Seed unit tests for `lib/validation/card.ts`,
  `lib/scryfall/import-mapper.ts`, `lib/scryfall/client.ts`'s
  tokenizer-equivalents.
- Seed e2e smoke tests:
  - Signup → login → logout
  - Create card happy path (text fields only — skips upload)
  - Scryfall search + import (mocks Scryfall fetch)
- A combined `npm test` that runs both.
- Optional `.github/workflows/test.yml` for CI.

Out of scope:
- 100% coverage. Aim for ≥40% on `lib/`.
- Visual regression testing.
- Performance benchmarks.
- Mocking Supabase end-to-end (e2e runs against a real Supabase project
  via test credentials or a local Supabase).
- Replacing the existing `npm run lint` / `typecheck` / `build`.

## Files to add / modify

- Package: add `vitest`, `@vitest/coverage-v8`, `@playwright/test`,
  `happy-dom` (or `jsdom`)
- New: `vitest.config.ts`
- New: `playwright.config.ts`
- New: `tests/unit/cards/validation.test.ts`
- New: `tests/unit/scryfall/import-mapper.test.ts`
- New: `tests/unit/scryfall/mana-glyphs.test.ts` (after chunk 02 lands)
- New: `tests/e2e/auth.spec.ts`
- New: `tests/e2e/create-card.spec.ts`
- New: `tests/e2e/scryfall-import.spec.ts`
- Modify: `package.json` — add scripts
- Optional: `.github/workflows/test.yml`

## Implementation approach

- Vitest with `happy-dom` for component tests; `node` environment for
  lib tests.
- Playwright runs against `npm run dev` (use the
  `webServer` config to start it automatically).
- For Scryfall e2e: intercept `https://api.scryfall.com/cards/search`
  with a fixture response so the test doesn't depend on a live API.
- Auth e2e: spins up against the local Supabase or a dedicated test
  project — document the env vars in a comment.
- Don't add tests for the existing UI components — too much surface for
  too little value at this stage.

## Acceptance criteria

- `npm run test:unit` runs the unit tests and they pass.
- `npm run test:e2e` runs Playwright against a started dev server and
  the three e2e specs pass.
- `npm test` runs both.
- Optional CI workflow runs on push and pull request.
- Adding a regression test for a future bug is one new file in
  `tests/unit/...` or `tests/e2e/...`.

## Dependencies

None directly. Best done LAST because every prior chunk benefits from
having a regression test added at the time of implementation, and this
chunk seeds the harness those tests live in.

## Estimated effort

~5 hours.

## Done when

`npm run test` exits 0 with passing unit + e2e suites locally. A
`tests/unit/cards/validation.test.ts` covers at least the schema's
slug, cost, and visibility branches with assertions.
