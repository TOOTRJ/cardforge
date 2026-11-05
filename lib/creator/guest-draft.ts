import type { FormValues } from "@/lib/creator/form-types";
import { DEFAULT_POST_AUTH_PATH, safeRedirectPath } from "@/lib/auth/safe-redirect";
import { randomId } from "@/lib/ids";

// ---------------------------------------------------------------------------
// A signed-out visitor's card (TODO HM3, owner 2026-11-04): the guest
// creator keeps what they build in THIS BROWSER while they sign up or sign
// in, and the signed-in creator at /create gives it back, ready to save
// through the normal createCardAction.
//
//   * IndexedDB, one record: the form's values AND the pictures the guest
//     picked (card art, a custom land icon / watermark) as Blobs — nothing
//     a guest does touches storage. Every tab of the browser reads it, so
//     the sign-up confirmation link opening a NEW tab still finds it
//     (sessionStorage — the new-deck dialog's hand-off, lib/decks/new-deck.ts
//     — is one tab's; localStorage holds strings, a few MB at most).
//   * Where IndexedDB is missing or refuses, the values alone go to this
//     tab's sessionStorage (no pictures): a draft that survives a sign-in in
//     the same tab, never a broken creator.
//   * Never the URL. Kept GUEST_DRAFT_TTL_MS; cleared once the card saves,
//     and by every sign-out (`forgetGuestCard`).
//   * It follows the PERSON, not the browser: only the guest creator writes
//     it, and the signed-in creator that puts it back CLAIMS it for that
//     account — a claimed draft is never offered to a guest or to another
//     account (and another account's /create removes it).
//   * One tab never overwrites another's: every write stamps a revision
//     (`rev`), and the guest creator writes — or clears — only while the
//     stored record is still the one it last wrote or put back. A guest tab
//     left open while the card was claimed, saved (cleared) or rewritten
//     elsewhere never brings it back (`write` / `clear` with `expected`).
//   * It holds only what a guest can set: its pictures as `blob:` URLs,
//     never a storage URL, a deck, an import's id or a set icon upload
//     (`guestDraftValues`, on the way in and on the way out).
//   * A small localStorage flag says one is waiting — the synchronous answer
//     the onboarding wizard and the signup form read
//     (`guestCardWaiting`), never the draft itself.
//
// Every storage call is wrapped: a private window, a full quota or blocked
// site data means no draft, never an error. Client-safe: no server imports.
// ---------------------------------------------------------------------------

/** Bumped when FormValues changes in a way an older draft can't be read as. */
export const GUEST_DRAFT_VERSION = 2;

/** A week: past it the visitor has moved on (and Safari's own script-storage
 *  limit is seven days of no visit). */
export const GUEST_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The signup form's hidden field: "1" when a guest's card waits in the
 *  browser — the signup row's `guestDraft` funnel prop. */
export const GUEST_DRAFT_FIELD = "guest_draft";

/** Where the signed-in creator restores it. */
export const GUEST_DRAFT_RETURN_PATH = "/create";

/**
 * The save gate's two ways in, back to /create. A NEW account goes through
 * /onboarding first (the (app) layout sends it there), so sign-up asks
 * onboarding itself to end on /create — and when the confirmation link
 * opens elsewhere with no `next`, the wizard finishes there anyway while a
 * card waits (guestCardWaiting). Sign-in returns straight to it. Both go
 * through safeRedirectPath, like every post-auth redirect.
 */
export function guestAuthHref(kind: "signup" | "login"): string {
  const back = GUEST_DRAFT_RETURN_PATH;
  const target =
    kind === "signup" ? safeRedirectPath(`/onboarding?next=${encodeURIComponent(back)}`, back) : back;
  return `/${kind}?redirectTo=${encodeURIComponent(target)}`;
}

/**
 * Where onboarding ends. The sign-up confirmation link carries no `next`
 * (the email template is /auth/confirm?token_hash=…; it ends on /dashboard
 * and the (app) layout sends a new account to /onboarding), so a wizard
 * left on that default finishes on /create while a guest's card waits in
 * this browser. A `next` someone asked for is kept.
 */
