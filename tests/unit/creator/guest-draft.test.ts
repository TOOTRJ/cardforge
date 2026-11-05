// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blobUrlPaths,
  guestDraftValues,
  mergeDraftValues,
  createGuestDraftStore,
  draftPictures,
  GUEST_DRAFT_TTL_MS,
  GUEST_DRAFT_VERSION,
  guestAuthHref,
  guestCardWaiting,
  guestDraftFromStored,
  guestPictureKindOf,
  onboardingFinishPath,
  restoredDraftValues,
  sessionStorageBackend,
  withValueAt,
  type GuestDraft,
  type GuestDraftBackend,
} from "@/lib/creator/guest-draft";
import { drawableCardMedia } from "@/lib/cards/drawable-media";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import type { FormValues } from "@/lib/creator/form-types";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO HM3: a guest's card waits in the browser through sign-up — IndexedDB
// with its pictures, this tab's sessionStorage (values only) where that
// fails, never the URL; a week at most; put back with fresh picture URLs.
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;

function values(extra: Partial<FormValues> = {}): FormValues {
  return {
    title: "Ember Wyrm",
    art_url: "blob:https://pipglyph.test/aaa",
    tags_text: "dragons",
    watermark: { kind: "custom", key: "", url: "blob:https://pipglyph.test/bbb", size: "normal", opacity: null },
    back_face: { art_url: "" },
    ...extra,
  } as unknown as FormValues;
}

function memoryBackend(opts: { keepsPictures?: boolean; failPut?: boolean } = {}) {
  let record: unknown = null;
  const backend: GuestDraftBackend & { record: () => unknown; set: (r: unknown) => void } = {
    keepsPictures: opts.keepsPictures ?? true,
    get: async () => record,
    put: async (r) => {
      if (opts.failPut) throw new Error("QuotaExceededError");
      // IndexedDB keeps a Blob as a Blob; a shallow copy does too.
      record = JSON.parse(JSON.stringify({ ...(r as object), pictures: [] }));
      (record as { pictures: unknown }).pictures = (r as { pictures: unknown[] }).pictures.map((p) => ({ ...(p as object) }));
    },
    delete: async () => {
      record = null;
    },
    record: () => record,
    set: (r) => {
      record = r;
    },
  };
  return backend;
}

const art = new Blob(["art-bytes"], { type: "image/png" });
const mark = new Blob(["mark-bytes"], { type: "image/webp" });

// In-memory Web Storage: Node's own global localStorage needs a backing file.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
}

beforeEach(() => {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const storage = memoryStorage();
    vi.stubGlobal(name, storage);
    Object.defineProperty(window, name, { value: storage, configurable: true });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pictures inside the values", () => {
  it("finds every blob: URL with its dotted path", () => {
    expect(blobUrlPaths(values())).toEqual([
      { path: "art_url", url: "blob:https://pipglyph.test/aaa" },
      { path: "watermark.url", url: "blob:https://pipglyph.test/bbb" },
    ]);
  });

  it("sets a nested value on a copy, never the caller's object", () => {
    const before = values();
    const after = withValueAt(before, "watermark.url", "https://x.test/m.png");
    expect((after as unknown as { watermark: { url: string } }).watermark.url).toBe("https://x.test/m.png");
    expect((before as unknown as { watermark: { url: string } }).watermark.url).toBe("blob:https://pipglyph.test/bbb");
  });

  it("keeps the files this page holds and drops a URL it can't bring", () => {
    const files = new Map([["blob:https://pipglyph.test/aaa", { blob: art, name: "wyrm.png" }]]);
    const out = draftPictures(values(), files);
    expect(out.pictures).toEqual([{ path: "art_url", blob: art, name: "wyrm.png" }]);
    expect((out.values as unknown as { watermark: { url: string } }).watermark.url).toBe("");
    expect(out.values.art_url).toBe("blob:https://pipglyph.test/aaa");
  });

  it("uploads a watermark path through the watermark action, anything else as art", () => {
    expect(guestPictureKindOf("watermark.url")).toBe("watermark");
    expect(guestPictureKindOf("art_url")).toBe("art");
    expect(guestPictureKindOf("back_face.art_url")).toBe("art");
  });

  it("restores each picture at a FRESH URL and clears any other blob URL", () => {
    const draft: GuestDraft = {
      values: values(),
      pictures: [{ path: "art_url", blob: art, name: "wyrm.png" }],
      tags: { following: true, base: [] },
      base: null,
      claimedBy: null,
    };
    let n = 0;
    const { values: restored, urls } = restoredDraftValues(draft, () => `blob:https://pipglyph.test/new-${++n}`);
    expect(restored.art_url).toBe("blob:https://pipglyph.test/new-1");
    expect((restored as unknown as { watermark: { url: string } }).watermark.url).toBe("");
    expect([...urls.keys()]).toEqual(["blob:https://pipglyph.test/new-1"]);
    expect(urls.get("blob:https://pipglyph.test/new-1")?.blob).toBe(art);
  });
});

