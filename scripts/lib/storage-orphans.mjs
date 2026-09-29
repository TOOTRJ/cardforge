// ---------------------------------------------------------------------------
// storage-orphans.mjs — the testable half of scripts/sweep-storage-orphans.mjs
// (TODO 3.14b): which storage objects no database row references, and the
// careful delete of those.
//
// A REFERENCE is the object's key — `{folder}/{name}` — appearing inside any
// string value of any row: a public URL (`…/storage/v1/object/public/card-art/
// {uid}/{name}?v=1`), a `/render-cdn/{uid}/{name}` path, a next/image URL
// that carries either percent-encoded, a Markdown body, a bare
// `storage_path`, a JSON value at any depth. The scan does not trust a list
// of columns: it reads EVERY column of EVERY table the API exposes, except
// the ones whose type can't hold text (uuid, numbers, timestamps, booleans),
// so a column added tomorrow is covered without touching this file.
// `URL_SOURCES` below documents where the app writes storage URLs today;
// those tables must be present or the scan refuses to run.
//
// Only `{uuid}/{name}` objects (the user-folder shape every upload path uses,
// lib/media/user-storage.ts) are ever swept; anything else in a bucket is
// listed and kept. Matching is bucket-agnostic and case-insensitive on
// purpose: a key named anywhere keeps every object with that key.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isUuid } from "../../lib/ids.ts";

/** Buckets the sweep may delete from. */
export const SWEEP_BUCKETS = ["card-art", "profile-media", "set-covers", "custom-pips", "card-renders"];

/** Buckets the sweep never deletes from, and why. card-exports is listed
 *  (read-only) so the owner sees what is there. */
export const NOT_SWEPT = {
  frames:
    "content-addressed frame masters (lib/frames/frame-manifest.json, docs/FRAMES.md) — no row names them; never listed, never deleted",
  "card-exports":
    "legacy download history: users' own exported PNGs from before 2026-06 (exportCardAction, removed in 163a48c), handed out as public share links and still named by card_exports rows; no writer or reader today, emptied only by account deletion — listed, never deleted",
};

/** The age floor: nothing younger than this many days is ever deleted, in
 *  any bucket. Remixes share `art_url`, AI job steps and the creator's
 *  unsaved drafts point at fresh uploads before any card row does. */
export const MIN_AGE_DAYS = 7;
export const DEFAULT_BATCH_SIZE = 25;
export const MAX_BATCH_SIZE = 100;
/** PostgREST page size. The scan pages until an EMPTY page, so a lower
 *  server-side max-rows can never end a table early. */
export const PAGE_SIZE = 1000;
/** Tables read at once. */
export const SCAN_CONCURRENCY = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where the app writes storage URLs today (2026-09-29) — documentation, plus
 * a guard: every table here must be in the live API schema or the scan
 * refuses (a table that isn't exposed can't be read, and its references
 * would be missed). The scan itself reads every text/JSON column of every
 * table, these and all the others.
 */
export const URL_SOURCES = [
  {
    table: "cards",
    columns: ["art_url", "back_face", "set_icon_url", "watermark", "rendered_image_url", "rendered_thumb_url"],
    note:
      "art (card-art: upload, AI art, Scryfall import), the second face's art (back_face.art_url), the set icon (set-covers), the land/design watermark icon (watermark.url, card-art), the bake + thumb (card-renders)",
  },
  { table: "profiles", columns: ["avatar_url", "banner_url"], note: "profile-media uploads (or a /defaults/ site path)" },
  { table: "decks", columns: ["cover_url"], note: "set-covers upload, or AI cover art in card-art" },
  {
    table: "deck_cards",
    columns: ["image_url"],
    note: "a Scryfall printing image (cards.scryfall.io — the only value 0127 accepts); a row from before 0127 could hold anything, so it is read like every other column",
  },
  { table: "custom_pips", columns: ["image_url"], note: "custom-pips `{uid}/{symbol}.png`" },
  { table: "challenges", columns: ["hero_image_url"], note: "admin-set hero image" },
  { table: "ai_generation_jobs", columns: ["request", "plan", "steps"], note: "a step's fill.art_url before a card claims it" },
  { table: "card_idea_batches", columns: ["request", "ideas"], note: "idea payloads" },
  { table: "deck_idea_batches", columns: ["request", "ideas"], note: "idea payloads" },
  { table: "notifications", columns: ["payload"], note: "alert payloads" },
  { table: "site_updates", columns: ["summary", "body", "link_href"], note: "news posts (Markdown)" },
  { table: "card_exports", columns: ["file_url", "storage_path"], note: "card-exports history (a bare key in storage_path)" },
];

