// Master switch for the SETS feature (browse/detail/dashboard pages, the
// "Add to set" pickers, set stats on card pages). Temporarily OFF (owner
// decision, 2026-07-10) — sets may return later, so everything is gated, not
// deleted: data, migrations, and code paths all stay intact.
//
// NEXT_PUBLIC_ so server components, route handlers, and client components
// (nav, creator panels) can all read it. Unset/anything-but-"true" = hidden.
export function isSetsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SETS_ENABLED === "true";
}