describe("reading a stored draft", () => {
  const stored = (extra: Record<string, unknown> = {}) => ({
    v: GUEST_DRAFT_VERSION,
    savedAt: NOW - 1000,
    values: values(),
    pictures: [{ path: "art_url", blob: art, name: "wyrm.png" }],
    tags: { following: true, base: ["dragons"] },
    ...extra,
  });

  it("reads a fresh one of this version", () => {
    const draft = guestDraftFromStored(stored(), NOW);
    expect(draft?.values.title).toBe("Ember Wyrm");
    expect(draft?.pictures).toHaveLength(1);
    expect(draft?.tags).toEqual({ following: true, base: ["dragons"] });
  });

  it("refuses one past a week, from the future, of another version, or not ours", () => {
    expect(guestDraftFromStored(stored({ savedAt: NOW - GUEST_DRAFT_TTL_MS }), NOW)).toBeNull();
    expect(guestDraftFromStored(stored({ savedAt: NOW + 5 }), NOW)).toBeNull();
    expect(guestDraftFromStored(stored({ v: GUEST_DRAFT_VERSION + 1 }), NOW)).toBeNull();
    expect(guestDraftFromStored(stored({ values: [] }), NOW)).toBeNull();
    expect(guestDraftFromStored(stored({ values: { title: 3 } }), NOW)).toBeNull();
    expect(guestDraftFromStored("{}", NOW)).toBeNull();
    expect(guestDraftFromStored(null, NOW)).toBeNull();
  });

  it("drops a picture that isn't a Blob and tags that aren't strings", () => {
    const draft = guestDraftFromStored(
      stored({ pictures: [{ path: "art_url", blob: "nope", name: "x" }], tags: { following: "yes", base: [1, "a"] } }),
      NOW,
    );
    expect(draft?.pictures).toEqual([]);
    expect(draft?.tags).toEqual({ following: false, base: ["a"] });
  });
});

describe("the store", () => {
  const draft: GuestDraft = {
    values: values(),
    pictures: [
      { path: "art_url", blob: art, name: "wyrm.png" },
      { path: "watermark.url", blob: mark, name: "mark.webp" },
    ],
    tags: { following: true, base: [] },
    base: null,
    claimedBy: null,
  };

  it("keeps the pictures in IndexedDB and reads the draft back", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    expect(await store.write(draft)).toBe("kept");
    const back = await store.read(null);
    expect(back?.values.title).toBe("Ember Wyrm");
    expect(back?.pictures.map((p) => p.path)).toEqual(["art_url", "watermark.url"]);
    expect(guestCardWaiting(NOW + 1)).toBe(true);
  });

  it("falls back to this tab's sessionStorage, values only, with no dead picture URL", async () => {
    const store = createGuestDraftStore({
      backends: () => [memoryBackend({ failPut: true }), sessionStorageBackend()],
      now: () => NOW,
    });
    expect(await store.write(draft)).toBe("values-only");
    const raw = JSON.parse(sessionStorage.getItem("pipglyph:guest-card-draft") ?? "{}") as {
      values: FormValues & { watermark: { url: string } };
      pictures: unknown[];
    };
    expect(raw.pictures).toEqual([]);
    expect(raw.values.art_url).toBe("");
    expect(raw.values.watermark.url).toBe("");
    expect(raw.values.title).toBe("Ember Wyrm");
    expect((await store.read(null))?.values.title).toBe("Ember Wyrm");
  });

  it("says false when nothing can keep it, and never throws", async () => {
    const store = createGuestDraftStore({
      backends: () => [memoryBackend({ failPut: true }), null],
      now: () => NOW,
    });
    expect(await store.write(draft)).toBe(false);
    expect(await store.read(null)).toBeNull();
  });

  it("removes a stale draft when it reads one", async () => {
    const idb = memoryBackend();
    idb.set({ v: GUEST_DRAFT_VERSION, savedAt: NOW - GUEST_DRAFT_TTL_MS - 1, values: values(), pictures: [], tags: {} });
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    expect(await store.read(null)).toBeNull();
    expect(idb.record()).toBeNull();
  });

  it("clears every copy and the waiting flag", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb, sessionStorageBackend()], now: () => NOW });
    await store.write(draft);
    sessionStorage.setItem("pipglyph:guest-card-draft", "{}");
    await store.clear();
    expect(idb.record()).toBeNull();
    expect(sessionStorage.getItem("pipglyph:guest-card-draft")).toBeNull();
    expect(guestCardWaiting(NOW + 1)).toBe(false);
  });

  it("is not 'waiting' past the week", async () => {
    const store = createGuestDraftStore({ backends: () => [memoryBackend()], now: () => NOW });
    await store.write(draft);
    expect(guestCardWaiting(NOW + GUEST_DRAFT_TTL_MS)).toBe(false);
  });
});

