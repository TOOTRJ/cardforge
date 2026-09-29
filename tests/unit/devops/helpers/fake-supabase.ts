import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Fakes for the owner-run storage scripts' tests (TODO 3.14b —
// scripts/sweep-storage-orphans.mjs and its --private-renders /
// --rescan-review modes): an in-memory database + storage for the helpers,
// and a fake Supabase over HTTP (Storage + PostgREST + its OpenAPI document)
// for the real CLI. Shared by sweep-storage-orphans.test.ts,
// sweep-private-renders.test.ts and sweep-rescan-review.test.ts.
// ---------------------------------------------------------------------------

// --- fake database -----------------------------------------------------------------

export type Row = Record<string, unknown>;
export type TableDef = { pk: string[]; columns: Record<string, string>; rows: Row[] };
export type Db = Record<string, TableDef>;

/** Every table the app has, with its real column types (as PostgREST's
 *  OpenAPI document spells them) and no rows. */
export function emptyDb(): Db {
  const t = (pk: string[], columns: Record<string, string>): TableDef => ({ pk, columns, rows: [] });
  return {
    cards: t(["id"], {
      id: "uuid",
      owner_id: "uuid",
      title: "text",
      art_url: "text",
      back_face: "jsonb",
      set_icon_url: "text",
      watermark: "jsonb",
      face_content: "jsonb",
      metadata: "jsonb",
      rendered_image_url: "text",
      rendered_thumb_url: "text",
      tags: "text[]",
      created_at: "timestamp with time zone",
      likes_count: "integer",
    }),
    profiles: t(["id"], { id: "uuid", avatar_url: "text", banner_url: "text", bio: "text" }),
    decks: t(["id"], { id: "uuid", cover_url: "text", cover_position: "jsonb" }),
    deck_cards: t(["id"], { id: "uuid", deck_id: "uuid", image_url: "text" }),
    custom_pips: t(["id"], { id: "uuid", symbol: "text", image_url: "text" }),
    challenges: t(["id"], { id: "uuid", hero_image_url: "text" }),
    ai_generation_jobs: t(["id"], { id: "uuid", request: "jsonb", plan: "jsonb", steps: "jsonb" }),
    card_idea_batches: t(["id"], { id: "uuid", request: "jsonb", ideas: "jsonb" }),
    deck_idea_batches: t(["id"], { id: "uuid", request: "jsonb", ideas: "jsonb" }),
    notifications: t(["id"], { id: "bigint", payload: "jsonb" }),
    site_updates: t(["id"], { id: "uuid", summary: "text", body: "text", link_href: "text" }),
    card_exports: t(["id"], { id: "uuid", file_url: "text", storage_path: "text" }),
    messages: t(["id"], { id: "uuid", body: "text" }),
    feedback: t(["id"], { id: "uuid", page_url: "text" }),
    site_settings: t(["key"], { key: "text", value: "jsonb" }),
    frame_reviews: t(["template", "color_key"], { template: "text", color_key: "text", score_json: "jsonb" }),
    card_likes: t(["id"], { id: "uuid", card_id: "uuid", user_id: "uuid" }),
  };
}

export function openApiOf(db: Db) {
  return {
    swagger: "2.0",
    definitions: Object.fromEntries(
      Object.entries(db).map(([name, def]) => [
        name,
        {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(def.columns).map(([c, format]) => [
              c,
              { format, type: "string", ...(def.pk.includes(c) ? { description: "Note:\nThis is a Primary Key.<pk/>" } : {}) },
            ]),
          ),
        },
      ]),
    ),
  };
}

export const compare = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

/** PostgREST's semantics for what the scan asks: select, order, `gt` on the
 *  first order column, offset, limit — capped at `maxRows` like a server
 *  whose max-rows is below the page the client asks for. */
export function selectRows(db: Db, table: string, q: { columns: string[]; order: string[]; after: unknown; offset: number; limit: number }, maxRows = Infinity) {
  const def = db[table];
  if (!def) throw new Error(`relation "${table}" does not exist`);
  for (const c of q.columns) if (!(c in def.columns)) throw new Error(`column ${table}.${c} does not exist`);
  let rows = [...def.rows].sort((a, b) => {
    for (const c of q.order) {
      const d = compare(a[c], b[c]);
      if (d) return d;
    }
    return 0;
  });
  if (q.after !== null && q.after !== undefined) rows = rows.filter((r) => compare(r[q.order[0]], q.after) > 0);
  return rows
    .slice(q.offset, q.offset + Math.min(q.limit, maxRows))
    .map((r) => Object.fromEntries(q.columns.map((c) => [c, r[c] ?? null])));
}

