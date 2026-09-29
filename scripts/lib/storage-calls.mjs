// ---------------------------------------------------------------------------
// storage-calls.mjs — how the owner-run storage sweep (scripts/sweep-storage-
// orphans.mjs and its --private-renders / --rescan-review modes) talks to
// Supabase Storage: every call — a listing page, a lookup, a download, a
// remove — goes through ONE small limiter shared by the whole run (at most
// `--storage-concurrency` in flight, default 4, max 8), and a call storage
// answers "overloaded" is retried with backoff before anything counts it as
// failed.
//
// Why (incident 2026-09-29): production's first `--apply --batch-size 100`
// deleted 193 objects, then a batch failed — 7 objects "couldn't confirm the
// delete (Too many connections issued to the database)". Each batch fired
// every lookup at once (100 before the remove, 100 after it), and every
// Storage API request takes a connection from storage's own database pool,
// which ran dry. Nothing was lost (the copies, the manifest and the pending
// state settled it); the fix is to never ask for more than a few at a time.
// The batch size still decides how often the whole database is re-read, not
// how many storage calls run at once.
//
// A call is retried (STORAGE_ATTEMPTS tries in all, ~1 s / 2 s / 4 s apart,
// ±25 % jitter) when storage says it is busy — "Too many connections", a
// pool timeout, a rate limit, HTTP 408 / 429 / 5xx — or never answered (a
// network error). Anything else (a 400, a 404, a refused key) fails at once.
// A retry keeps its slot while it waits, so a busy storage gets fewer calls
// from us, not the same number again. Retrying is safe for every call made
// here: lookups, listings and downloads read, and a remove of an object that
// is already gone is a no-op (what is gone is decided by the lookup after it
// anyway).
// ---------------------------------------------------------------------------

export const DEFAULT_STORAGE_CONCURRENCY = 4;
export const MAX_STORAGE_CONCURRENCY = 8;
/** Tries per storage call: the first + retries while storage is busy. */
export const STORAGE_ATTEMPTS = 4;
export const STORAGE_RETRY_BASE_MS = 1000;
export const STORAGE_RETRY_MAX_MS = 15_000;
/** Entries per listing page (the size the sweep has always asked for). */
export const LIST_PAGE_SIZE = 1000;

/** Marks a storage object that already goes through a limiter. */
const LIMITED = Symbol.for("pipglyph.storage-calls.limited");

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * At most `max` calls of `run(fn)` in flight at a time; the rest wait in
 * order (FIFO). A finished call hands its slot straight to the next waiter,
 * so a call made in between can never squeeze past the cap. `peak` is the
 * most that were ever in flight together.
 */
export function createLimiter(max) {
  if (!(Number.isInteger(max) && max >= 1)) throw new Error("a limiter needs a whole number of slots, at least 1");
  let active = 0;
  let peak = 0;
  const waiting = [];
  return {
    max,
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    async run(fn) {
      if (active < max) active += 1;
      else await new Promise((resolve) => waiting.push(resolve)); // the slot is handed over, `active` unchanged
      peak = Math.max(peak, active);
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}

/** What storage says when it is overloaded, whatever status it comes with
 *  (the Storage API's own database pool, a proxy, a rate limit). */
const BUSY = /too many connections|timeout acquiring a connection|connection pool|remaining connection slots|too many requests|rate limit|slow ?down/i;

/**
 * Whether a failed storage call is worth trying again: storage was busy
 * (the messages above, HTTP 408 / 429 / 5xx) or never answered (`network`).
 * A 4xx about the object or the request — not found, bad request, refused
 * key — is not: it would say the same again.
 */
export function isRetryableStorageError(err) {
  if (!err) return false;
  if (err.network === true) return true;
  const status = typeof err.status === "number" ? err.status : Number.NaN;
  if (status === 408 || status === 429 || status >= 500) return true;
  return BUSY.test(String(err.message ?? ""));
}

/**
 * An Error for a storage-js `{ error }` that keeps what the retry needs: the
 * HTTP status (`status`), storage's own code (`code`, e.g. "404" or
 * "DatabaseTimeout") and whether there was no HTTP answer at all (`network`
 * — storage-js's StorageUnknownError: a refused or reset connection). The
 * message is storage's own, after `prefix`.
 *
 * @param {any} error
 * @param {string} [prefix]
 * @returns {Error & { status?: number, code?: string, network?: boolean }}
 */
export function storageCallError(error, prefix = "") {
  const err = new Error(`${prefix}${error?.message || "storage error"}`);
  if (typeof error?.status === "number") err.status = error.status;
  if (error?.statusCode !== undefined && error?.statusCode !== null) err.code = String(error.statusCode);
  if (err.status === undefined && error?.name === "StorageUnknownError") err.network = true;
  return err;
}

/** The wait before try `attempt + 1`: 1 s, 2 s, 4 s … (capped), ±25 %. */
export function backoffMs(attempt, random = Math.random) {
  const base = Math.min(STORAGE_RETRY_BASE_MS * 2 ** (attempt - 1), STORAGE_RETRY_MAX_MS);
  return Math.round(base * (0.75 + random() * 0.5));
}

/**
 * Every object under `prefix` in `bucket`, depth-first, one listing page at a
 * time (folders have id null). `listPage(bucket, prefix, { offset, limit })`
 * → the Storage API's entries for that page.
 */
export async function* listObjects(listPage, bucket, prefix = "") {
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const data = await listPage(bucket, prefix, { offset, limit: LIST_PAGE_SIZE });
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) yield* listObjects(listPage, bucket, full);
      else
        yield {
          bucket,
          path: full,
          etag: entry.metadata?.eTag ?? null,
          size: entry.metadata?.size ?? null,
          createdAt: entry.created_at ?? null,
          updatedAt: entry.updated_at ?? null,
          lastModified: entry.metadata?.lastModified ?? null,
          contentType: entry.metadata?.mimetype ?? null,
        };
    }
    if (!data || data.length < LIST_PAGE_SIZE) return;
  }
}