export function onboardingFinishPath(next: string, cardWaiting: boolean): string {
  return next === DEFAULT_POST_AUTH_PATH && cardWaiting ? GUEST_DRAFT_RETURN_PATH : next;
}

const DB_NAME = "pipglyph";
const DB_STORE = "drafts";
const DB_KEY = "guest-card";
const SESSION_KEY = "pipglyph:guest-card-draft";
const WAITING_KEY = "pipglyph:guest-card-waiting";

/** A picture kept in the browser: the form field (dotted path) whose value
 *  is its `blob:` URL, and what the uploader is told it is. */
export type GuestPicture = {
  path: string;
  blob: Blob;
  name: string;
};

/** What a field holding a kept picture is uploaded as after sign-in. */
export type GuestPictureKind = "art" | "watermark";

export function guestPictureKindOf(path: string): GuestPictureKind {
  return path === "watermark.url" || path.endsWith(".watermark.url") ? "watermark" : "art";
}

/** The automatic tags' state (lib/creator/auto-tags-follow.ts): a restored
 *  card keeps following its text only if the guest never touched the field. */
export type GuestDraftTags = { following: boolean; base: string[] };

export type GuestDraft = {
  values: FormValues;
  pictures: GuestPicture[];
  tags: GuestDraftTags;
  /** The guest form's own starting values: a field still holding its value
   *  here was never set by the guest, and takes the signed-in viewer's
   *  default instead (their footer, artist credit…). null = unknown. */
  base: FormValues | null;
  /** The account that put it back (null = not yet claimed). */
  claimedBy: string | null;
};

type StoredGuestDraft = GuestDraft & { v: number; savedAt: number; rev?: string | null };

/** The draft as read back, with the revision it was stored under. */
export type ReadGuestDraft = GuestDraft & { rev: string | null };

/** A guarded write or clear: go ahead only while the stored record is still
 *  revision `expected` (null = nothing stored) and claimed by no one. */
export type GuestDraftGuard = { expected: string | null };

// ---------------------------------------------------------------------------
// What a draft may hold. The guest creator can't upload, import, link a
// deck or pick a set icon file, so none of that is kept or put back — a
// value there is another account's (a draft written before it was
// claimed, or a hand-edited record) and the viewer's default stands.
// ---------------------------------------------------------------------------

/** Fields a guest never sets: never kept, never restored. */
const NEVER_KEPT_FIELDS = ["deck_id", "source_scryfall_id", "set_icon_url", "slug", "game_system_id"] as const;

const isUrlKey = (key: string) => key === "url" || key.endsWith("_url");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Blob);
}

/**
 * The values as a draft may hold them: the never-kept fields dropped, every
 * picture field that isn't a `blob:` URL dropped, and a custom watermark /
 * land icon with no kept picture dropped whole. A dropped field restores
 * as the viewer's default.
 */
export function guestDraftValues(values: FormValues): FormValues {
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (!isPlainObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (isUrlKey(key) && typeof value === "string" && value !== "" && !isBlobUrl(value)) continue;
      if (isPlainObject(value) && value.kind === "custom" && !isBlobUrl(value.url)) continue;
      out[key] = clean(value);
    }
    return out;
  };
  const out = clean(values) as Record<string, unknown>;
  for (const key of NEVER_KEPT_FIELDS) delete out[key];
  return out as FormValues;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!sameValue(a[key], b[key])) return false;
    return true;
  }
  return false;
}

function sameKind(a: unknown, b: unknown): boolean {
  if (a === null || b === null || a === undefined) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b);
  if (isPlainObject(a) || isPlainObject(b)) return isPlainObject(a) && isPlainObject(b);
  return typeof a === typeof b;
}

/**
 * The draft's values laid over the viewer's own defaults (the form this
 * build starts with), key by key and into nested objects:
 *   * a key the draft lacks (a field added since it was written) — default;
 *   * a value of another shape than the default's — default;
 *   * a value the guest never changed from the guest form's own start
 *     (`base`) — the viewer's default (a paid viewer's footer, their artist
 *     credit), never the guest's empty one;
 *   * else the guest's value. A key only the draft has (an optional field
 *     the defaults leave out) is kept.
 */