describe("the way back", () => {
  it("signs up through onboarding to /create, signs in straight to it — safe paths only", () => {
    const signup = new URL(guestAuthHref("signup"), "https://pipglyph.test");
    expect(signup.pathname).toBe("/signup");
    const target = signup.searchParams.get("redirectTo") ?? "";
    expect(target).toBe("/onboarding?next=%2Fcreate");
    expect(safeRedirectPath(target)).toBe(target);
    const login = new URL(guestAuthHref("login"), "https://pipglyph.test");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("redirectTo")).toBe("/create");
  });

  it("onboarding finishes on /create only on its default and only while a card waits", () => {
    expect(onboardingFinishPath("/dashboard", true)).toBe("/create");
    expect(onboardingFinishPath("/dashboard", false)).toBe("/dashboard");
    expect(onboardingFinishPath("/dashboard/decks/new?format=commander", true)).toBe("/dashboard/decks/new?format=commander");
  });
});

describe("the live preview draws the page's own pictures, nothing else", () => {
  it("keeps a blob: URL only when the page names it", () => {
    const card = { artUrl: "blob:https://pipglyph.test/aaa", backFace: { art_url: "blob:https://pipglyph.test/zzz" } };
    expect(drawableCardMedia(card as unknown as CardPreviewData).artUrl).toBeNull();
    const local = drawableCardMedia(card as unknown as CardPreviewData, ["blob:https://pipglyph.test/aaa"]);
    expect(local.artUrl).toBe("blob:https://pipglyph.test/aaa");
    expect((local as { backFace: { art_url?: string } }).backFace.art_url).toBeUndefined();
  });

  it("never lets a listed outside https URL through", () => {
    const card = { artUrl: "https://evil.test/a.png" };
    expect(drawableCardMedia(card as unknown as CardPreviewData, ["https://evil.test/a.png"]).artUrl).toBeNull();
  });
});

describe("what a draft may hold (P1: only what a guest can set)", () => {
  const stored = values({
    deck_id: "deck-of-someone",
    source_scryfall_id: "scry-1",
    set_icon_url: "https://x.supabase.co/storage/v1/object/public/set-covers/a/icon.png",
    art_url: "https://x.supabase.co/storage/v1/object/public/card-art/user-a/art.png",
    back_face: { art_url: "blob:https://pipglyph.test/back" },
  } as Partial<FormValues>);

  it("drops a deck, an import's id, a set icon upload and every storage URL", () => {
    const out = guestDraftValues(stored) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty("deck_id");
    expect(out).not.toHaveProperty("source_scryfall_id");
    expect(out).not.toHaveProperty("set_icon_url");
    expect(out).not.toHaveProperty("art_url");
    expect((out.back_face as { art_url: string }).art_url).toBe("blob:https://pipglyph.test/back");
    expect(out.title).toBe("Ember Wyrm");
  });

  it("drops a custom watermark whose picture isn't kept; a built-in one stays", () => {
    const custom = guestDraftValues(
      values({ watermark: { kind: "custom", key: "", url: "https://x.test/m.png", size: "normal", opacity: null } } as Partial<FormValues>),
    ) as unknown as Record<string, unknown>;
    expect(custom).not.toHaveProperty("watermark");
    const builtIn = guestDraftValues(
      values({ watermark: { kind: "mana", key: "r", url: "", size: "large", opacity: null } } as Partial<FormValues>),
    );
    expect(builtIn.watermark).toEqual({ kind: "mana", key: "r", url: "", size: "large", opacity: null });
  });

  it("the store never writes one: a storage URL or a deck is gone from the record", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    await store.write({ values: stored, pictures: [], tags: { following: false, base: [] }, base: null, claimedBy: null });
    const record = idb.record() as { values: Record<string, unknown> };
    expect(record.values).not.toHaveProperty("deck_id");
    expect(record.values).not.toHaveProperty("art_url");
  });
});

