// Stub for the `server-only` build-time guard, which has no standalone package
// to resolve under vitest. Aliased in vitest.config.ts so server modules (e.g.
// lib/stripe/config.ts) can be imported in unit tests.
export {};