export function mergeDraftValues(defaults: FormValues, values: FormValues, base: FormValues | null): FormValues {
  const merge = (d: unknown, v: unknown, b: unknown): unknown => {
    if (v === undefined) return d;
    if (b !== undefined && d !== undefined && sameValue(v, b)) return d;
    if (!sameKind(d, v)) return d;
    if (isPlainObject(d) && isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      const bo = isPlainObject(b) ? b : {};
      for (const key of new Set([...Object.keys(d), ...Object.keys(v)])) {
        const next = merge(d[key], v[key], bo[key]);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }
    return v;
  };
  return merge(defaults, values, base ?? undefined) as FormValues;
}

// ---------------------------------------------------------------------------
// Pure parts: the record's shape, and the pictures inside the values.
// ---------------------------------------------------------------------------

export function isBlobUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("blob:");
}

/** Every `blob:` URL in the values, with its dotted path. */
export function blobUrlPaths(values: unknown): Array<{ path: string; url: string }> {
  const out: Array<{ path: string; url: string }> = [];
  const walk = (node: unknown, path: string) => {
    if (isBlobUrl(node)) {
      out.push({ path, url: node });
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i)));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(values, "");
  return out;
}

/** A copy of `values` with `path` set to `value` (objects along the path
 *  copied, never the caller's). */
export function withValueAt<T>(values: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const copy = (node: unknown): Record<string, unknown> | unknown[] =>
    Array.isArray(node) ? [...node] : { ...((node ?? {}) as Record<string, unknown>) };
  const root = copy(values) as Record<string, unknown>;
  let at: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = copy(at[keys[i]]) as Record<string, unknown>;
    at[keys[i]] = next;
    at = next;
  }
  at[keys[keys.length - 1]] = value;
  return root as T;
}

/** The pictures to keep: each `blob:` URL in the values whose file this
 *  page still holds. A URL with no file (revoked, another page's) is
 *  dropped from the values — a draft never names a picture it can't bring. */
export function draftPictures(
  values: FormValues,
  files: ReadonlyMap<string, { blob: Blob; name: string }>,
): { values: FormValues; pictures: GuestPicture[] } {
  let out = values;
  const pictures: GuestPicture[] = [];
  for (const { path, url } of blobUrlPaths(values)) {
    const file = files.get(url);
    if (file) pictures.push({ path, blob: file.blob, name: file.name || "picture" });
    else out = withValueAt(out, path, "");
  }
  return { values: out, pictures };
}

function withoutPictures(values: FormValues, pictures: readonly GuestPicture[]): FormValues {
  return pictures.reduce((out, picture) => withValueAt(out, picture.path, ""), values);
}

/**
 * The values to put back in the form: every `blob:` URL the draft names is
 * one of a page that is gone, so each kept picture gets a fresh URL from
 * `urlFor` (URL.createObjectURL) at its path and any other is cleared.
 * Returns the URLs made, with their pictures, for the page to hold.
 */
export function restoredDraftValues(
  draft: GuestDraft,
  urlFor: (blob: Blob) => string,
  defaults?: FormValues,
): { values: FormValues; urls: Map<string, GuestPicture> } {
  const kept = guestDraftValues(draft.values);
  let values = defaults ? mergeDraftValues(defaults, kept, draft.base ? guestDraftValues(draft.base) : null) : kept;
  for (const { path } of blobUrlPaths(values)) values = withValueAt(values, path, "");
  const urls = new Map<string, GuestPicture>();
  for (const picture of draft.pictures) {
    const url = urlFor(picture.blob);
    urls.set(url, picture);
    values = withValueAt(values, picture.path, url);
  }
  return { values, urls };
}

/** The stored record as a draft, or null: none, too old, another version,
 *  or not one we wrote. */
