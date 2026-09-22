import { vi } from "vitest";

// ---------------------------------------------------------------------------
// A recording, chainable stand-in for a Supabase client. Every builder method
// (`select`, `eq`, `update`, `is`, `order`, …) records itself and returns the
// same builder; awaiting the builder hands the recorded chain to `resolve`,
// which decides what the "database" answers. Tests assert on the recorded
// chains (`log`) and script answers per table/operation — no PostgREST
// typing games, no network.
// ---------------------------------------------------------------------------

export type ChainCall = { method: string; args: unknown[] };
export type ChainEntry = { table: string; calls: ChainCall[] };
export type ChainAnswer = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};
export type ChainResolver = (table: string, calls: ChainCall[]) => ChainAnswer;

/** `calls` has a `method` call whose first argument equals `arg`. */
export function called(calls: ChainCall[], method: string, arg?: unknown): boolean {
  return calls.some(
    (c) => c.method === method && (arg === undefined || c.args[0] === arg),
  );
}

/** The first argument of the first `method` call (the update/insert payload). */
export function payloadOf(calls: ChainCall[], method: string): unknown {
  return calls.find((c) => c.method === method)?.args[0];
}

export function chainClient(resolve: ChainResolver) {
  const log: ChainEntry[] = [];
  const from = (table: string) => {
    const entry: ChainEntry = { table, calls: [] };
    log.push(entry);
    const builder: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (
              onFulfilled: (value: ChainAnswer) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) =>
              Promise.resolve()
                .then(() => {
                  const answer = resolve(table, entry.calls);
                  return { data: null, error: null, count: null, ...answer };
                })
                .then(onFulfilled, onRejected);
          }
          return (...args: unknown[]) => {
            entry.calls.push({ method: String(prop), args });
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const rpc = vi.fn(async (): Promise<ChainAnswer> => ({ data: null, error: null }));
  return {
    client: { from, rpc },
    log,
    rpc,
    /** Recorded chains against one table. */
    forTable: (table: string) => log.filter((e) => e.table === table),
  };
}