export function fakeDb(db: Db, opts: { maxRows?: number; failOn?: string; onScan?: (n: number) => void } = {}) {
  let scans = 0;
  return {
    selects: [] as string[],
    async openApi() {
      scans += 1;
      opts.onScan?.(scans);
      return openApiOf(db);
    },
    async select(table: string, q: { columns: string[]; order: string[]; after: unknown; offset: number; limit: number }) {
      this.selects.push(table);
      if (opts.failOn === table) throw new Error(`read ${table}: boom`);
      return selectRows(db, table, q, opts.maxRows);
    },
  };
}

// --- fake storage --------------------------------------------------------------------

export type Obj = { bucket: string; path: string; size: number; etag: string; createdAt: string; updatedAt: string; lastModified: string };

export type StorageOpts = {
  removeFails?: boolean;
  downloadFails?: string;
  /** What remove() echoes back: the paths (default), nothing, or other names. */
  echo?: "paths" | "none" | "renamed";
  /** Paths remove() names as removed but leaves in place. */
  sticky?: string[];
  /** info() throws for these paths once a remove has run. */
  lookupFailsAfterRemove?: string[];
  /** How info() formats the eTag (the listing keeps the stored form). */
  infoEtag?: (etag: string) => string;
  /** Storage's own database pool (incident 2026-09-29): a call made while
   *  this many are already in flight fails with "Too many connections issued
   *  to the database". Every call then takes a macrotask, so calls made
   *  together really overlap. */
  maxConcurrent?: number;
  /** info() of these paths answers "Too many connections…" this many times
   *  first (then normally) — a busy storage, whatever the concurrency. */
  busyInfo?: Record<string, number>;
  /** The same, counted only once a remove has run (the confirm lookups). */
  busyInfoAfterRemove?: Record<string, number>;
};

/** What Supabase Storage answered on 2026-09-29 when its database pool ran
 *  dry — an error with no HTTP status here, as an in-memory fake has none
 *  (the HTTP fake below adds one). */
export const tooManyConnections = () => new Error("Too many connections issued to the database");

export function fakeStorage(objects: Obj[], opts: StorageOpts = {}) {
  const store = new Map(objects.map((o) => [`${o.bucket}/${o.path}`, { ...o }]));
  let removed = false;
  /** `peak`: most calls in flight at once; `refused`: calls the pool turned away. */
  const stats = { inFlight: 0, peak: 0, refused: 0 };
  const busyLeft = new Map(Object.entries(opts.busyInfo ?? {}));
  const busyAfterRemoveLeft = new Map(Object.entries(opts.busyInfoAfterRemove ?? {}));
  const pool = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    if (opts.maxConcurrent === undefined) return fn();
    if (stats.inFlight >= opts.maxConcurrent) {
      stats.refused += 1;
      throw tooManyConnections();
    }
    stats.inFlight += 1;
    stats.peak = Math.max(stats.peak, stats.inFlight);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await fn();
    } finally {
      stats.inFlight -= 1;
    }
  };
  return {
    store,
    stats,
    removes: [] as string[][],
    async info(bucket: string, p: string) {
      return pool(() => {
        for (const left of removed ? [busyLeft, busyAfterRemoveLeft] : [busyLeft]) {
          const busy = left.get(p) ?? 0;
          if (busy > 0) {
            left.set(p, busy - 1);
            throw tooManyConnections();
          }
        }
        if (removed && opts.lookupFailsAfterRemove?.includes(p)) throw new Error("lookup timed out");
        const o = store.get(`${bucket}/${p}`);
        return o
          ? { etag: opts.infoEtag ? opts.infoEtag(o.etag) : o.etag, size: o.size, createdAt: o.createdAt, lastModified: o.updatedAt }
          : { missing: true as const };
      });
    },
    async remove(bucket: string, paths: string[]) {
      return pool(() => {
        this.removes.push(paths.map((p) => `${bucket}/${p}`));
        if (opts.removeFails) throw new Error("gateway timeout");
        removed = true;
        const gone = paths.filter((p) => opts.sticky?.includes(p) || store.delete(`${bucket}/${p}`));
        if (opts.echo === "none") return [];
        if (opts.echo === "renamed") return gone.map((p) => `${bucket}/${p}`);
        return gone;
      });
    },
    async download(bucket: string, p: string) {
      return pool(() => {
        if (opts.downloadFails === p) throw new Error("download failed");
        return Buffer.from(`bytes of ${bucket}/${p}`);
      });
    },
  };
}

// --- a fake Supabase over HTTP ------------------------------------------------------------

export type StoredObject = { bytes: Buffer; etag: string; created: string; updated: string; contentType?: string };