export function guestDraftFromStored(raw: unknown, now: number = Date.now()): GuestDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<StoredGuestDraft>;
  if (value.v !== GUEST_DRAFT_VERSION) return null;
  if (typeof value.savedAt !== "number" || now - value.savedAt < 0 || now - value.savedAt >= GUEST_DRAFT_TTL_MS) {
    return null;
  }
  if (!value.values || typeof value.values !== "object" || Array.isArray(value.values)) return null;
  if (typeof (value.values as Partial<FormValues>).title !== "string") return null;
  const pictures = Array.isArray(value.pictures)
    ? value.pictures.filter(
        (p): p is GuestPicture =>
          Boolean(p) &&
          typeof p.path === "string" &&
          typeof Blob !== "undefined" &&
          p.blob instanceof Blob &&
          typeof p.name === "string",
      )
    : [];
  const tags = value.tags;
  return {
    values: value.values as FormValues,
    pictures,
    tags: {
      following: tags?.following === true,
      base: Array.isArray(tags?.base) ? tags.base.filter((t): t is string => typeof t === "string") : [],
    },
    base: isPlainObject(value.base) ? (value.base as FormValues) : null,
    claimedBy: typeof value.claimedBy === "string" && value.claimedBy ? value.claimedBy : null,
  };
}

/** May `viewer` (a user id; null = a guest) be offered this draft? Only an
 *  unclaimed one, or the viewer's own. */
export function draftOfferedTo(draft: Pick<GuestDraft, "claimedBy">, viewer: string | null): boolean {
  return draft.claimedBy === null || draft.claimedBy === viewer;
}

// ---------------------------------------------------------------------------
// Storage. A backend is one record's get / put / delete; the store tries
// IndexedDB first and this tab's sessionStorage (values only) after it.
// ---------------------------------------------------------------------------