/**
 * `storage` with every call limited and retried (see the header):
 * `info(bucket, path)`, `remove(bucket, paths)`, `download(bucket, path)` and
 * the listing — built page by page from `storage.listPage` when it has one,
 * so every page is a limited call too; a `storage.list` given as a whole (an
 * in-memory test fake) is passed through. Each call looks its method up on
 * `storage` when it is made.
 *
 * Already limited → returned as it is, so the one limiter the script builds
 * is the one every helper uses; the helpers call this on whatever they are
 * given, so a raw storage handed to them is never called without a cap.
 * `log` gets one line per retry.
 *
 * @param {any} storage
 * @param {{
 *   concurrency?: number,
 *   attempts?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   random?: () => number,
 *   log?: (line: string) => void,
 * }} [options]
 */
export function limitStorage(
  storage,
  {
    concurrency = DEFAULT_STORAGE_CONCURRENCY,
    attempts = STORAGE_ATTEMPTS,
    sleep = defaultSleep,
    random = Math.random,
    log = () => {},
  } = {},
) {
  if (!storage) throw new Error("no storage to limit");
  if (storage[LIMITED]) return storage;
  if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= MAX_STORAGE_CONCURRENCY)) {
    throw new Error(`storage concurrency must be a whole number from 1 to ${MAX_STORAGE_CONCURRENCY}`);
  }
  if (!(Number.isInteger(attempts) && attempts >= 1)) throw new Error("attempts must be a whole number, at least 1");
  const limiter = createLimiter(concurrency);
  const call = (what, fn) =>
    limiter.run(async () => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await fn();
        } catch (err) {
          if (attempt >= attempts || !isRetryableStorageError(err)) throw err;
          const wait = backoffMs(attempt, random);
          log(`    (storage busy on ${what}: ${err.message} — try ${attempt + 1} of ${attempts} in ${(wait / 1000).toFixed(1)} s)`);
          await sleep(wait);
        }
      }
    });
  const limited = {
    [LIMITED]: true,
    limiter,
    concurrency,
    info: (bucket, objectPath) => call(`info ${bucket}/${objectPath}`, () => storage.info(bucket, objectPath)),
    remove: (bucket, paths) => call(`remove of ${paths.length} object(s) in ${bucket}`, () => storage.remove(bucket, paths)),
    download: (bucket, objectPath) => call(`download ${bucket}/${objectPath}`, () => storage.download(bucket, objectPath)),
  };
  if (typeof storage.listPage === "function") {
    limited.listPage = (bucket, prefix, page) =>
      call(`list ${bucket}/${prefix}${page?.offset ? ` (from ${page.offset})` : ""}`, () => storage.listPage(bucket, prefix, page));
    limited.list = (bucket, prefix = "") => listObjects(limited.listPage, bucket, prefix);
  } else if (typeof storage.list === "function") {
    limited.list = (bucket, prefix) => storage.list(bucket, prefix);
  }
  return limited;
}