/** Query parameters that aren't a row filter. */
const NOT_FILTERS = new Set(["select", "order", "limit", "offset", "columns"]);

const typed = (def: TableDef, column: string, raw: string): unknown =>
  ["bigint", "integer", "smallint"].includes(def.columns[column]) ? Number(raw) : raw;

/** One PostgREST filter the scripts send: eq, gt, in, is.null, not.is.null. */
function condition(table: string, def: TableDef, column: string, expr: string): (row: Row) => boolean {
  if (!(column in def.columns)) throw new Error(`column ${table}.${column} does not exist`);
  if (expr === "is.null") return (r) => r[column] == null;
  if (expr === "not.is.null") return (r) => r[column] != null;
  const m = expr.match(/^(eq|gt|in)\.([\s\S]*)$/);
  if (!m) throw new Error(`unsupported filter ${column}=${expr}`);
  const [, op, raw] = m;
  if (op === "eq") return (r) => r[column] != null && String(r[column]) === raw;
  if (op === "gt") {
    const v = typed(def, column, raw);
    return (r) => r[column] != null && compare(r[column], v) > 0;
  }
  const list = raw
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((v) => v.replace(/^"|"$/g, ""));
  return (r) => r[column] != null && list.includes(String(r[column]));
}

/** Every row filter in `params` (`or=(a.op.v,b.op.v)` included), ANDed. */
function rowFilter(table: string, def: TableDef, params: URLSearchParams): (row: Row) => boolean {
  const tests: ((row: Row) => boolean)[] = [];
  for (const [k, v] of params) {
    if (NOT_FILTERS.has(k)) continue;
    if (k === "or") {
      const parts = v
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((part) => {
          const [column, ...rest] = part.split(".");
          return condition(table, def, column, rest.join("."));
        });
      tests.push((r) => parts.some((f) => f(r)));
    } else {
      tests.push(condition(table, def, k, v));
    }
  }
  return (row) => tests.every((t) => t(row));
}

export type FakeSupabaseHooks = {
  onOpenApi?: () => void;
  /** Every PostgREST call: its method, table and query. */
  onRest?: (method: string, table: string, params: URLSearchParams) => void;
  /** A server max-rows below what the client asks for: a GET returns at most
   *  this many rows (its `Prefer: count=exact` total still counts them all). */
  maxRows?: () => number;
  /** Storage's own database pool (incident 2026-09-29), for every
   *  /storage/v1/ request: one that arrives while `max` are in flight — or
   *  that `refuse(method, path)` picks — is answered like production answered
   *  that day ("Too many connections issued to the database"; HTTP 544 here,
   *  storage's pool-timeout status — the script retries on the message
   *  whatever the status). `delayMs` holds every storage answer back so
   *  requests sent together overlap. `peak` / `refused` are filled in. */
  storagePool?: StoragePool;
};

export type StoragePool = {
  max?: number;
  delayMs?: number;
  refuse?: (method: string, path: string) => boolean;
  inFlight: number;
  peak: number;
  refused: number;
};

export const storagePool = (opts: Partial<Pick<StoragePool, "max" | "delayMs" | "refuse">> = {}): StoragePool => ({
  ...opts,
  inFlight: 0,
  peak: 0,
  refused: 0,
});

/** Storage (list / info / download / remove) + PostgREST (the OpenAPI
 *  document, GET with select/order/limit/offset and the filters above, PATCH)
 *  over HTTP, backed by `store` and `db`. */