/** PostgREST/OpenAPI `format`s that can't hold a string. Everything else —
 *  text, varchar, json/jsonb, arrays of text, enums, domains, anything
 *  unknown — is read. */
const NON_TEXT_FORMATS = new Set([
  "uuid",
  "uuid[]",
  "boolean",
  "boolean[]",
  "smallint",
  "integer",
  "bigint",
  "smallint[]",
  "integer[]",
  "bigint[]",
  "numeric",
  "real",
  "double precision",
  "money",
  "date",
  "time without time zone",
  "time with time zone",
  "timestamp without time zone",
  "timestamp with time zone",
  "timestamp with time zone[]",
  "interval",
  "inet",
  "cidr",
  "macaddr",
]);

// --- object keys ---------------------------------------------------------------

/** The file-name rule lib/media/user-storage.ts writes with (that module is
 *  server-only; tests/unit/devops/sweep-storage-orphans.test.ts holds this
 *  copy to its isValidFileName). */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** `{ folder, name }` when `objectPath` is a file directly inside a user
 *  folder (`{uuid}/{name}`, a name user-storage could have written); null
 *  otherwise — such an object is never swept. */
export function userFolderKey(objectPath) {
  if (typeof objectPath !== "string") return null;
  const parts = objectPath.split("/");
  if (parts.length !== 2) return null;
  const [folder, name] = parts;
  if (!isUuid(folder) || !FILE_NAME.test(name) || name.includes("..")) return null;
  return { folder: folder.toLowerCase(), name: name.toLowerCase() };
}

/** The card a card-renders object belongs to: `{cardId}.png` or
 *  `{cardId}.thumb.webp` (lib/cards/bake-core.ts renderObjectNames — the
 *  only names a bake has ever written). null for any other name. */
export function renderCardId(objectPath) {
  const key = userFolderKey(objectPath);
  if (!key) return null;
  const m = key.name.match(/^([0-9a-f-]{36})\.(?:png|thumb\.webp)$/);
  return m && isUuid(m[1]) ? m[1] : null;
}

const parseTime = (value) => {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

/** When the object last changed: the newest of created / updated / last
 *  modified (an upsert keeps created_at). null when none is readable — such
 *  an object counts as new and is kept. */
export function objectTimestamp(obj) {
  const times = [obj?.createdAt, obj?.updatedAt, obj?.lastModified].map(parseTime).filter((t) => t !== null);
  return times.length ? Math.max(...times) : null;
}

export function ageDays(obj, now) {
  const t = objectTimestamp(obj);
  return t === null ? null : (now - t) / DAY_MS;
}

export function minAgeMs(days) {
  return days * DAY_MS;
}

// --- reference matching --------------------------------------------------------

const UUID_SLASH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//g;

/** The forms a stored string may hide a key in: as is, JSON-escaped slashes
 *  (`\/`), and percent-decoded up to three times (a next/image URL carries
 *  the storage URL encoded; a link inside it, twice). Each form is lower-
 *  cased AFTER it is decoded: `%57.png` is `W.png`, which must meet the
 *  lower-cased index as `w.png` (review 2026-09-29 — decoding a lower-cased
 *  string left an upper-case letter that missed its key, the unsafe way). */
export function stringVariants(value) {
  const out = new Set();
  const add = (form) => {
    const lower = form.toLowerCase();
    out.add(lower);
    if (lower.includes("\\/")) out.add(lower.replaceAll("\\/", "/"));
  };
  let s = value;
  add(s);
  for (let i = 0; i < 3 && s.includes("%"); i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      decoded = s.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    if (decoded === s) break;
    s = decoded;
    add(s);
  }
  return [...out];
}

/** Every string inside `value` (JSON objects/arrays at any depth; object
 *  KEYS too — a map keyed by URL is a reference). */
export function* stringsIn(value) {
  if (typeof value === "string") {
    yield value;
  } else if (Array.isArray(value)) {
    for (const item of value) yield* stringsIn(item);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* stringsIn(item);
    }
  }
}