describe("a restored card over the viewer's defaults (P2)", () => {
  const defaults = {
    title: "",
    footer_text: "Made by Kesh",
    artist_credit: "Kesh",
    tags_text: "",
    watermark: { kind: "", key: "", url: "", size: "normal", opacity: null },
    nickname: "",
    printed_types: null,
    station_pt_tier: null,
  } as unknown as FormValues;
  const guestBase = { ...defaults, footer_text: "", artist_credit: "" } as FormValues;

  it("a field the draft lacks (added since) takes the default — never undefined", () => {
    const out = mergeDraftValues(defaults, { title: "Ember Wyrm" } as FormValues, guestBase);
    expect(out.footer_text).toBe("Made by Kesh");
    expect(out.watermark).toEqual(defaults.watermark);
    expect(out.title).toBe("Ember Wyrm");
  });

  it("a field the guest never set takes the viewer's default; one they set is theirs", () => {
    const draft = { ...guestBase, title: "Ember Wyrm", artist_credit: "A. Guest" } as FormValues;
    const out = mergeDraftValues(defaults, draft, guestBase);
    expect(out.footer_text).toBe("Made by Kesh");
    expect(out.artist_credit).toBe("A. Guest");
  });

  it("a value of another shape, nested too, is the default's", () => {
    const draft = { ...guestBase, title: 7, watermark: { ...defaults.watermark, size: 3 } } as unknown as FormValues;
    const out = mergeDraftValues(defaults, draft, null);
    expect(out.title).toBe("");
    expect(out.watermark.size).toBe("normal");
  });

  it("null and an optional key the defaults leave out are kept", () => {
    const draft = { ...guestBase, printed_types: "Legendary Creature", saga_creature_text: "Flying" } as FormValues;
    const out = mergeDraftValues(defaults, draft, guestBase);
    expect(out.printed_types).toBe("Legendary Creature");
    expect(out.saga_creature_text).toBe("Flying");
  });
});

describe("a draft follows the person (P1: claimed at restore)", () => {
  const draft: GuestDraft = {
    values: values({ art_url: "", watermark: undefined } as unknown as Partial<FormValues>),
    pictures: [],
    tags: { following: false, base: [] },
    base: null,
    claimedBy: null,
  };

  it("once claimed, only its account is offered it", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    await store.write(draft);
    await store.claim("user-a");
    expect((await store.read("user-a"))?.claimedBy).toBe("user-a");
    expect(guestCardWaiting(NOW + 1)).toBe(false);
  });

  it("a later guest is never offered it, and it is removed", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    await store.write(draft);
    await store.claim("user-a");
    expect(await store.read(null)).toBeNull();
    expect(idb.record()).toBeNull();
  });

  it("another account is never offered it, and it is removed", async () => {
    const idb = memoryBackend();
    const store = createGuestDraftStore({ backends: () => [idb], now: () => NOW });
    await store.write(draft);
    await store.claim("user-a");
    expect(await store.read("user-b")).toBeNull();
    expect(idb.record()).toBeNull();
  });

  it("this tab's copy, once claimed, says no card waits", async () => {
    const store = createGuestDraftStore({ backends: () => [sessionStorageBackend()], now: () => NOW });
    await store.write(draft);
    await store.claim("user-a");
    localStorage.clear();
    expect(guestCardWaiting(NOW + 1)).toBe(false);
  });
});
