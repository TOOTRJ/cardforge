// ---------------------------------------------------------------------------
// Ids — the one UUID shape check for route params, action inputs and query
// filters (every table key is a uuid), plus the random id used for storage
// object names. Dependency-free and client-safe.
// ---------------------------------------------------------------------------

/** RFC 4122 text form, any version or variant — what Postgres' uuid type
 *  accepts. Zod's `.uuid()` stays on the write schemas (lib/validation); this
 *  is the cheap pre-query guard for ids that arrive as plain strings. */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Random id for a storage object name. `crypto.randomUUID()` exists in
 *  every runtime we deploy to (Node 19+, browsers, the edge); the fallback
 *  only needs to be unique within one user's folder, not unguessable. */
export function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