/**
 * The keys we are looking for, indexed by folder. `mark(string)` finds every
 * `{uuid}/` in the string and records each indexed name the text right after
 * it STARTS with — so a query string, a closing parenthesis or a full stop
 * after the name never hides a reference (a longer name that merely begins
 * with a shorter one keeps both: over-keeping is the safe direction).
 */
export class KeyIndex {
  constructor(objectPaths = []) {
    /** @type {Map<string, Set<string>>} */
    this.byFolder = new Map();
    this.size = 0;
    for (const p of objectPaths) this.add(p);
  }

  add(objectPath) {
    const key = userFolderKey(objectPath);
    if (!key) return;
    let names = this.byFolder.get(key.folder);
    if (!names) this.byFolder.set(key.folder, (names = new Set()));
    if (!names.has(key.name)) {
      names.add(key.name);
      this.size += 1;
    }
  }

  /** Adds to `found` every indexed key (`folder/name`, lower case) named in `value`. */
  mark(value, found) {
    for (const s of stringVariants(value)) {
      UUID_SLASH.lastIndex = 0;
      let m;
      while ((m = UUID_SLASH.exec(s)) !== null) {
        const folder = m[0].slice(0, -1);
        const names = this.byFolder.get(folder);
        if (!names) continue;
        const rest = s.slice(m.index + m[0].length, m.index + m[0].length + 256);
        for (const name of names) if (rest.startsWith(name)) found.add(`${folder}/${name}`);
      }
    }
  }
}

/** The lookup key of an object path (matches what KeyIndex.mark records). */
export function referenceKey(objectPath) {
  const key = userFolderKey(objectPath);
  return key ? `${key.folder}/${key.name}` : null;
}

// --- the database scan ---------------------------------------------------------

/**
 * Tables from PostgREST's OpenAPI document (`GET /rest/v1/` with the service
 * key): name, primary key (PostgREST marks it `<pk/>`) and column formats.
 */
