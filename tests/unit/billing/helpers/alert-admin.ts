// A stateful stand-in for the two reads and one write of
// lib/billing/credit-alerts.ts: the admin lookup (profiles where is_admin),
// the dedupe read (notifications by type + payload->>dedupeKey) and the
// insert — which enforces migration 0140's unique index on
// (payload->>'dedupeKey', recipient_id) for credit_refill_failed rows, so a
// test sees the same 23505 a real concurrent run would.

export type StoredNotification = {
  recipient_id: string;
  actor_id: string | null;
  type: string;
  payload: Record<string, unknown>;
};

export function makeAlertAdmin(opts: {
  adminIds: string[];
  notifications?: StoredNotification[];
  adminLookupError?: string;
  insertError?: string;
  /** Skip the dedupe read's result (as a racing run that hasn't committed). */
  blindDedupeRead?: boolean;
}) {
  const notifications: StoredNotification[] = opts.notifications ?? [];
  const insertCalls: StoredNotification[][] = [];
  const admin = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: async (column: string, value: unknown) => {
              if (column !== "is_admin" || value !== true) throw new Error("unexpected profiles filter");
              if (opts.adminLookupError) return { data: null, error: { message: opts.adminLookupError } };
              return { data: opts.adminIds.map((id) => ({ id })), error: null };
            },
          }),
        };
      }
      if (table === "notifications") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return chain;
              },
              then(resolve: (v: unknown) => unknown) {
                const rows = opts.blindDedupeRead
                  ? []
                  : notifications.filter(
                      (n) => n.type === filters.type && n.payload.dedupeKey === filters["payload->>dedupeKey"],
                    );
                return Promise.resolve({ data: rows.map((n) => ({ recipient_id: n.recipient_id })), error: null }).then(resolve);
              },
            };
            return chain;
          },
          insert: async (rows: StoredNotification[]) => {
            insertCalls.push(rows);
            if (opts.insertError) return { error: { message: opts.insertError } };
            const clash = rows.some(
              (row) =>
                row.type === "credit_refill_failed" &&
                notifications.some(
                  (n) =>
                    n.type === row.type &&
                    n.recipient_id === row.recipient_id &&
                    n.payload.dedupeKey === row.payload.dedupeKey,
                ),
            );
            if (clash) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
            notifications.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, notifications, insertCalls };
}
