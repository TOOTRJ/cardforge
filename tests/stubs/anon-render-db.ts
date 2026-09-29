// ---------------------------------------------------------------------------
// An in-memory stand-in for migration 0125's anonymous live-render limiter:
// public.anon_render_hits and hit_anon_render_limit(key, per_minute,
// per_hour), for the admin client's `.rpc()`.
//
// It follows the SQL of supabase/migrations/0125_anon_render_limit.sql step
// for step — drop every window the hour no longer reads; read the current
// minute and the last hour (windows > minute − 1 h) for the key; over the
// minute limit → (false, seconds to the next minute); over the hour limit →
// (false, seconds until the oldest counted minute leaves the hour); else
// count the hit in the current minute → (true, 0). A refused call counts
// nothing. tests/unit/db/anon-render-limit-migration.test.ts pins the SQL to
// that order, so the model and the migration can't drift silently.
//
// The clock is the test's (`now`), never Date.now: a run that straddles a
// minute boundary must not reset the window under an assertion.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type AnonRenderArgs = { p_key_hash: string; p_per_minute: number; p_per_hour: number };
export type AnonRenderRow = { key_hash: string; window_start: number; hits: number };

export function anonRenderDb(opts: { now: () => number }) {
  const rows: AnonRenderRow[] = [];
  const calls: AnonRenderArgs[] = [];

  async function rpc(name: string, args: AnonRenderArgs) {
    await Promise.resolve();
    if (name !== "hit_anon_render_limit") {
      return { data: null, error: { message: `unknown rpc ${name}` } };
    }
    calls.push(args);
    if (!/^[0-9a-f]{32}$/.test(args.p_key_hash)) {
      return { data: null, error: { message: "anon render limit: the key must be 32 hex digits" } };
    }
    const t = opts.now();
    const window = Math.floor(t / MINUTE_MS) * MINUTE_MS;

    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].window_start <= window - HOUR_MS) rows.splice(i, 1);
    }

    const mine = rows.filter((r) => r.key_hash === args.p_key_hash && r.window_start > window - HOUR_MS);
    const minute = mine.filter((r) => r.window_start === window).reduce((n, r) => n + r.hits, 0);
    const hour = mine.reduce((n, r) => n + r.hits, 0);

    if (minute >= args.p_per_minute) {
      return {
        data: [{ allowed: false, retry_after_seconds: Math.max(1, Math.ceil((window + MINUTE_MS - t) / 1000)) }],
        error: null,
      };
    }
    if (hour >= args.p_per_hour) {
      const oldest = Math.min(...mine.map((r) => r.window_start));
      return {
        data: [{ allowed: false, retry_after_seconds: Math.max(1, Math.ceil((oldest + HOUR_MS - t) / 1000)) }],
        error: null,
      };
    }

    const row = rows.find((r) => r.key_hash === args.p_key_hash && r.window_start === window);
    if (row) row.hits += 1;
    else rows.push({ key_hash: args.p_key_hash, window_start: window, hits: 1 });
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  }

  return { client: { rpc }, rows, calls };
}