export function tablesFromOpenApi(spec) {
  const defs = spec?.definitions;
  if (!defs || typeof defs !== "object") throw new Error("The API schema has no table definitions.");
  return Object.entries(defs)
    .map(([name, def]) => {
      const props = Object.entries(def?.properties ?? {});
      return {
        name,
        pk: props.filter(([, p]) => String(p?.description ?? "").includes("<pk/>")).map(([c]) => c),
        columns: props.map(([c, p]) => ({ name: c, format: String(p?.format ?? p?.type ?? "") })),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The columns of `table` the scan reads: every one that may hold text. */
export function textColumns(table) {
  return table.columns.filter((c) => !NON_TEXT_FORMATS.has(c.format.toLowerCase())).map((c) => c.name);
}

/**
 * Read every text/JSON value of every table and return which indexed keys
 * are referenced, plus every card id (card-renders objects are kept while
 * their card exists) and the ids of PRIVATE cards (their renders are listed
 * as a privacy follow-up — never deleted by this sweep). Any read error
 * throws: a partial reference set must never decide a delete.
 *
 * `db.openApi()` → the OpenAPI document; `db.select(table, { columns,
 * order, after, offset, limit })` → rows ordered by `order`, `order[0] >
 * after` when `after` is set. `onReference(key, { table, column, row })`,
 * when given, is called for every place a key is found (`row` = the row's
 * primary-key values) — the rescan reports where a flagged file is used.
 */
export async function scanReferences(db, index, { log = () => {}, concurrency = SCAN_CONCURRENCY, onReference = null } = {}) {
  const started = Date.now();
  const tables = tablesFromOpenApi(await db.openApi());
  const names = new Set(tables.map((t) => t.name));
  const missing = URL_SOURCES.map((s) => s.table).filter((t) => !names.has(t));
  if (missing.length) {
    throw new Error(
      `the API schema is missing ${missing.join(", ")} — a table that can't be read can't be checked for references; nothing is deleted without it`,
    );
  }
  if (!names.has("cards")) throw new Error("the API schema has no cards table");

  const referenced = new Set();
  const cardIds = new Set();
  const privateCardIds = new Set();
  const scanned = [];
  const skipped = [];
  const work = [];
  for (const table of tables) {
    const columns = textColumns(table);
    if (!columns.length && table.name !== "cards") skipped.push(table.name);
    else work.push({ table, columns });
  }

  async function scanTable({ table, columns }) {
    const isCards = table.name === "cards";
    const cardsExtra = isCards
      ? ["id", ...(table.columns.some((c) => c.name === "visibility") ? ["visibility"] : [])]
      : [];
    // Keyset paging on a one-column key: a row deleted mid-scan can't shift
    // an unread row onto a page already read. Composite (or no) key: offset
    // paging over a total order of the key (or every column read).
    const order = table.pk.length ? table.pk : columns;
    const select = [...new Set([...table.pk, ...columns, ...cardsExtra])];
    const keyset = table.pk.length === 1;
    let tableRows = 0;
    let after = null;
    for (let offset = 0; ; ) {
      const page = await db.select(table.name, {
        columns: select,
        order,
        after: keyset ? after : null,
        offset: keyset ? 0 : offset,
        limit: PAGE_SIZE,
      });
      if (!Array.isArray(page)) throw new Error(`${table.name}: unexpected response`);
      if (page.length === 0) break;
      for (const row of page) {
        if (isCards && isUuid(row.id)) {
          cardIds.add(row.id.toLowerCase());
          if (row.visibility === "private") privateCardIds.add(row.id.toLowerCase());
        }
        for (const column of columns) {
          if (!onReference) {
            for (const s of stringsIn(row[column])) index.mark(s, referenced);
            continue;
          }
          const here = new Set();
          for (const s of stringsIn(row[column])) index.mark(s, here);
          for (const key of here) {
            referenced.add(key);
            onReference(key, { table: table.name, column, row: Object.fromEntries(table.pk.map((c) => [c, row[c] ?? null])) });
          }
        }
      }
      tableRows += page.length;
      if (keyset) {
        const last = page[page.length - 1][table.pk[0]];
        if (last === null || last === undefined || last === after) throw new Error(`${table.name}: paging stalled`);
        after = last;
      } else {
        offset += page.length;
      }
    }
    scanned.push({ table: table.name, rows: tableRows });
  }

  // A few tables at a time (each needs at least two requests: a page and
  // the empty page that ends it). The first failure stops the scan.
  const queue = [...work];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await scanTable(queue.shift());
    }),
  );
  scanned.sort((a, b) => (a.table < b.table ? -1 : 1));
  const rows = scanned.reduce((n, t) => n + t.rows, 0);
  const ms = Date.now() - started;
  log(`Reference scan: ${scanned.length} tables, ${rows} rows in ${(ms / 1000).toFixed(1)} s (${skipped.length} without a text column skipped).`);
  return { referenced, cardIds, privateCardIds, scanned, skipped, rows, ms };
}

// --- classification ------------------------------------------------------------

/** Why an object is kept (or that it is an orphan). */
export const VERDICTS = {
  orphan: "orphan",
  referenced: "referenced by a row",
  liveCard: "bake of a card that exists",
  unknownRender: "not a {cardId}.png / .thumb.webp name",
  tooNew: "too new",
  outside: "not a {uuid}/{file} user-folder object",
  notSwept: "bucket not swept",
};

/**
 * One verdict per listed object. `objects`: `{ bucket, path, size, etag,
 * createdAt, updatedAt, lastModified }`.
 */
export function classify(objects, { referenced, cardIds, now, minAgeDays }) {
  const floor = minAgeMs(minAgeDays);
  return objects.map((obj) => {
    const verdict = (() => {
      if (!SWEEP_BUCKETS.includes(obj.bucket)) return "notSwept";
      const key = referenceKey(obj.path);
      if (!key || !obj.etag) return "outside";
      if (referenced.has(key)) return "referenced";
      if (obj.bucket === "card-renders") {
        const cardId = renderCardId(obj.path);
        if (!cardId) return "unknownRender";
        if (cardIds.has(cardId)) return "liveCard";
      }
      const t = objectTimestamp(obj);
      if (t === null || now - t < floor) return "tooNew";
      return "orphan";
    })();
    return { ...obj, verdict };
  });
}

/**
 * Renders of cards that exist and are PRIVATE (whatever their verdict — the
 * card's own row usually still names them). A private card's render should
 * have been deleted when it went private (lib/cards/bake-core.ts: a failed
 * delete leaves the PNG publicly fetchable at its fixed URL). The sweep never
 * deletes a live card's render; the dry run lists these as a privacy
 * follow-up for the owner, and `--private-renders` (scripts/lib/private-
 * renders.mjs) removes them.
 */
export function privateCardRenders(objects, privateCardIds) {
  return objects.filter((obj) => {
    if (obj.bucket !== "card-renders") return false;
    const cardId = renderCardId(obj.path);
    return cardId !== null && privateCardIds.has(cardId);
  });
}

const UUID_TEXT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The names the server writes today (lower-cased, as userFolderKey gives
 *  them): `{uuid}.ext` (art upload, Scryfall import, deck cover / set icon),
 *  `{word}-{uuid}.ext` (`ai-`, `wm-`, `remix-`, `avatar-`, `banner-`, and the
 *  dev seed's `icon-` / `back-`), `{cardId}.png` / `{cardId}.thumb.webp`
 *  (bakes), and a custom pip's `{symbol}.png` / `{symbol}.pending.png`. */
const SERVER_NAME = new RegExp(`^(?:[a-z]+-)?${UUID_TEXT}(?:\\.thumb)?\\.[a-z0-9]{2,5}$`);
const PIP_NAME = /^[wubrgc](?:\.pending)?\.png$/;

/**
 * False for a user-folder object whose name the server doesn't make today —
 * an older upload path, or a file written straight to storage with the
 * user's own session before 0126 took the write policies away (such a file
 * skipped the byte sniff, the metadata strip and the moderation scan). The
 * dry run lists these for review; the sweep treats them like any other
 * object (deleted only as an orphan).
 */
export function isServerMintedName(bucket, objectPath) {
  const key = userFolderKey(objectPath);
  if (!key) return false;
  return bucket === "custom-pips" ? PIP_NAME.test(key.name) : SERVER_NAME.test(key.name);
}

/**
 * The dry run's REVIEW LIST: user-folder objects (`{uuid}/{file}`) in a swept
 * bucket whose names the server doesn't make. The one definition, shared by
 * the dry run that prints it and `--rescan-review` (scripts/lib/review-
 * rescan.mjs), which moderation-scans exactly these (owner decision
 * 2026-09-29). Objects outside the `{uuid}/{file}` shape are not on it (the
 * dry run lists them separately, "not a shape the sweep deletes").
 */
export function reviewList(objects) {
  return objects.filter(
    (o) => SWEEP_BUCKETS.includes(o.bucket) && userFolderKey(o.path) !== null && !isServerMintedName(o.bucket, o.path),
  );
}

/** How many delete batches (each one a full database re-scan) an --apply
 *  run makes: one bucket per batch, `batchSize` objects each, `limit` in all. */
export function plannedBatches(candidates, batchSize, limit = Infinity) {
  const perBucket = new Map();
  for (const obj of candidates) perBucket.set(obj.bucket, (perBucket.get(obj.bucket) ?? 0) + 1);
  let left = limit;
  let batches = 0;
  for (const n of perBucket.values()) {
    const take = Math.min(n, left);
    if (take <= 0) break;
    batches += Math.ceil(take / batchSize);
    left -= take;
  }
  return batches;
}

/** The deepest existing directory at or above `p`, resolved through symlinks. */
function existingRealDir(p) {
  let dir = path.resolve(p);
  for (;;) {
    if (existsSync(dir)) return realpathSync(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Why `dir` can't hold the backups, or null. The backups are users' images
 * and this repository is PUBLIC (review 2026-09-29): refused inside
 * `repoRoot` (this checkout) and inside any git working tree at all.
 */
export function backupDirProblem(dir, repoRoot) {
  const real = existingRealDir(dir);
  if (repoRoot && isInside(real, existingRealDir(repoRoot))) {
    return `${dir} is inside this repository (${repoRoot}), which is public — keep backups outside it (e.g. ~/.pipglyph/sweep-backups)`;
  }
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: real,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (top) return `${dir} is inside the git working tree ${top} — keep backups outside any repository (e.g. ~/.pipglyph/sweep-backups)`;
  } catch {
    // not in a git working tree (or no git): fine
  }
  return null;
}

/** Per-bucket totals: `{ [bucket]: { objects, bytes, [verdict]: { n, bytes } } }`. */
export function summarize(classified) {
  const out = {};
  for (const obj of classified) {
    const b = (out[obj.bucket] ??= { objects: 0, bytes: 0 });
    const size = Number(obj.size) || 0;
    b.objects += 1;
    b.bytes += size;
    const v = (b[obj.verdict] ??= { n: 0, bytes: 0 });
    v.n += 1;
    v.bytes += size;
  }
  return out;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// --- state + manifest ----------------------------------------------------------

export function loadState(file) {
  const empty = { version: 1, target: null, pending: null, deleted: 0, bytes: 0, runs: 0 };
  if (!existsSync(file)) return empty;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed && typeof parsed === "object" && parsed.version === 1 ? { ...empty, ...parsed } : empty;
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, file);
}

/** One JSON line per deleted object — the trace of every delete (and, for
 *  `--private-renders`, per render-pointer clear). */
export function appendManifest(file, entries) {
  if (!entries.length) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function readManifest(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * A run that died between writing `state.pending` and clearing it may or may
 * not have deleted that batch. Ask storage: what is gone goes into the
 * manifest (confirmed now), what is still there is left for this run to
 * judge again from scratch.
 */
export async function reconcilePending({ storage, state, statePath, manifestPath, target, log = () => {} }) {
  const pending = state.pending;
  if (!pending?.items?.length) return { gone: 0, present: 0 };
  let gone = 0;
  let present = 0;
  const entries = [];
  for (const item of pending.items) {
    const info = await storage.info(pending.bucket, item.path);
    if (info.missing) {
      gone += 1;
      entries.push({ ...manifestEntry(target, pending.bucket, item, pending.run), note: "confirmed after an interrupted run" });
    } else {
      present += 1;
    }
  }
  appendManifest(manifestPath, entries);
  state.deleted += gone;
  state.bytes += entries.reduce((n, e) => n + (Number(e.size) || 0), 0);
  state.pending = null;
  saveState(statePath, state);
  log(`Interrupted batch from an earlier run: ${gone} deleted (now in the manifest), ${present} still there (judged again below).`);
  return { gone, present };
}

export function manifestEntry(target, bucket, item, run) {
  return {
    at: new Date().toISOString(),
    target,
    run,
    bucket,
    path: item.path,
    size: item.size ?? null,
    etag: item.etag ?? null,
    lastChanged: item.lastChanged ?? null,
    reason: item.reason,
    ...(item.backup ? { backup: item.backup } : {}),
  };
}

// --- apply -----------------------------------------------------------------------

/** The MD5 hex of a single-part upload's eTag (`"<32 hex>"`); null for a
 *  multipart eTag (`"…-3"`) or anything else, which can't be checked. */
export function plainMd5(etag) {
  const m = typeof etag === "string" ? etag.match(/^(?:W\/)?"?([0-9a-f]{32})"?$/i) : null;
  return m ? m[1].toLowerCase() : null;
}

/** An eTag without its quoting (`W/"x"`, `"x"`, `x` → `x`), lower-cased. */
function bareEtag(etag) {
  return typeof etag === "string" ? etag.trim().replace(/^W\//i, "").replace(/^"(.*)"$/, "$1").toLowerCase() : "";
}

/** Whether two eTags name the same bytes, however each API quotes them —
 *  the listing's `metadata.eTag` and info()'s `etag` need not be formatted
 *  alike (review 2026-09-29: a quoted-vs-bare mismatch would have kept every
 *  object as "changed", and --apply would have deleted nothing). */
export function sameEtag(a, b) {
  const md5a = plainMd5(a);
  const md5b = plainMd5(b);
  if (md5a || md5b) return md5a === md5b;
  const bareA = bareEtag(a);
  return bareA !== "" && bareA === bareEtag(b);
}

/**
 * Delete `candidates` (orphans from `classify`) in batches of `batchSize`,
 * one bucket per batch. Each batch, in this order:
 *   1. with `backupDir`, a copy of every object (the slow part, so it comes
 *      first); a copy whose MD5 isn't the listed eTag means the bytes changed
 *      — that object is kept;
 *   2. the whole database is scanned AGAIN for the batch's keys (a row may
 *      have started pointing at one since the listing) and, for renders, the
 *      card ids (a card may exist again);
 *   3. every object is looked up again, all at once: gone, another eTag
 *      (compared however each API quotes it, `sameEtag`) or size, or now
 *      younger than the floor → kept;
 *   4. the survivors go into `state.pending` and are removed; then EVERY one
 *      is looked up again — storage's own answer, not the names remove()
 *      echoes back (review 2026-09-29), decides: gone → the manifest (its
 *      copy kept); still there → kept (its copy dropped); lookup failed →
 *      stays in `state.pending` with its copy, and the next run settles it
 *      (`reconcilePending`, the same lookup). A crash anywhere in between is
 *      settled the same way.
 * Storage has no conditional delete, so 3 sits right before 4. Backup
 * copies of objects the re-check kept are removed again.
 *
 * Known, accepted race (review 2026-09-29): custom-pips names are
 * deterministic (`{uid}/{SYMBOL}.png`, overwritten in place), so a re-upload
 * landing in the milliseconds between step 3's lookup and the remove would
 * be deleted while its new custom_pips row points at it. A re-upload before
 * step 3 changes the eTag and the timestamp and is kept; the user fixes the
 * rare loser by saving the pip again.
 *
 * `storage`: `info(bucket, path)` → `{ missing: true }` | `{ etag, size,
 * createdAt, lastModified }` (throws on any other error), `remove(bucket,
 * paths)` → what it says it removed (logged only), `download(bucket, path)`
 * → Buffer.
 */
export async function applySweep({
  db,
  storage,
  candidates,
  batchSize = DEFAULT_BATCH_SIZE,
  limit = Infinity,
  minAgeDays = MIN_AGE_DAYS,
  now = () => Date.now(),
  state,
  statePath,
  manifestPath,
  target,
  run,
  backupDir = null,
  log = () => {},
}) {
  if (!(batchSize >= 1 && batchSize <= MAX_BATCH_SIZE)) throw new Error(`batch size must be 1–${MAX_BATCH_SIZE}`);
  if (!(minAgeDays >= MIN_AGE_DAYS)) throw new Error(`the age floor is ${MIN_AGE_DAYS} days`);
  const floor = minAgeMs(minAgeDays);
  const result = { deleted: 0, bytes: 0, skipped: [], failed: [] };
  const skip = (bucket, obj, why) => {
    result.skipped.push({ bucket, path: obj.path, why });
    log(`  - ${bucket}/${obj.path}: ${why} — kept`);
  };

  const byBucket = new Map();
  for (const obj of candidates) {
    if (obj.verdict !== "orphan") throw new Error(`${obj.bucket}/${obj.path} is not an orphan`);
    if (!SWEEP_BUCKETS.includes(obj.bucket)) throw new Error(`${obj.bucket} is never swept`);
    if (!byBucket.has(obj.bucket)) byBucket.set(obj.bucket, []);
    byBucket.get(obj.bucket).push(obj);
  }

  outer: for (const [bucket, objects] of byBucket) {
    for (let i = 0; i < objects.length; ) {
      if (result.deleted >= limit) break outer;
      let batch = objects.slice(i, i + Math.min(batchSize, limit - result.deleted));
      i += batch.length;

      // 1. The copy.
      const backups = new Map();
      if (backupDir) {
        const copied = [];
        for (const obj of batch) {
          try {
            const bytes = await storage.download(bucket, obj.path);
            const md5 = plainMd5(obj.etag);
            if (md5 && createHash("md5").update(bytes).digest("hex") !== md5) throw new Error("its bytes changed since it was listed");
            const file = path.join(backupDir, bucket, obj.path);
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, bytes);
            backups.set(obj.path, file);
            copied.push(obj);
          } catch (err) {
            skip(bucket, obj, `backup failed (${err.message})`);
          }
        }
        batch = copied;
      }
      if (!batch.length) continue;

      // 2. The database, again, for exactly these keys.
      const fresh = await scanReferences(db, new KeyIndex(batch.map((o) => o.path)), { log });
      const unreferenced = batch.filter((obj) => {
        if (fresh.referenced.has(referenceKey(obj.path))) {
          skip(bucket, obj, "a row references it now");
          return false;
        }
        if (bucket === "card-renders") {
          const cardId = renderCardId(obj.path);
          if (!cardId || fresh.cardIds.has(cardId)) {
            skip(bucket, obj, "its card exists now");
            return false;
          }
        }
        return true;
      });

      // 3. The objects themselves, all at once, right before the delete.
      const looked = await Promise.all(
        unreferenced.map(async (obj) => {
          try {
            return { obj, info: await storage.info(bucket, obj.path) };
          } catch (err) {
            return { obj, error: err };
          }
        }),
      );
      const toRemove = [];
      for (const { obj, info, error } of looked) {
        if (error) {
          skip(bucket, obj, `lookup failed (${error.message})`);
          continue;
        }
        if (info.missing) {
          skip(bucket, obj, "already gone");
          continue;
        }
        if (!sameEtag(info.etag, obj.etag) || (info.size != null && obj.size != null && Number(info.size) !== Number(obj.size))) {
          skip(bucket, obj, "changed since it was listed");
          continue;
        }
        const changed = Math.max(objectTimestamp(info) ?? Infinity, objectTimestamp(obj) ?? Infinity);
        if (!Number.isFinite(changed) || now() - changed < floor) {
          skip(bucket, obj, `younger than ${minAgeDays} days now`);
          continue;
        }
        toRemove.push({
          path: obj.path,
          size: obj.size ?? null,
          etag: obj.etag,
          lastChanged: new Date(changed).toISOString(),
          reason: bucket === "card-renders" ? "card deleted, no row references it" : "no row references it",
          ...(backups.has(obj.path) ? { backup: backups.get(obj.path) } : {}),
        });
      }
      const dropBackups = (keep) => {
        for (const [p, file] of backups) if (!keep.has(p)) rmSync(file, { force: true });
      };
      if (!toRemove.length) {
        dropBackups(new Set());
        continue;
      }

      // 4. The delete, then storage's own answer for every object.
      state.pending = { bucket, run, at: new Date().toISOString(), items: toRemove };
      saveState(statePath, state);
      let echoed;
      try {
        echoed = new Set(await storage.remove(bucket, toRemove.map((item) => item.path)));
      } catch (err) {
        // Unknown outcome: pending stays in the state, the next run settles
        // it (and the copies stay).
        result.failed.push({ bucket, paths: toRemove.map((item) => item.path), error: err.message });
        log(`  ✗ ${bucket}: delete of ${toRemove.length} object(s) failed (${err.message}) — re-run to settle it`);
        break outer;
      }
      const confirmed = await Promise.all(
        toRemove.map(async (item) => {
          try {
            const after = await storage.info(bucket, item.path);
            return { item, gone: Boolean(after.missing) };
          } catch (err) {
            return { item, error: err };
          }
        }),
      );
      const done = [];
      const stillThere = new Set();
      const unsettled = [];
      for (const { item, gone, error } of confirmed) {
        if (error) {
          unsettled.push(item);
          log(`  ? ${bucket}/${item.path}: couldn't confirm the delete (${error.message}) — the next run settles it`);
        } else if (gone) {
          done.push(item);
          if (!echoed.has(item.path)) log(`  (${bucket}/${item.path}: gone, though remove() didn't name it)`);
        } else {
          stillThere.add(item.path);
          skip(bucket, item, "storage did not remove it");
        }
      }
      // Keep the copy of everything deleted or unconfirmed; drop the copies
      // of objects certainly still in storage (and of those the re-check kept).
      const removing = new Set(toRemove.map((item) => item.path));
      for (const [p, file] of backups) {
        if (stillThere.has(p) || !removing.has(p)) rmSync(file, { force: true });
      }
      appendManifest(manifestPath, done.map((item) => manifestEntry(target, bucket, item, run)));
      const bytes = done.reduce((n, item) => n + (Number(item.size) || 0), 0);
      result.deleted += done.length;
      result.bytes += bytes;
      state.deleted += done.length;
      state.bytes += bytes;
      state.pending = unsettled.length ? { ...state.pending, items: unsettled } : null;
      saveState(statePath, state);
      for (const item of done) log(`  ✓ ${bucket}/${item.path}  ${formatBytes(Number(item.size) || 0)}`);
      if (unsettled.length) {
        result.failed.push({ bucket, paths: unsettled.map((item) => item.path), error: "delete not confirmed" });
        break outer;
      }
    }
  }
  return result;
}