export type GuestDraftBackend = {
  /** True when this backend keeps Blobs (the pictures). */
  keepsPictures: boolean;
  get(): Promise<unknown>;
  delete(): Promise<void>;
  /** Read the record, decide, and write — ONE step no other tab can come
   *  between (IndexedDB: one readwrite transaction, which tabs queue for;
   *  sessionStorage: one tab's, synchronous). `decide` is synchronous: the
   *  record to put, "delete", or null to leave it. */
  update(decide: (current: unknown) => StoredGuestDraft | "delete" | null): Promise<void>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = run(tx.objectStore(DB_STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function updateRecord(decide: (current: unknown) => StoredGuestDraft | "delete" | null): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      const store = tx.objectStore(DB_STORE);
      const request = store.get(DB_KEY);
      // Decided and written inside the transaction that read it.
      request.onsuccess = () => {
        let next: StoredGuestDraft | "delete" | null;
        try {
          next = decide(request.result);
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        if (next === "delete") store.delete(DB_KEY);
        else if (next) store.put(next, DB_KEY);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

export function indexedDbBackend(): GuestDraftBackend | null {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) return null;
  } catch {
    return null;
  }
  return {
    keepsPictures: true,
    get: () => withStore("readonly", (store) => store.get(DB_KEY)),
    delete: async () => {
      await withStore("readwrite", (store) => store.delete(DB_KEY));
    },
    update: updateRecord,
  };
}

function webStorage(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function sessionStorageBackend(): GuestDraftBackend | null {
  const store = webStorage("session");
  if (!store) return null;
  return {
    keepsPictures: false,
    get: async () => {
      const raw = store.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    },
    delete: async () => {
      store.removeItem(SESSION_KEY);
    },
    update: async (decide) => {
      const raw = store.getItem(SESSION_KEY);
      const next = decide(raw ? (JSON.parse(raw) as unknown) : null);
      if (next === "delete") store.removeItem(SESSION_KEY);
      else if (next) store.setItem(SESSION_KEY, JSON.stringify({ ...next, pictures: [] }));
    },
  };
}

function setWaiting(savedAt: number | null) {
  const store = webStorage("local");
  try {
    if (savedAt === null) store?.removeItem(WAITING_KEY);
    else store?.setItem(WAITING_KEY, String(savedAt));
  } catch {
    // The flag is a hint; the draft itself is what restores.
  }
}

/**
 * True when this browser holds a guest card younger than the TTL — read
 * synchronously by the onboarding wizard (finish on /create) and the signup
 * form (the `guestDraft` funnel prop). A hint: /create reads the draft.
 */
export function guestCardWaiting(now: number = Date.now()): boolean {
  const fresh = (savedAt: number) => Number.isFinite(savedAt) && now - savedAt >= 0 && now - savedAt < GUEST_DRAFT_TTL_MS;
  try {
    const flag = webStorage("local")?.getItem(WAITING_KEY);
    if (flag && fresh(Number(flag))) return true;
  } catch {
    // fall through to this tab's copy
  }
  try {
    const raw = webStorage("session")?.getItem(SESSION_KEY);
    if (!raw) return false;
    const { savedAt, claimedBy } = JSON.parse(raw) as { savedAt?: unknown; claimedBy?: unknown };
    return typeof savedAt === "number" && fresh(savedAt) && !claimedBy;
  } catch {
    return false;
  }
}

export type GuestDraftStore = {
  /** The kept draft, or null. One claimed by another account than `viewer`
   *  (a user id; null = a guest) is never returned, and is removed; so is a
   *  stale or unreadable one. */
  read(viewer: string | null): Promise<ReadGuestDraft | null>;
  /** Mark the kept draft as `userId`'s: never offered to anyone else. */
  claim(userId: string): Promise<void>;
  /** Keep it, under revision `rev` (a fresh one when omitted). "values-only"
   *  when the pictures couldn't be kept; false when nothing could; "stale"
   *  when `guard` refused (the stored record is claimed, or no longer the
   *  one this tab expected — cleared or rewritten elsewhere). */
  write(
    draft: GuestDraft,
    options?: { guard?: GuestDraftGuard; rev?: string },
  ): Promise<"kept" | "values-only" | false | "stale">;
  /** Forget it. With `guard`, only while the stored record is still the
   *  expected one (true = cleared or nothing there). */
  clear(guard?: GuestDraftGuard): Promise<boolean>;
};

export function createGuestDraftStore(
  deps: {
    backends?: () => Array<GuestDraftBackend | null>;
    now?: () => number;
  } = {},
): GuestDraftStore {
  const all = () => (deps.backends ?? (() => [indexedDbBackend(), sessionStorageBackend()]))().filter(
    (b): b is GuestDraftBackend => b !== null,
  );
  // The backend this tab last wrote to comes first: once a write fell back
  // (IndexedDB refused it), the tab reads and guards the copy it wrote, not
  // an older record left in the one that refused.
  let primary = 0;
  const backends = (list = all()) => {
    const first = list[primary];
    return first ? [first, ...list.filter((_, i) => i !== primary)] : list;
  };
  const now = deps.now ?? Date.now;
  const clearAll = async () => {
    for (const backend of backends()) {
      try {
        await backend.delete();
      } catch {
        // nothing to clear where storage is blocked
      }
    }
    setWaiting(null);
  };
  const readRaw = async (): Promise<{
    draft: GuestDraft;
    backend: GuestDraftBackend;
    savedAt: number;
    rev: string | null;
  } | null> => {
    for (const backend of backends()) {
      let raw: unknown;
      try {
        raw = await backend.get();
      } catch {
        continue;
      }
      if (raw == null) continue;
      const draft = guestDraftFromStored(raw, now());
      if (draft) {
        const { savedAt, rev } = raw as StoredGuestDraft;
        return { draft, backend, savedAt, rev: typeof rev === "string" && rev ? rev : null };
      }
      try {
        await backend.delete();
      } catch {
        // a stale record that can't be removed is still never read
      }
    }
    return null;
  };
  // Is this stored record (raw) still the one a tab expects, and nobody's?
  // Read from the raw record, not the parsed draft: a tab may write over its
  // OWN record once that has expired.
  const revOf = (raw: unknown): string | null => {
    const rev = raw && typeof raw === "object" ? (raw as StoredGuestDraft).rev : null;
    return typeof rev === "string" && rev ? rev : null;
  };
  const claimedIn = (raw: unknown) =>
    Boolean(raw && typeof raw === "object" && (raw as StoredGuestDraft).claimedBy);
  const passes = (raw: unknown, guard: GuestDraftGuard) =>
    !claimedIn(raw) && (raw == null ? null : revOf(raw)) === guard.expected;
  return {
    async read(viewer) {
      const found = await readRaw();
      if (!found) return null;
      if (draftOfferedTo(found.draft, viewer)) return { ...found.draft, rev: found.rev };
      // Another account's card: never offered, and gone from this browser
      // once someone else is at it (its owner signed out — or never did).
      await clearAll();
      return null;
    },
    async claim(userId) {
      // Marked in the same step that reads it: a guest tab's write can't
      // land between the two and leave it unclaimed.
      for (const backend of backends()) {
        let found = false;
        try {
          await backend.update((raw) => {
            if (!guestDraftFromStored(raw, now())) return null;
            found = true;
            const record = raw as StoredGuestDraft;
            return record.claimedBy === userId ? null : { ...record, claimedBy: userId };
          });
        } catch {
          if (!found) continue;
          // can't mark it: remove it rather than leave it for anyone
          await clearAll();
          return;
        }
        if (!found) continue;
        // Nothing waits for a sign-up any more (the onboarding pickup).
        setWaiting(null);
        return;
      }
    },
    async write(draft, options = {}) {
      const savedAt = now();
      const record: StoredGuestDraft = {
        ...draft,
        values: guestDraftValues(draft.values),
        base: draft.base ? guestDraftValues(draft.base) : null,
        v: GUEST_DRAFT_VERSION,
        savedAt,
        rev: options.rev ?? randomId(),
      };
      const list = all();
      // The guard is judged once, by the first backend that reads a record:
      // one that fails to write after it passed leaves the next to write.
      let guard = options.guard;
      for (const backend of backends(list)) {
        const stored = backend.keepsPictures
          ? record
          : { ...record, values: withoutPictures(record.values, record.pictures), pictures: [] };
        const verdict: { put?: boolean; stale?: boolean } = {};
        try {
          await backend.update((raw) => {
            if (guard && !passes(raw, guard)) {
              verdict.stale = true;
              return null;
            }
            verdict.put = true;
            return stored;
          });
        } catch {
          if (verdict.put) guard = undefined;
          continue;
        }
        if (verdict.stale) return "stale";
        const at = list.indexOf(backend);
        if (at !== primary) {
          // Fell back (or back again): this backend is the tab's copy now,
          // and the one before it holds nothing older to read first.
          for (const other of list) {
            if (other === backend) continue;
            try {
              await other.delete();
            } catch {
              // read after this one, so never in the way
            }
          }
          primary = at;
        }
        setWaiting(savedAt);
        return backend.keepsPictures || draft.pictures.length === 0 ? "kept" : "values-only";
      }
      return false;
    },
    async clear(guard) {
      if (!guard) {
        await clearAll();
        return true;
      }
      // Removed in the step that checks it is still this tab's.
      for (const backend of backends()) {
        const verdict: { found?: boolean; mine?: boolean } = {};
        try {
          await backend.update((raw) => {
            if (raw == null) return null;
            verdict.found = true;
            verdict.mine = passes(raw, guard);
            return verdict.mine ? "delete" : null;
          });
        } catch {
          continue;
        }
        if (!verdict.found) continue;
        if (verdict.mine) setWaiting(null);
        return Boolean(verdict.mine);
      }
      return true;
    },
  };
}

/** This tab's record of a restored card's uploaded pictures (the
 *  signed-in creator's: use-guest-draft), so a picture uploads once. */
export const GUEST_CARD_UPLOADS_KEY = "pipglyph:guest-card-uploads";

/** Forget this browser's guest card — every sign-out, account deletion —
 *  and this tab's note of its uploaded pictures (the account's addresses). */
export async function forgetGuestCard(): Promise<void> {
  try {
    webStorage("session")?.removeItem(GUEST_CARD_UPLOADS_KEY);
  } catch {
    // nothing kept here
  }
  await createGuestDraftStore().clear();
}