export function fakeSupabase(store: Map<string, StoredObject>, db: Db, hooks: FakeSupabaseHooks = {}): Server {
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const parts: Buffer[] = [];
      req.on("data", (d) => parts.push(d));
      req.on("end", () => resolve(Buffer.concat(parts)));
    });
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  return createServer(async (req, res) => {
    const pool = hooks.storagePool;
    const early = new URL(req.url ?? "/", "http://x");
    if (pool && early.pathname.startsWith("/storage/v1/")) {
      const path = decodeURIComponent(early.pathname);
      if ((pool.max !== undefined && pool.inFlight >= pool.max) || pool.refuse?.(req.method ?? "GET", path)) {
        pool.refused += 1;
        await readBody(req);
        return json(res, 544, { statusCode: "544", code: "DatabaseTimeout", error: "DatabaseTimeout", message: "Too many connections issued to the database" });
      }
      pool.inFlight += 1;
      pool.peak = Math.max(pool.peak, pool.inFlight);
      // Out of the pool the moment the answer is written (before the client
      // can see it and send the next request).
      const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
      let released = false;
      res.end = ((...args: unknown[]) => {
        if (!released) {
          released = true;
          pool.inFlight -= 1;
        }
        return end(...args);
      }) as typeof res.end;
      if (pool.delayMs) await new Promise((resolve) => setTimeout(resolve, pool.delayMs));
    }
    const body = await readBody(req);
    const u = new URL(req.url ?? "/", "http://x");
    const p = decodeURIComponent(u.pathname);
    if (req.method === "GET" && (p === "/rest/v1/" || p === "/rest/v1")) {
      hooks.onOpenApi?.();
      return json(res, 200, openApiOf(db));
    }
    if ((req.method === "GET" || req.method === "PATCH") && p.startsWith("/rest/v1/")) {
      const table = p.slice("/rest/v1/".length);
      hooks.onRest?.(req.method, table, u.searchParams);
      const def = db[table];
      if (!def) return json(res, 404, { message: `relation "${table}" does not exist` });
      try {
        const columns = (u.searchParams.get("select") ?? "*").split(",");
        for (const c of columns) if (c !== "*" && !(c in def.columns)) throw new Error(`column ${table}.${c} does not exist`);
        const matches = def.rows.filter(rowFilter(table, def, u.searchParams));
        const project = (rows: Row[]) =>
          rows.map((r) => (columns[0] === "*" ? { ...r } : Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))));
        if (req.method === "PATCH") {
          const changes = JSON.parse(body.toString() || "{}");
          for (const row of matches) Object.assign(row, changes);
          if (!u.searchParams.has("select")) {
            res.writeHead(204);
            return res.end();
          }
          return json(res, 200, project(matches));
        }
        const order = (u.searchParams.get("order") ?? "").split(",").filter(Boolean).map((o) => o.split(".")[0]);
        const sorted = [...matches].sort((a, b) => {
          for (const c of order) {
            const d = compare(a[c], b[c]);
            if (d) return d;
          }
          return 0;
        });
        const offset = Number(u.searchParams.get("offset") ?? 0);
        const limit = Math.min(Number(u.searchParams.get("limit") ?? 1000), hooks.maxRows?.() ?? Infinity);
        const page = sorted.slice(offset, offset + limit);
        // PostgREST's answer to `Prefer: count=exact`: the page's range and the total.
        const counted: Record<string, string> = /count=exact/.test(String(req.headers.prefer ?? ""))
          ? { "content-range": `${page.length ? `${offset}-${offset + page.length - 1}` : "*"}/${sorted.length}` }
          : {};
        return json(res, 200, project(page), counted);
      } catch (err) {
        return json(res, 400, { message: (err as Error).message });
      }
    }
    const LIST = "/storage/v1/object/list/";
    const INFO = "/storage/v1/object/info/";
    const OBJECT = "/storage/v1/object/";
    if (req.method === "POST" && p.startsWith(LIST)) {
      const bucket = p.slice(LIST.length);
      const { prefix = "", limit = 100, offset = 0 } = JSON.parse(body.toString() || "{}");
      const base = `${bucket}/${prefix ? `${prefix}/` : ""}`;
      const entries = new Map<string, StoredObject | null>();
      for (const [key, o] of store) {
        if (!key.startsWith(base)) continue;
        const [head, ...rest] = key.slice(base.length).split("/");
        entries.set(head, rest.length ? null : o);
      }
      const page = [...entries].sort(([a], [b]) => (a < b ? -1 : 1)).slice(offset, offset + limit);
      return json(
        res,
        200,
        page.map(([name, o]) =>
          o
            ? {
                name,
                id: `id-${name}`,
                created_at: o.created,
                updated_at: o.updated,
                metadata: { eTag: o.etag, size: o.bytes.length, lastModified: o.updated, mimetype: o.contentType ?? "image/png" },
              }
            : { name, id: null, metadata: null },
        ),
      );
    }
    if (req.method === "GET" && p.startsWith(INFO)) {
      const o = store.get(p.slice(INFO.length));
      if (!o) return json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      return json(res, 200, { size: o.bytes.length, etag: o.etag, created_at: o.created, last_modified: o.updated });
    }
    if (req.method === "DELETE" && p.startsWith(OBJECT)) {
      const bucket = p.slice(OBJECT.length);
      const { prefixes = [] } = JSON.parse(body.toString() || "{}");
      const removed = (prefixes as string[]).filter((k) => store.delete(`${bucket}/${k}`));
      return json(res, 200, removed.map((name) => ({ name, bucket_id: bucket })));
    }
    if (req.method === "GET" && p.startsWith(OBJECT)) {
      const o = store.get(p.slice(OBJECT.length));
      if (!o) return json(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(o.bytes);
    }
    json(res, 400, { message: `unexpected ${req.method} ${p}` });
  });
}
