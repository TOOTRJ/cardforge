import type { FormValues } from "@/lib/creator/form-types";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

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
//   * Never the URL. Kept GUEST_DRAFT_TTL_MS; cleared once the card saves.
//   * A small localStorage flag says one is waiting — the synchronous answer
//     the onboarding wizard and the signup form read
//     (`guestCardWaiting`), never the draft itself.
//
// Every storage call is wrapped: a private window, a full quota or blocked
// site data means no draft, never an error. Client-safe: no server imports.
// ---------------------------------------------------------------------------

/** Bumped when FormValues changes in a way an older draft can't be read as. */
export const GUEST_DRAFT_VERSION = 1;

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
  return next === "/dashboard" && cardWaiting ? GUEST_DRAFT_RETURN_PATH : next;
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
};

type StoredGuestDraft = GuestDraft & { v: number; savedAt: number };

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
): { values: FormValues; urls: Map<string, GuestPicture> } {
  let values = draft.values;
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
  };
}

// ---------------------------------------------------------------------------
// Storage. A backend is one record's get / put / delete; the store tries
// IndexedDB first and this tab's sessionStorage (values only) after it.
// ---------------------------------------------------------------------------

export type GuestDraftBackend = {
  /** True when this backend keeps Blobs (the pictures). */
  keepsPictures: boolean;
  get(): Promise<unknown>;
  put(record: StoredGuestDraft): Promise<void>;
  delete(): Promise<void>;
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

export function indexedDbBackend(): GuestDraftBackend | null {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) return null;
  } catch {
    return null;
  }
  return {
    keepsPictures: true,
    get: () => withStore("readonly", (store) => store.get(DB_KEY)),
    put: async (record) => {
      await withStore("readwrite", (store) => store.put(record, DB_KEY));
    },
    delete: async () => {
      await withStore("readwrite", (store) => store.delete(DB_KEY));
    },
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
    put: async (record) => {
      store.setItem(SESSION_KEY, JSON.stringify({ ...record, pictures: [] }));
    },
    delete: async () => {
      store.removeItem(SESSION_KEY);
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
    const savedAt = (JSON.parse(raw) as { savedAt?: unknown }).savedAt;
    return typeof savedAt === "number" && fresh(savedAt);
  } catch {
    return false;
  }
}

export type GuestDraftStore = {
  /** The kept draft, or null. A stale or unreadable one is removed. */
  read(): Promise<GuestDraft | null>;
  /** Keep it. "values-only" when the pictures couldn't be kept; false when
   *  nothing could. */
  write(draft: GuestDraft): Promise<"kept" | "values-only" | false>;
  clear(): Promise<void>;
};

export function createGuestDraftStore(
  deps: {
    backends?: () => Array<GuestDraftBackend | null>;
    now?: () => number;
  } = {},
): GuestDraftStore {
  const backends = () => (deps.backends ?? (() => [indexedDbBackend(), sessionStorageBackend()]))().filter(
    (b): b is GuestDraftBackend => b !== null,
  );
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
  return {
    async read() {
      for (const backend of backends()) {
        let raw: unknown;
        try {
          raw = await backend.get();
        } catch {
          continue;
        }
        if (raw == null) continue;
        const draft = guestDraftFromStored(raw, now());
        if (draft) return draft;
        try {
          await backend.delete();
        } catch {
          // a stale record that can't be removed is still never read
        }
      }
      return null;
    },
    async write(draft) {
      const savedAt = now();
      const record: StoredGuestDraft = { ...draft, v: GUEST_DRAFT_VERSION, savedAt };
      for (const backend of backends()) {
        try {
          await backend.put(
            backend.keepsPictures
              ? record
              : { ...record, values: withoutPictures(record.values, record.pictures), pictures: [] },
          );
          setWaiting(savedAt);
          return backend.keepsPictures || draft.pictures.length === 0 ? "kept" : "values-only";
        } catch {
          // try the next one
        }
      }
      return false;
    },
    clear: clearAll,
  };
}
