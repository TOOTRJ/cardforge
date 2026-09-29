import { vi } from "vitest";
import { chainClient, called, payloadOf, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// An in-memory stand-in for the automatic re-bake's tables (migration 0120):
// the single render_sweep_state row, the lease RPCs, the pending-card count,
// the poison prune's lookup, the admin lookup and the notifications insert. Builds on chainClient, so
// every chain is recorded for assertions.
//
// The lease RPCs follow the SQL of supabase/migrations/0120_auto_rebake.sql
// branch for branch — the lease is free when it has no expiry, has expired,
// is the caller's own token, or is PARKED (no token) for the same holder.
// tests/unit/db/auto-rebake-migration.test.ts pins the SQL to those four
// branches, so this model and the migration can't drift silently. Each RPC
// evaluates and writes in one synchronous step after an await, just as the
// real UPDATE is atomic under its row lock.
// ---------------------------------------------------------------------------

export type SweepRow = {
  id: 1;
  lease_holder: "cron" | "manual" | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  lease_acquired_at: string | null;
  yield_requested_at: string | null;
  paused: boolean;
  paused_reason: string | null;
  paused_at: string | null;
  strikes: Record<string, unknown>;
  poison: unknown[];
  in_flight: unknown[];
  last_run: Record<string, unknown> | null;
  idle: Record<string, unknown> | null;
  last_checked_at: string | null;
  revalidate_pending: boolean;
  updated_at: string;
};

export function emptySweepRow(): SweepRow {
  return {
    id: 1,
    lease_holder: null,
    lease_token: null,
    lease_expires_at: null,
    lease_acquired_at: null,
    yield_requested_at: null,
    paused: false,
    paused_reason: null,
    paused_at: null,
    strikes: {},
    poison: [],
    in_flight: [],
    last_run: null,
    idle: null,
    last_checked_at: null,
    revalidate_pending: false,
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

export function sweepDb(opts: {
  now: () => number;
  row?: Partial<SweepRow>;
  /** What the pending-card head count answers (sees the recorded chain). */
  count?: (calls: ChainCall[]) => number;
  /** Which poisoned card ids still owe a re-bake (the poison prune's lookup).
   *  Default: all of them. */
  owed?: (id: string) => boolean;
  admins?: string[];
}) {
  const row: SweepRow = { ...emptySweepRow(), ...opts.row };
  const iso = (ms: number) => new Date(ms).toISOString();
  const notifications: unknown[] = [];
  let countCalls = 0;

  const chain = chainClient((table, calls) => {
    if (table === "render_sweep_state") {
      if (called(calls, "update")) {
        Object.assign(row, payloadOf(calls, "update") as Partial<SweepRow>);
        return { data: null };
      }
      return { data: { ...row } };
    }
    if (table === "cards") {
      const idFilter = calls.find((c) => c.method === "in" && c.args[0] === "id");
      if (idFilter) {
        // The poison prune: which of these cards still owe a re-bake.
        const ids = idFilter.args[1] as string[];
        return { data: ids.filter((id) => (opts.owed ? opts.owed(id) : true)).map((id) => ({ id })) };
      }
      countCalls += 1;
      return { count: opts.count ? opts.count(calls) : 0 };
    }
    if (table === "profiles") {
      return { data: (opts.admins ?? []).map((id) => ({ id })) };
    }
    if (table === "notifications") {
      const rows = payloadOf(calls, "insert");
      notifications.push(...(Array.isArray(rows) ? rows : [rows]));
      return { data: null };
    }
    return { data: null };
  });

  const leaseFree = (holder: string, token: string) =>
    row.lease_expires_at == null ||
    Date.parse(row.lease_expires_at) <= opts.now() ||
    row.lease_token === token ||
    (row.lease_token == null && row.lease_holder === holder);

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    await Promise.resolve();
    const now = opts.now();
    if (fn === "acquire_render_sweep_lease") {
      const holder = args.p_holder as "cron" | "manual";
      const token = args.p_token as string;
      if (leaseFree(holder, token)) {
        row.lease_holder = holder;
        row.lease_token = token;
        row.lease_expires_at = iso(now + (args.p_ttl_seconds as number) * 1000);
        row.lease_acquired_at = iso(now);
        row.yield_requested_at = null;
        return { data: [{ acquired: true, holder, expires_at: row.lease_expires_at }], error: null };
      }
      return { data: [{ acquired: false, holder: row.lease_holder, expires_at: row.lease_expires_at }], error: null };
    }
    if (fn === "release_render_sweep_lease") {
      if (row.lease_token == null || row.lease_token !== args.p_token) return { data: false, error: null };
      const park = (args.p_park_seconds as number) ?? 0;
      row.lease_token = null;
      if (park > 0) {
        row.lease_expires_at = iso(now + park * 1000);
      } else {
        row.lease_holder = null;
        row.lease_expires_at = null;
      }
      return { data: true, error: null };
    }
    if (fn === "request_render_sweep_yield") {
      if (
        row.lease_holder === "cron" &&
        row.lease_token != null &&
        row.lease_expires_at != null &&
        Date.parse(row.lease_expires_at) > now
      ) {
        row.yield_requested_at = iso(now);
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  });

  const client = { from: chain.client.from, rpc };
  return {
    // The service-role client type is irrelevant to these fakes.
    client: client as never,
    row,
    rpc,
    notifications,
    log: chain.log,
    forTable: chain.forTable,
    countCalls: () => countCalls,
    /** Writes to render_sweep_state, in order. */
    stateWrites: () =>
      chain
        .forTable("render_sweep_state")
        .filter((e) => called(e.calls, "update"))
        .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>),
  };
}
