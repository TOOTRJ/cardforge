import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidFileName } from "@/lib/media/user-storage";
import {
  KeyIndex,
  MIN_AGE_DAYS,
  NOT_SWEPT,
  PAGE_SIZE,
  SWEEP_BUCKETS,
  URL_SOURCES,
  applySweep,
  backupDirProblem,
  classify,
  isServerMintedName,
  loadState,
  plainMd5,
  plannedBatches,
  privateCardRenders,
  readManifest,
  reconcilePending,
  referenceKey,
  renderCardId,
  sameEtag,
  saveState,
  scanReferences,
  stringVariants,
  tablesFromOpenApi,
  textColumns,
  userFolderKey,
} from "@/scripts/lib/storage-orphans.mjs";
import { limitStorage } from "@/scripts/lib/storage-calls.mjs";
import { emptyDb, fakeDb, fakeStorage, fakeSupabase, openApiOf, storagePool, type Db, type Obj, type StoredObject } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase/admin", () => ({ isAdminConfigured: () => false, createAdminClient: () => ({}) }));

// ---------------------------------------------------------------------------
// TODO 3.14b — the owner-run orphan sweep (scripts/sweep-storage-orphans.mjs):
// what counts as a reference (every column, any depth, any URL form), the
// age floor, live cards' bakes, the re-check right before each delete, the
// manifest and the resume after a crash — first against an in-memory fake
// database + storage, then the real CLI against a fake Supabase (Storage +
// PostgREST + its OpenAPI document) over HTTP.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/sweep-storage-orphans.mjs");
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const CARD_LIVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD_GONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "https://auth.pipglyph.com";
const LEGACY = "https://zkwkisxoqdhdchqyjwdc.supabase.co";
const pub = (bucket: string, key: string, host = HOST) => `${host}/storage/v1/object/public/${bucket}/${key}`;

// The fake database + storage and the fake Supabase over HTTP live in
// ./helpers/fake-supabase.ts (shared with the --private-renders and
// --rescan-review tests).

const obj = (bucket: string, p: string, ageDays = 30, extra: Partial<Obj> = {}): Obj => ({
  bucket,
  path: p,
  size: 1000,
  etag: `"etag-${bucket}-${p}"`,
  createdAt: daysAgo(ageDays),
  updatedAt: daysAgo(ageDays),
  lastModified: daysAgo(ageDays),
  ...extra,
});

// --- keys --------------------------------------------------------------------------

describe("object keys", () => {
  it("only {uuid}/{file} objects can ever be swept", () => {
    expect(userFolderKey(`${U1}/abc.jpg`)).toEqual({ folder: U1, name: "abc.jpg" });
    expect(userFolderKey(`${U1.toUpperCase()}/ABC.jpg`)).toEqual({ folder: U1, name: "abc.jpg" });
    for (const p of ["abc.jpg", `${U1}/nested/abc.jpg`, `not-a-uuid/abc.jpg`, `${U1}/.emptyFolderPlaceholder`, `${U1}/a b.jpg`, `${U1}/a..b.jpg`, `${U1}/`]) {
      expect(userFolderKey(p), p).toBeNull();
    }
  });

  it("accepts exactly the file names lib/media/user-storage.ts writes", () => {
    const names = ["abc.jpg", "avatar-x.png", "W.png", "wm-1.webp", `${CARD_LIVE}.thumb.webp`, "a".repeat(200), "a".repeat(201), ".hidden", "-x.png", "a b.png", "a/b.png", "a..b.png", "x%2F.png", "é.png", ""];
    for (const name of names) {
      expect(userFolderKey(`${U1}/${name}`) !== null, name).toBe(isValidFileName(name));
    }
  });

  it("a render belongs to the card its name carries — {cardId}.png or .thumb.webp only", () => {
    expect(renderCardId(`${U1}/${CARD_LIVE}.png`)).toBe(CARD_LIVE);
    expect(renderCardId(`${U1}/${CARD_LIVE}.thumb.webp`)).toBe(CARD_LIVE);
    expect(renderCardId(`${U1}/${CARD_LIVE}-1700000000.png`)).toBeNull();
    expect(renderCardId(`${U1}/${CARD_LIVE}.jpg`)).toBeNull();
    expect(renderCardId(`${CARD_LIVE}.png`)).toBeNull();
  });

  it("string variants: escaped slashes and percent-encoding (a next/image URL, twice over)", () => {
    const url = pub("card-art", `${U1}/x.png`);
    const once = encodeURIComponent(url);
    expect(stringVariants(`/_next/image?url=${once}&w=640`)).toContain(`/_next/image?url=${url.toLowerCase()}&w=640`);
    expect(stringVariants(encodeURIComponent(once)).some((s) => s.includes(`${U1}/x.png`))).toBe(true);
    expect(stringVariants(url.replaceAll("/", "\\/"))).toContain(url.toLowerCase());
    // A malformed escape doesn't throw.
    expect(() => stringVariants(`%E0%A4%A ${url}`)).not.toThrow();
  });

  it("lower-cases AFTER decoding: a percent-encoded capital still meets its key (review 2026-09-29)", async () => {
    // `%57` is `W`: decoding a lower-cased string left `W.png`, which missed
    // the lower-cased index — the unsafe direction (a live pip looked
    // unreferenced).
    expect(stringVariants(`${U1}/%57.png`)).toContain(`${U1}/w.png`);
    expect(stringVariants(`${U1}/%2557.png`)).toContain(`${U1}/w.png`); // encoded twice
    const db = emptyDb();
    db.custom_pips.rows.push({ id: "cp1", symbol: "W", image_url: `${pub("custom-pips", `${U1}/%57.png`)}?v=3` });
    db.messages.rows.push({ id: "m1", body: `/_next/image?url=${encodeURIComponent(pub("card-art", `${U1}/%41rt.png`))}` });
    const { referenced } = await scanReferences(fakeDb(db), new KeyIndex([`${U1}/W.png`, `${U1}/Art.png`]));
    expect([...referenced].sort()).toEqual([`${U1}/art.png`, `${U1}/w.png`]);
  });
});

describe("names the server makes (the dry run's review list)", () => {
  it("accepts every shape the upload paths write today", () => {
    const uuid = "0f1e2d3c-4b5a-4968-8776-655443322110";
    for (const [bucket, name] of [
      ["card-art", `${uuid}.jpg`],
      ["card-art", `ai-${uuid}.png`],
      ["card-art", `wm-${uuid}.webp`],
      ["card-art", `remix-${uuid}.jpg`],
      ["profile-media", `avatar-${uuid}.png`],
      ["profile-media", `banner-${uuid}.webp`],
      ["set-covers", `${uuid}.webp`],
      ["card-renders", `${CARD_LIVE}.png`],
      ["card-renders", `${CARD_LIVE}.thumb.webp`],
      ["custom-pips", "W.png"],
      ["custom-pips", "C.pending.png"],
    ]) {
      expect(isServerMintedName(bucket, `${U1}/${name}`), `${bucket}/${name}`).toBe(true);
    }
  });

  it("flags anything else — a hand-picked name is what a direct pre-0126 upload looks like", () => {
    for (const [bucket, name] of [
      ["card-art", "my-photo.jpg"],
      ["card-art", "abc.jpg"],
      ["profile-media", "avatar.png"],
      ["custom-pips", "X.png"],
      ["custom-pips", `${CARD_LIVE}.png`],
      ["card-art", "W.png"],
    ]) {
      expect(isServerMintedName(bucket, `${U1}/${name}`), `${bucket}/${name}`).toBe(false);
    }
    expect(isServerMintedName("card-art", "loose.jpg")).toBe(false);
  });
});

// --- reference detection -------------------------------------------------------------

describe("reference detection — every column, any depth, any URL form", () => {
  // One object per place the app stores (or might store) a key; each row
  // below names exactly one of them.
  const places: Array<[string, string, (db: Db, key: string) => void]> = [
    ["cards.art_url (upload, ?v=)", "card-art", (db, k) => db.cards.rows.push({ id: "c1", art_url: `${pub("card-art", k)}?v=17` })],
    ["cards.art_url on the legacy host", "card-art", (db, k) => db.cards.rows.push({ id: "c2", art_url: pub("card-art", k, LEGACY) })],
    ["cards.back_face.art_url (second face)", "card-art", (db, k) => db.cards.rows.push({ id: "c3", back_face: { title: "B", art_url: pub("card-art", k) } })],
    ["cards.set_icon_url", "set-covers", (db, k) => db.cards.rows.push({ id: "c4", set_icon_url: pub("set-covers", k) })],
    ["cards.watermark.url (land icon)", "card-art", (db, k) => db.cards.rows.push({ id: "c5", watermark: { kind: "custom", url: pub("card-art", k), size: "large" } })],
    ["cards.rendered_image_url", "card-renders", (db, k) => db.cards.rows.push({ id: "c6", rendered_image_url: `${pub("card-renders", k)}?v=1` })],
    ["cards.rendered_thumb_url", "card-renders", (db, k) => db.cards.rows.push({ id: "c7", rendered_thumb_url: `${pub("card-renders", k)}?v=1` })],
    ["cards.metadata (any JSON column)", "card-art", (db, k) => db.cards.rows.push({ id: "c8", metadata: { import: { previews: [{ src: pub("card-art", k) }] } } })],
    ["cards.tags (a text[] column)", "card-art", (db, k) => db.cards.rows.push({ id: "c9", tags: ["x", pub("card-art", k)] })],
    ["profiles.avatar_url", "profile-media", (db, k) => db.profiles.rows.push({ id: "p1", avatar_url: pub("profile-media", k) })],
    ["profiles.banner_url", "profile-media", (db, k) => db.profiles.rows.push({ id: "p2", banner_url: pub("profile-media", k) })],
    ["decks.cover_url (an AI cover lives in card-art)", "card-art", (db, k) => db.decks.rows.push({ id: "d1", cover_url: pub("card-art", k) })],
    ["deck_cards.image_url (a PipGlyph card's bake)", "card-renders", (db, k) => db.deck_cards.rows.push({ id: "dc1", image_url: pub("card-renders", k) })],
    ["custom_pips.image_url", "custom-pips", (db, k) => db.custom_pips.rows.push({ id: "cp1", symbol: "W", image_url: `${pub("custom-pips", k)}?v=9` })],
    ["challenges.hero_image_url", "card-art", (db, k) => db.challenges.rows.push({ id: "ch1", hero_image_url: pub("card-art", k) })],
    ["ai_generation_jobs.steps[].fill.art_url", "card-art", (db, k) => db.ai_generation_jobs.rows.push({ id: "j1", steps: [{ status: "done", fill: { art_url: pub("card-art", k) } }] })],
    ["card_idea_batches.ideas (nested)", "card-art", (db, k) => db.card_idea_batches.rows.push({ id: "i1", ideas: { concepts: [{ fields: { art_url: pub("card-art", k) } }] } })],
    ["deck_idea_batches.request", "set-covers", (db, k) => db.deck_idea_batches.rows.push({ id: "i2", request: { cover: pub("set-covers", k) } })],
    ["notifications.payload", "card-renders", (db, k) => db.notifications.rows.push({ id: 1, payload: { image: pub("card-renders", k) } })],
    ["site_updates.body (Markdown, a full stop after the URL)", "card-art", (db, k) => db.site_updates.rows.push({ id: "s1", body: `Look: ![art](${pub("card-art", k)}).` })],
    ["card_exports.storage_path (a bare key)", "card-art", (db, k) => db.card_exports.rows.push({ id: "e1", storage_path: k })],
    ["a /render-cdn/ path", "card-renders", (db, k) => db.messages.rows.push({ id: "m1", body: `see /render-cdn/${k}?v=3` })],
    ["a next/image URL (percent-encoded)", "profile-media", (db, k) => db.feedback.rows.push({ id: "f1", page_url: `https://pipglyph.com/_next/image?url=${encodeURIComponent(pub("profile-media", k))}&w=96` })],
    ["JSON-escaped slashes inside a string", "card-art", (db, k) => db.site_settings.rows.push({ key: "hero", value: JSON.stringify({ u: pub("card-art", k) }).replaceAll("/", "\\/") })],
    ["a JSON object KEY", "card-art", (db, k) => db.site_settings.rows.push({ key: "map", value: { [pub("card-art", k)]: true } })],
    ["an upper-case folder in the URL", "card-art", (db, k) => db.messages.rows.push({ id: "m2", body: pub("card-art", k.toUpperCase()) })],
    ["a table with a composite key", "card-art", (db, k) => db.frame_reviews.rows.push({ template: "m15", color_key: "w", score_json: { ref: pub("card-art", k) } })],
  ];

  it.each(places.map((p, i) => [...p, i] as const))("%s", async (_label, bucket, place, i) => {
    const db = emptyDb();
    const name = `${String(i).padStart(4, "0")}-${bucket === "card-renders" ? CARD_LIVE : "f"}.png`;
    const key = `${U1}/${name}`;
    place(db, key);
    const decoy = `${U2}/${name}`; // same name, another folder — must stay unreferenced
    const index = new KeyIndex([key, decoy]);
    const { referenced } = await scanReferences(fakeDb(db), index);
    expect([...referenced]).toEqual([referenceKey(key)]);
  });

  it("covers every documented URL source", () => {
    const tested = new Set(places.map(([label]) => label.split(/[ .]/)[0]));
    for (const { table } of URL_SOURCES) expect(tested, table).toContain(table);
  });

  it("an object nobody names stays unreferenced; a key in a uuid column is not text", async () => {
    const db = emptyDb();
    db.cards.rows.push({ id: "c1", art_url: pub("card-art", `${U1}/other.png`), owner_id: `${U1}/lonely.png` });
    const { referenced } = await scanReferences(fakeDb(db), new KeyIndex([`${U1}/lonely.png`]));
    expect(referenced.size).toBe(0);
  });

  it("a longer name that starts with a shorter one keeps both (over-keeping is the safe side)", async () => {
    const db = emptyDb();
    db.cards.rows.push({ id: "c1", art_url: pub("card-art", `${U1}/abc.png.bak`) });
    const { referenced } = await scanReferences(fakeDb(db), new KeyIndex([`${U1}/abc.png`, `${U1}/abc.png.bak`]));
    expect([...referenced].sort()).toEqual([`${U1}/abc.png`, `${U1}/abc.png.bak`]);
  });

  it("reads every text/JSON column and never a uuid/number/timestamp one", () => {
    const [cards] = tablesFromOpenApi(openApiOf({ cards: emptyDb().cards }));
    expect(cards.pk).toEqual(["id"]);
    expect(textColumns(cards).sort()).toEqual(
      ["art_url", "back_face", "face_content", "metadata", "rendered_image_url", "rendered_thumb_url", "set_icon_url", "tags", "title", "watermark"].sort(),
    );
    // An unknown type (an enum, a domain) is read.
    expect(textColumns({ name: "x", pk: [], columns: [{ name: "v", format: "public.visibility" }] })).toEqual(["v"]);
  });

  it("pages every table to the end even when the server caps pages below the ask", async () => {
    const db = emptyDb();
    const total = PAGE_SIZE + 700;
    for (let i = 0; i < total; i += 1) {
      db.cards.rows.push({ id: `c-${String(i).padStart(5, "0")}` });
      db.notifications.rows.push({ id: i + 1, payload: {} });
      db.frame_reviews.rows.push({ template: `t${i % 7}`, color_key: `k${String(i).padStart(5, "0")}` });
    }
    db.cards.rows[total - 1].art_url = pub("card-art", `${U1}/last.png`);
    db.notifications.rows[total - 1].payload = { u: pub("card-art", `${U1}/last-note.png`) };
    db.frame_reviews.rows[total - 1].score_json = { u: pub("card-art", `${U1}/last-review.png`) };
    const result = await scanReferences(fakeDb(db, { maxRows: 400 }), new KeyIndex([`${U1}/last.png`, `${U1}/last-note.png`, `${U1}/last-review.png`]));
    expect([...result.referenced].sort()).toEqual([`${U1}/last-note.png`, `${U1}/last-review.png`, `${U1}/last.png`]);
    expect(result.scanned.find((t: { table: string }) => t.table === "cards")?.rows).toBe(total);
    expect(result.scanned.find((t: { table: string }) => t.table === "frame_reviews")?.rows).toBe(total);
    // Card ids are collected (card-renders are kept while their card exists)…
    expect(result.cardIds.size).toBe(0); // …only real uuids count
    // …and a table with no text column is skipped.
    expect(result.skipped).toContain("card_likes");
  });

  it("refuses when a documented URL table is missing from the API schema, and on any read error", async () => {
    const db = emptyDb();
    delete (db as Partial<Db>).custom_pips;
    await expect(scanReferences(fakeDb(db), new KeyIndex([]))).rejects.toThrow(/missing custom_pips/);
    await expect(scanReferences(fakeDb(emptyDb(), { failOn: "notifications" }), new KeyIndex([]))).rejects.toThrow(/notifications: boom/);
  });
});

// --- classification --------------------------------------------------------------------

describe("classify", () => {
  const ctx = (referenced: string[] = [], cardIds: string[] = []) => ({
    referenced: new Set(referenced.map((k) => k.toLowerCase())),
    cardIds: new Set(cardIds),
    now: NOW,
    minAgeDays: MIN_AGE_DAYS,
  });
  const verdicts = (objects: Obj[], c = ctx()) => Object.fromEntries(classify(objects, c).map((o: Obj & { verdict: string }) => [`${o.bucket}/${o.path}`, o.verdict]));

  it("the age floor: 7 days since the LAST change, in every bucket", () => {
    expect(
      verdicts([
        obj("card-art", `${U1}/old.jpg`, 7.1),
        obj("card-art", `${U1}/young.jpg`, 6.9),
        obj("profile-media", `${U1}/young.png`, 1),
        obj("custom-pips", `${U1}/W.png`, 30, { updatedAt: daysAgo(2) }), // re-uploaded in place
        obj("set-covers", `${U1}/touched.png`, 30, { lastModified: daysAgo(3) }),
        obj("card-art", `${U1}/undated.jpg`, 30, { createdAt: "", updatedAt: "", lastModified: "" }),
      ]),
    ).toEqual({
      [`card-art/${U1}/old.jpg`]: "orphan",
      [`card-art/${U1}/young.jpg`]: "tooNew",
      [`profile-media/${U1}/young.png`]: "tooNew",
      [`custom-pips/${U1}/W.png`]: "tooNew",
      [`set-covers/${U1}/touched.png`]: "tooNew",
      [`card-art/${U1}/undated.jpg`]: "tooNew",
    });
    expect(verdicts([obj("card-art", `${U1}/old.jpg`, 10)], { ...ctx(), minAgeDays: 14 })[`card-art/${U1}/old.jpg`]).toBe("tooNew");
  });

  it("a live card's bake and thumb are kept whatever references them; a deleted card's are orphans", () => {
    expect(
      verdicts(
        [
          obj("card-renders", `${U1}/${CARD_LIVE}.png`),
          obj("card-renders", `${U1}/${CARD_LIVE}.thumb.webp`),
          obj("card-renders", `${U2}/${CARD_LIVE}.png`), // another owner's folder: still that card
          obj("card-renders", `${U1}/${CARD_GONE}.png`),
          obj("card-renders", `${U1}/${CARD_GONE}.thumb.webp`),
          obj("card-renders", `${U1}/legacy-render.png`),
        ],
        ctx([], [CARD_LIVE]),
      ),
    ).toEqual({
      [`card-renders/${U1}/${CARD_LIVE}.png`]: "liveCard",
      [`card-renders/${U1}/${CARD_LIVE}.thumb.webp`]: "liveCard",
      [`card-renders/${U2}/${CARD_LIVE}.png`]: "liveCard",
      [`card-renders/${U1}/${CARD_GONE}.png`]: "orphan",
      [`card-renders/${U1}/${CARD_GONE}.thumb.webp`]: "orphan",
      [`card-renders/${U1}/legacy-render.png`]: "unknownRender",
    });
    // A deleted card's bake that a row still names (a deck proxy) is kept.
    expect(verdicts([obj("card-renders", `${U1}/${CARD_GONE}.png`)], ctx([`${U1}/${CARD_GONE}.png`]))[`card-renders/${U1}/${CARD_GONE}.png`]).toBe("referenced");
  });

  it("referenced, outside a user folder, no eTag, and never-swept buckets are kept", () => {
    expect(
      verdicts(
        [
          obj("card-art", `${U1}/used.jpg`),
          obj("card-art", `loose.jpg`),
          obj("card-art", `${U1}/deep/x.jpg`),
          obj("card-art", `${U1}/no-etag.jpg`, 30, { etag: "" }),
          obj("card-exports", `${U1}/${CARD_GONE}-1.png`),
          obj("frames", `abc/def.png`),
        ],
        ctx([`${U1}/used.jpg`]),
      ),
    ).toEqual({
      [`card-art/${U1}/used.jpg`]: "referenced",
      "card-art/loose.jpg": "outside",
      [`card-art/${U1}/deep/x.jpg`]: "outside",
      [`card-art/${U1}/no-etag.jpg`]: "outside",
      [`card-exports/${U1}/${CARD_GONE}-1.png`]: "notSwept",
      "frames/abc/def.png": "notSwept",
    });
    expect(SWEEP_BUCKETS).not.toContain("frames");
    expect(SWEEP_BUCKETS).not.toContain("card-exports");
    expect(Object.keys(NOT_SWEPT).sort()).toEqual(["card-exports", "frames"]);
  });
});

// --- apply -----------------------------------------------------------------------------

describe("applySweep", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "sweep-apply-"));
  });
  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup(objects: Obj[], db = emptyDb(), dbOpts: Parameters<typeof fakeDb>[1] = {}, storageOpts: Parameters<typeof fakeStorage>[1] = {}) {
    const storage = fakeStorage(objects, storageOpts);
    const database = fakeDb(db, dbOpts);
    const statePath = path.join(tmp, "state.json");
    const manifestPath = path.join(tmp, "manifest.jsonl");
    const state = loadState(statePath);
    const candidates = classify(objects, { referenced: new Set(), cardIds: new Set(), now: Date.now(), minAgeDays: MIN_AGE_DAYS }).filter(
      (o: { verdict: string }) => o.verdict === "orphan",
    );
    const run = (extra: Record<string, unknown> = {}) =>
      applySweep({ db: database, storage, candidates, state, statePath, manifestPath, target: "dev.example", run: "r1", ...extra });
    return { storage, database, statePath, manifestPath, state, candidates, run };
  }
  const real = (bucket: string, p: string, ageDays = 30, extra: Partial<Obj> = {}) => {
    const t = new Date(Date.now() - ageDays * DAY).toISOString();
    return obj(bucket, p, ageDays, { createdAt: t, updatedAt: t, lastModified: t, ...extra });
  };

  it("deletes in batches (one bucket each), re-scanning the database before every batch, and logs each delete", async () => {
    const objects = [
      real("card-art", `${U1}/a.jpg`),
      real("card-art", `${U1}/b.jpg`),
      real("card-art", `${U1}/c.jpg`),
      real("profile-media", `${U1}/avatar-x.png`),
    ];
    const s = setup(objects);
    const result = await s.run({ batchSize: 2 });
    expect(result.deleted).toBe(4);
    expect(s.storage.removes).toEqual([
      [`card-art/${U1}/a.jpg`, `card-art/${U1}/b.jpg`],
      [`card-art/${U1}/c.jpg`],
      [`profile-media/${U1}/avatar-x.png`],
    ]);
    expect(s.database.selects.filter((t) => t === "cards")).toHaveLength(3); // one full scan per batch
    const manifest = readManifest(s.manifestPath);
    expect(manifest.map((e: { bucket: string; path: string }) => `${e.bucket}/${e.path}`)).toEqual(objects.map((o) => `${o.bucket}/${o.path}`));
    expect(manifest[0]).toMatchObject({ target: "dev.example", run: "r1", size: 1000, etag: `"etag-card-art-${U1}/a.jpg"`, reason: "no row references it" });
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 4, bytes: 4000 });
  });

  it("re-checks right before deleting: a new row, a re-created card, a changed / vanished / touched object are all kept", async () => {
    const db = emptyDb();
    const objects = [
      real("card-art", `${U1}/now-used.jpg`),
      real("card-renders", `${U1}/${CARD_GONE}.png`),
      real("card-art", `${U1}/changed.jpg`),
      real("card-art", `${U1}/vanished.jpg`),
      real("card-art", `${U1}/touched.jpg`),
      real("card-art", `${U1}/still-orphan.jpg`),
    ];
    const s = setup(objects, db, {
      // Between the listing and the delete: a card starts using one upload,
      // the deleted card comes back (an undo, a restore).
      onScan: () => {
        db.cards.rows.push({ id: "c1", art_url: pub("card-art", `${U1}/now-used.jpg`) });
        db.cards.rows.push({ id: CARD_GONE });
      },
    });
    s.storage.store.get(`card-art/${U1}/changed.jpg`)!.etag = '"new-bytes"';
    s.storage.store.delete(`card-art/${U1}/vanished.jpg`);
    s.storage.store.get(`card-art/${U1}/touched.jpg`)!.updatedAt = new Date().toISOString();
    const result = await s.run();
    expect(result.deleted).toBe(1);
    expect(Object.fromEntries(result.skipped.map((k: { path: string; why: string }) => [k.path.split("/")[1], k.why]))).toEqual({
      "now-used.jpg": "a row references it now",
      [`${CARD_GONE}.png`]: "its card exists now",
      "changed.jpg": "changed since it was listed",
      "vanished.jpg": "already gone",
      "touched.jpg": "younger than 7 days now",
    });
    expect([...s.storage.store.keys()].sort()).toEqual(
      [`card-art/${U1}/changed.jpg`, `card-art/${U1}/now-used.jpg`, `card-art/${U1}/touched.jpg`, `card-renders/${U1}/${CARD_GONE}.png`].sort(),
    );
    expect(readManifest(s.manifestPath).map((e: { path: string }) => e.path)).toEqual([`${U1}/still-orphan.jpg`]);
  });

  it("compares eTags however each API quotes them (review 2026-09-29)", async () => {
    const md5 = createHash("md5").update("x").digest("hex");
    expect(sameEtag(`"${md5}"`, md5)).toBe(true);
    expect(sameEtag(`W/"${md5.toUpperCase()}"`, `"${md5}"`)).toBe(true);
    expect(sameEtag(`"${md5}"`, `"${"0".repeat(32)}"`)).toBe(false);
    expect(sameEtag('"abc-3"', "abc-3")).toBe(true);
    expect(sameEtag('"abc-3"', '"abc-4"')).toBe(false);
    expect(sameEtag(null, null)).toBe(false);
    expect(plainMd5(`W/"${md5}"`)).toBe(md5);
    // The listing says `"<md5>"`, info() says `<md5>`: still the same object,
    // so it IS deleted — a strict !== kept everything and deleted nothing.
    const objects = [real("card-art", `${U1}/a.jpg`, 30, { etag: `"${md5}"` })];
    const s = setup(objects, emptyDb(), {}, { infoEtag: (e) => e.replaceAll('"', "") });
    expect((await s.run()).deleted).toBe(1);
  });

  it("trusts storage's own lookup after the delete, not the names remove() echoes", async () => {
    const md5 = (text: string) => `"${createHash("md5").update(text).digest("hex")}"`;
    const objects = ["a.jpg", "b.jpg", "c.jpg"].map((n) => real("card-art", `${U1}/${n}`, 30, { etag: md5(`bytes of card-art/${U1}/${n}`) }));
    const backupDir = path.join(tmp, "backup-echo");
    // remove() answers with names that aren't the requested paths, and names
    // b.jpg as removed although it is still there.
    const s = setup(objects, emptyDb(), {}, { echo: "renamed", sticky: [`${U1}/b.jpg`] });
    const result = await s.run({ backupDir });
    expect(result.deleted).toBe(2);
    expect(readManifest(s.manifestPath).map((e: { path: string }) => e.path)).toEqual([`${U1}/a.jpg`, `${U1}/c.jpg`]);
    expect(result.skipped).toEqual([{ bucket: "card-art", path: `${U1}/b.jpg`, why: "storage did not remove it" }]);
    // The copies of what is gone stay; the copy of what is still there goes.
    expect(existsSync(path.join(backupDir, "card-art", U1, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(backupDir, "card-art", U1, "c.jpg"))).toBe(true);
    expect(existsSync(path.join(backupDir, "card-art", U1, "b.jpg"))).toBe(false);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 2 });

    // remove() echoing nothing at all: still logged by the lookup.
    const quiet = setup([real("card-art", `${U2}/d.jpg`)], emptyDb(), {}, { echo: "none" });
    expect((await quiet.run()).deleted).toBeGreaterThanOrEqual(1);
    expect(readManifest(quiet.manifestPath).map((e: { path: string }) => e.path)).toContain(`${U2}/d.jpg`);
  });

  it("an unconfirmed delete stays pending with its copy; the next run settles it", async () => {
    const md5 = (text: string) => `"${createHash("md5").update(text).digest("hex")}"`;
    const objects = ["a.jpg", "b.jpg"].map((n) => real("card-art", `${U1}/${n}`, 30, { etag: md5(`bytes of card-art/${U1}/${n}`) }));
    const backupDir = path.join(tmp, "backup-unsettled");
    const s = setup(objects, emptyDb(), {}, { lookupFailsAfterRemove: [`${U1}/b.jpg`] });
    const result = await s.run({ backupDir });
    expect(result.deleted).toBe(1);
    expect(result.failed).toEqual([{ bucket: "card-art", paths: [`${U1}/b.jpg`], error: "delete not confirmed" }]);
    const state = loadState(s.statePath);
    expect(state.pending.items.map((i: { path: string }) => i.path)).toEqual([`${U1}/b.jpg`]);
    expect(existsSync(path.join(backupDir, "card-art", U1, "b.jpg"))).toBe(true);
    // Next run: storage says it's gone → the manifest.
    const settled = await reconcilePending({ storage: fakeStorage([]), state, statePath: s.statePath, manifestPath: s.manifestPath, target: "dev.example" });
    expect(settled).toEqual({ gone: 1, present: 0 });
    expect(readManifest(s.manifestPath).map((e: { path: string }) => e.path)).toEqual([`${U1}/a.jpg`, `${U1}/b.jpg`]);
  });

  it("stops at --limit, and a re-run picks up the rest", async () => {
    const objects = [real("card-art", `${U1}/a.jpg`), real("card-art", `${U1}/b.jpg`), real("card-art", `${U1}/c.jpg`)];
    const s = setup(objects);
    expect((await s.run({ limit: 2, batchSize: 5 })).deleted).toBe(2);
    expect(s.storage.store.size).toBe(1);
  });

  it("--backup-dir copies each object first — the copy must be the listed bytes; copies of kept objects are dropped", async () => {
    const md5 = (text: string) => `"${createHash("md5").update(text).digest("hex")}"`;
    const db = emptyDb();
    const objects = [
      real("card-art", `${U1}/a.jpg`, 30, { etag: md5(`bytes of card-art/${U1}/a.jpg`) }), // copied, deleted
      real("card-art", `${U1}/b.jpg`), // the download fails
      real("card-art", `${U1}/c.jpg`, 30, { etag: md5("the bytes that were listed") }), // replaced since
      real("card-art", `${U1}/d.jpg`, 30, { etag: '"etag-multipart-3"' }), // multipart eTag: can't be checked, copied
      real("card-art", `${U1}/e.jpg`), // copied, then a row names it
    ];
    const s = setup(objects, db, { onScan: () => void db.messages.rows.push({ id: "m1", body: pub("card-art", `${U1}/e.jpg`) }) }, { downloadFails: `${U1}/b.jpg` });
    const backupDir = path.join(tmp, "backup");
    const result = await s.run({ backupDir });
    expect(result.deleted).toBe(2);
    expect(Object.fromEntries(result.skipped.map((k: { path: string; why: string }) => [k.path.split("/")[1], k.why]))).toEqual({
      "b.jpg": "backup failed (download failed)",
      "c.jpg": "backup failed (its bytes changed since it was listed)",
      "e.jpg": "a row references it now",
    });
    const copy = (name: string) => path.join(backupDir, "card-art", U1, name);
    expect(readFileSync(copy("a.jpg"), "utf8")).toBe(`bytes of card-art/${U1}/a.jpg`);
    expect(existsSync(copy("d.jpg"))).toBe(true);
    for (const kept of ["b.jpg", "c.jpg", "e.jpg"]) expect(existsSync(copy(kept)), kept).toBe(false);
    expect([...s.storage.store.keys()].sort()).toEqual([`card-art/${U1}/b.jpg`, `card-art/${U1}/c.jpg`, `card-art/${U1}/e.jpg`]);
    expect(readManifest(s.manifestPath).map((e: { path: string; backup?: string }) => [e.path, e.backup])).toEqual([
      [`${U1}/a.jpg`, copy("a.jpg")],
      [`${U1}/d.jpg`, copy("d.jpg")],
    ]);
  });

  it("a delete that fails leaves the batch pending; the next run settles it into the manifest", async () => {
    const objects = [real("card-art", `${U1}/a.jpg`), real("card-art", `${U1}/b.jpg`)];
    const s = setup(objects, emptyDb(), {}, { removeFails: true });
    const result = await s.run();
    expect(result.deleted).toBe(0);
    expect(result.failed).toHaveLength(1);
    const state = loadState(s.statePath);
    expect(state.pending.items.map((i: { path: string }) => i.path)).toEqual([`${U1}/a.jpg`, `${U1}/b.jpg`]);
    expect(readManifest(s.manifestPath)).toEqual([]);

    // The delete had in fact gone through for one of them (a timeout after
    // the server acted): the next run asks storage.
    s.storage.store.delete(`card-art/${U1}/a.jpg`);
    const settled = await reconcilePending({ storage: s.storage, state, statePath: s.statePath, manifestPath: s.manifestPath, target: "dev.example" });
    expect(settled).toEqual({ gone: 1, present: 1 });
    expect(readManifest(s.manifestPath)).toMatchObject([{ bucket: "card-art", path: `${U1}/a.jpg`, note: "confirmed after an interrupted run" }]);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 1 });
  });

  it("refuses an age floor under 7 days, a non-orphan, and a bucket it never sweeps", async () => {
    const s = setup([real("card-art", `${U1}/a.jpg`)]);
    await expect(s.run({ minAgeDays: 3 })).rejects.toThrow(/7 days/);
    await expect(s.run({ candidates: [{ ...real("card-art", `${U1}/a.jpg`), verdict: "referenced" }] })).rejects.toThrow(/not an orphan/);
    await expect(s.run({ candidates: [{ ...real("frames", `${U1}/a.png`), verdict: "orphan" }] })).rejects.toThrow(/never swept/);
    expect(s.storage.removes).toEqual([]);
  });

  it("state round-trips", () => {
    const file = path.join(tmp, "s.json");
    saveState(file, { ...loadState(file), target: "x", deleted: 3 });
    expect(loadState(file)).toMatchObject({ version: 1, target: "x", deleted: 3, pending: null });
  });

  // Incident 2026-09-29: `--apply --batch-size 100` on production deleted 193
  // objects, then a batch failed — "couldn't confirm the delete (Too many
  // connections issued to the database)": every lookup of a batch went out at
  // once and Supabase Storage ran out of database connections.
  it("a batch of 100 against a storage that refuses a 5th call at once: every object deleted and confirmed, never more than 4 in flight", async () => {
    const md5 = (text: string) => `"${createHash("md5").update(text).digest("hex")}"`;
    const objects = Array.from({ length: 100 }, (_, i) =>
      real("card-art", `${U1}/${String(i).padStart(3, "0")}.jpg`, 30, { etag: md5(`bytes of card-art/${U1}/${String(i).padStart(3, "0")}.jpg`) }),
    );
    const s = setup(objects, emptyDb(), {}, { maxConcurrent: 4 });
    const result = await s.run({ batchSize: 100, backupDir: path.join(tmp, "backup-100") });
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.deleted).toBe(100);
    expect(s.storage.store.size).toBe(0);
    expect(s.storage.stats).toMatchObject({ peak: 4, refused: 0 });
    expect(s.database.selects.filter((t) => t === "cards")).toHaveLength(1); // still ONE full scan for the batch
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 100 });
  });

  it("a busy storage is retried: a lookup or a confirm that answers \"Too many connections\" first still decides", async () => {
    const objects = [real("card-art", `${U1}/a.jpg`), real("card-art", `${U1}/b.jpg`)];
    // a.jpg: busy once on its lookup before the delete; b.jpg: busy twice on
    // the confirm after it (what failed on 2026-09-29).
    const s = setup(objects, emptyDb(), {}, { busyInfo: { [`${U1}/a.jpg`]: 1 }, busyInfoAfterRemove: { [`${U1}/b.jpg`]: 2 } });
    const waits: number[] = [];
    const lines: string[] = [];
    const storage = limitStorage(s.storage, { sleep: async (ms: number) => void waits.push(ms), log: (l: string) => lines.push(l) });
    const result = await s.run({ storage, log: (l: string) => lines.push(l) });
    expect(result).toMatchObject({ deleted: 2, skipped: [], failed: [] });
    expect(waits).toHaveLength(3);
    expect(lines.filter((l) => l.includes("storage busy on info"))).toHaveLength(3);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 2 });
  });

  it("reconcilePending retries a busy storage too (a raw storage gets the default limiter)", async () => {
    const items = [`${U1}/a.jpg`, `${U1}/b.jpg`].map((p) => ({ path: p, size: 1, etag: '"e"', reason: "no row references it" }));
    const statePath = path.join(tmp, "state.json");
    const state = { ...loadState(statePath), pending: { bucket: "card-art", run: "r0", at: "x", items } };
    // The settle that follows the incident's failed batch: storage still busy once.
    const storage = fakeStorage([], { busyInfo: { [`${U1}/b.jpg`]: 1 } });
    const settled = await reconcilePending({ storage, state, statePath, manifestPath: path.join(tmp, "m.jsonl"), target: "dev.example" });
    expect(settled).toEqual({ gone: 2, present: 0 });
    expect(loadState(statePath)).toMatchObject({ pending: null, deleted: 2 });
  });

  // Skeptic review of the fix: a remove re-sent after a backoff must not lean
  // on the lookups made before it — storage has no conditional delete.
  it("a busy remove is sent again only after step 3 is repeated: an object whose bytes changed during the wait is kept", async () => {
    const objects = [real("card-art", `${U1}/a.jpg`), real("card-art", `${U1}/b.jpg`)];
    const s = setup(objects, emptyDb(), {}, { busyRemove: 1 });
    const backupDir = path.join(tmp, "backup-busy-remove");
    const waits: number[] = [];
    const lines: string[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
      // While we wait, b.jpg gets new bytes at the same name.
      const b = s.storage.store.get(`card-art/${U1}/b.jpg`)!;
      s.storage.store.set(`card-art/${U1}/b.jpg`, { ...b, etag: '"new-bytes"' });
    };
    const storage = limitStorage(s.storage, { sleep, log: (l: string) => lines.push(l) });
    const result = await s.run({ storage, backupDir, log: (l: string) => lines.push(l) });
    expect(waits).toHaveLength(1);
    expect(s.storage.removes).toEqual([[`card-art/${U1}/a.jpg`, `card-art/${U1}/b.jpg`], [`card-art/${U1}/a.jpg`]]);
    expect(result).toMatchObject({ deleted: 1, failed: [] });
    expect(result.skipped).toEqual([{ bucket: "card-art", path: `${U1}/b.jpg`, why: "changed since it was listed" }]);
    expect(s.storage.store.get(`card-art/${U1}/b.jpg`)?.etag).toBe('"new-bytes"');
    expect(lines.some((l) => l.includes("storage busy on remove of 2 object(s) in card-art: Too many connections"))).toBe(true);
    expect(readManifest(s.manifestPath).map((e: { path: string }) => e.path)).toEqual([`${U1}/a.jpg`]);
    expect(existsSync(path.join(backupDir, "card-art", U1, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(backupDir, "card-art", U1, "b.jpg"))).toBe(false);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 1 });
  });

  it("a remove that went through but answered busy is never sent again: what landed at the name since is kept, the delete is recorded with its copy", async () => {
    const objects = [real("custom-pips", `${U1}/W.png`), real("custom-pips", `${U1}/U.png`)];
    const s = setup(objects, emptyDb(), {}, { busyRemoveAfterDelete: 1 });
    const backupDir = path.join(tmp, "backup-lost-answer");
    const reuploaded = { ...objects[0], etag: '"re-uploaded"', updatedAt: new Date().toISOString(), lastModified: new Date().toISOString() };
    const sleep = async () => {
      // The pip is saved again at its fixed name while we wait.
      s.storage.store.set(`custom-pips/${U1}/W.png`, reuploaded);
    };
    const storage = limitStorage(s.storage, { sleep });
    const result = await s.run({ storage, backupDir });
    expect(s.storage.removes).toHaveLength(1); // one delete, never a second
    expect(s.storage.store.get(`custom-pips/${U1}/W.png`)).toEqual(reuploaded);
    expect(result).toMatchObject({ deleted: 1, failed: [] });
    expect(result.skipped).toEqual([{ bucket: "custom-pips", path: `${U1}/W.png`, why: "changed since it was listed" }]);
    // U.png: gone after the first try — recorded (not "already gone"), its copy kept.
    expect(readManifest(s.manifestPath).map((e: { path: string; backup?: string }) => [e.path, e.backup])).toEqual([
      [`${U1}/U.png`, path.join(backupDir, "custom-pips", U1, "U.png")],
    ]);
    expect(existsSync(path.join(backupDir, "custom-pips", U1, "U.png"))).toBe(true);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 1 });
  });

  it("a busy remove whose re-check finds nothing left to delete sends no second remove", async () => {
    const s = setup([real("card-art", `${U1}/a.jpg`)], emptyDb(), {}, { busyRemoveAfterDelete: 1 });
    const storage = limitStorage(s.storage, { sleep: async () => {} });
    const result = await s.run({ storage });
    expect(s.storage.removes).toHaveLength(1);
    expect(result).toMatchObject({ deleted: 1, skipped: [], failed: [] });
  });

  it("a remove still busy after every try fails the batch and leaves it pending (the next run settles it)", async () => {
    const s = setup([real("card-art", `${U1}/a.jpg`)], emptyDb(), {}, { busyRemove: 99 });
    const storage = limitStorage(s.storage, { sleep: async () => {} });
    const result = await s.run({ storage });
    expect(s.storage.removes).toHaveLength(4);
    expect(result.deleted).toBe(0);
    expect(result.failed).toEqual([{ bucket: "card-art", paths: [`${U1}/a.jpg`], error: "Too many connections issued to the database" }]);
    expect(loadState(s.statePath).pending.items.map((i: { path: string }) => i.path)).toEqual([`${U1}/a.jpg`]);
  });
});

// --- the run plan, backups, private renders -------------------------------------------------

describe("plannedBatches — the full database reads an --apply run makes", () => {
  const o = (bucket: string, n: number) => Array.from({ length: n }, (_, i) => ({ bucket, path: `${U1}/${i}.png` }));
  it("one per batch, one bucket per batch, capped by --limit", () => {
    const candidates = [...o("card-art", 1000), ...o("profile-media", 30)];
    expect(plannedBatches(candidates, 25)).toBe(40 + 2);
    expect(plannedBatches(candidates, 100)).toBe(10 + 1);
    expect(plannedBatches(candidates, 25, 60)).toBe(3);
    expect(plannedBatches([], 25)).toBe(0);
  });
});

describe("backupDirProblem — users' images never land in a (public) repository", () => {
  it("refuses a directory inside this checkout, or inside any git working tree", () => {
    expect(backupDirProblem(path.join(ROOT, "sweep-backups"), ROOT)).toMatch(/inside this repository/);
    expect(backupDirProblem(path.join(ROOT, "scripts", "not-yet", "there"), ROOT)).toMatch(/inside this repository/);
    const other = mkdtempSync(path.join(os.tmpdir(), "sweep-git-"));
    try {
      spawnSyncGit(other);
      expect(backupDirProblem(path.join(other, "copies"), ROOT)).toMatch(/inside the git working tree/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("accepts a directory outside any repository", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sweep-backup-ok-"));
    try {
      expect(backupDirProblem(path.join(dir, "2026-09-29"), ROOT)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renders of private cards (a privacy follow-up the dry run lists)", () => {
  it("the scan collects private card ids, and their renders are listed whatever their verdict", async () => {
    const db = emptyDb();
    db.cards.columns.visibility = "text";
    db.cards.rows.push(
      { id: CARD_LIVE, visibility: "private", rendered_image_url: pub("card-renders", `${U1}/${CARD_LIVE}.png`) },
      { id: CARD_GONE, visibility: "public" },
    );
    const scan = await scanReferences(fakeDb(db), new KeyIndex([`${U1}/${CARD_LIVE}.png`]));
    expect([...scan.privateCardIds]).toEqual([CARD_LIVE]);
    const objects = [
      obj("card-renders", `${U1}/${CARD_LIVE}.png`),
      obj("card-renders", `${U1}/${CARD_LIVE}.thumb.webp`),
      obj("card-renders", `${U1}/${CARD_GONE}.png`),
      obj("card-art", `${U1}/${CARD_LIVE}.png`),
    ];
    const classified = classify(objects, { referenced: scan.referenced, cardIds: scan.cardIds, now: NOW, minAgeDays: MIN_AGE_DAYS });
    expect(privateCardRenders(classified, scan.privateCardIds).map((o: Obj) => o.path)).toEqual([
      `${U1}/${CARD_LIVE}.png`,
      `${U1}/${CARD_LIVE}.thumb.webp`,
    ]);
    // …and none of them is ever an orphan.
    expect(classified.filter((o: { verdict: string }) => o.verdict === "orphan").map((o: Obj) => o.path)).toEqual([]);
  });
});

function spawnSyncGit(dir: string) {
  const r = spawnSync("git", ["init", "-q", dir]);
  if (r.status !== 0) throw new Error("git init failed");
}

// --- the CLI against a fake Supabase ------------------------------------------------------

describe("scripts/sweep-storage-orphans.mjs against a fake Supabase", () => {
  let tmp = "";
  let server: Server;
  const store = new Map<string, StoredObject>();
  const db = emptyDb();
  let openApiHook: (() => void) | undefined;
  const put = (key: string, ageDays: number) => {
    const t = new Date(Date.now() - ageDays * DAY).toISOString();
    const bytes = Buffer.from(`bytes:${key}`);
    store.set(key, { bytes, etag: `"${createHash("md5").update(bytes).digest("hex")}"`, created: t, updated: t });
  };

  function run(args: string[], input = ""): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, HOME: tmp } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(input);
    });
  }
  const common = () => ["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json"), "--manifest", path.join(tmp, "manifest.jsonl")];

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "sweep-cli-"));
    // Referenced, young, orphaned, live bakes, a deleted card's bakes, odd shapes.
    put(`card-art/${U1}/used.jpg`, 30);
    put(`card-art/${U1}/draft.jpg`, 2); // an unsaved draft's fresh upload
    put(`card-art/${U1}/orphan.jpg`, 30);
    put(`card-art/${U1}/second-face.jpg`, 30);
    put(`card-art/${U1}/appears-later.jpg`, 30);
    put(`card-art/loose.jpg`, 30);
    put(`profile-media/${U2}/avatar-old.png`, 40);
    put(`profile-media/${U2}/avatar-new.png`, 40);
    put(`custom-pips/${U2}/W.png`, 40);
    put(`card-renders/${U1}/${CARD_LIVE}.png`, 30);
    put(`card-renders/${U1}/${CARD_LIVE}.thumb.webp`, 30);
    put(`card-renders/${U1}/${CARD_GONE}.png`, 30);
    put(`card-renders/${U1}/${CARD_GONE}.thumb.webp`, 30);
    put(`card-exports/${U1}/${CARD_GONE}-1700000000.png`, 200);
    put(`frames/ab/cdef.png`, 300);
    db.cards.rows.push(
      { id: CARD_LIVE, art_url: `${pub("card-art", `${U1}/used.jpg`)}?v=1`, back_face: { art_url: pub("card-art", `${U1}/second-face.jpg`) } },
    );
    db.profiles.rows.push({ id: U2, avatar_url: pub("profile-media", `${U2}/avatar-new.png`) });
    db.custom_pips.rows.push({ id: "p1", symbol: "W", image_url: `${pub("custom-pips", `${U2}/W.png`)}?v=5` });

    server = fakeSupabase(store, db, { onOpenApi: () => openApiHook?.() });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    writeFileSync(path.join(tmp, "env"), `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\nSUPABASE_SECRET_KEY=sb_secret_fake\n`);
    writeFileSync(path.join(tmp, "prod-env"), "NEXT_PUBLIC_SUPABASE_URL=https://zkwkisxoqdhdchqyjwdc.supabase.co\nSUPABASE_SECRET_KEY=x\n");
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses a --backup-dir inside the repository (it is public; the copies are users' images)", async () => {
    const inRepo = path.join(ROOT, "tmp-sweep-backup");
    try {
      const { code, out } = await run([...common(), "--apply", "--backup-dir", inRepo], "yes\n");
      expect(code).toBe(1);
      expect(out).toMatch(/--backup-dir: .*inside this repository/);
      expect(existsSync(inRepo)).toBe(false);
    } finally {
      rmSync(inRepo, { recursive: true, force: true }); // never leave copies in the checkout
    }
  });

  it("refuses production without the prompt, frames/card-exports, and an age under 7 days", async () => {
    expect((await run(["--env-file", path.join(tmp, "prod-env")])).out).toMatch(/points at PRODUCTION/);
    expect((await run(["--target", "prod"], "sb_secret_typed_into_a_pipe\n")).out).toMatch(/hidden prompt/);
    expect((await run([...common(), "--bucket", "frames"])).out).toMatch(/never swept/);
    expect((await run([...common(), "--bucket", "card-exports"])).out).toMatch(/never swept/);
    const young = await run([...common(), "--min-age-days", "3"]);
    expect(young.code).toBe(1);
    expect(young.out).toMatch(/never below 7/);
  });

  it("dry run: lists the orphans with totals, deletes nothing", async () => {
    const before = [...store.keys()].sort();
    const { code, out } = await run(common());
    expect(code).toBe(0);
    expect(out).toMatch(/dev 127\.0\.0\.1:\d+ — dry run/);
    expect(out).toMatch(/card-art\s+6 objects .*referenced 2 · under 7 d 1 · outside a user folder 1 · ORPHANS 2 \(/);
    expect(out).toMatch(/profile-media\s+2 objects .*referenced 1 · ORPHANS 1 \(/);
    expect(out).toMatch(/custom-pips\s+1 objects .*referenced 1 · ORPHANS 0 /);
    expect(out).toMatch(/card-renders\s+4 objects .*live card's bake 2 · ORPHANS 2 \(/);
    expect(out).toMatch(/card-exports\s+1 objects .*not swept/);
    expect(out).not.toMatch(/frames/);
    for (const k of [`card-art/${U1}/orphan.jpg`, `card-art/${U1}/appears-later.jpg`, `profile-media/${U2}/avatar-old.png`, `card-renders/${U1}/${CARD_GONE}.png`, `card-renders/${U1}/${CARD_GONE}.thumb.webp`]) {
      expect(out).toContain(k);
    }
    expect(out).toMatch(/Total: 5 orphan\(s\), [\d.]+ [KM]?B reclaimable\./);
    expect(out).toMatch(/Dry run: nothing deleted/);
    // For review, listed only: hand-picked names (every fixture here is one).
    expect(out).toMatch(/Review — \d+ user-folder object\(s\) with a name the server doesn't make today/);
    expect(out).toContain(`card-art/${U1}/draft.jpg`);
    expect([...store.keys()].sort()).toEqual(before);
  });

  it("--apply without typing yes deletes nothing", async () => {
    const before = store.size;
    const { code, out } = await run([...common(), "--apply"], "no\n");
    expect(code).toBe(1);
    expect(out).toMatch(/Aborted — nothing deleted/);
    expect(store.size).toBe(before);
  });

  it("--apply deletes the orphans only — re-checked per batch — and writes the manifest; the re-run finds none", async () => {
    // A row starts naming one orphan after the listing (the first scan is
    // request 1; the first batch's re-scan is request 2).
    let calls = 0;
    openApiHook = () => {
      calls += 1;
      if (calls === 2) db.decks.rows.push({ id: "d1", cover_url: pub("card-art", `${U1}/appears-later.jpg`) });
    };
    const backupDir = path.join(tmp, "backup");
    const { code, out } = await run([...common(), "--apply", "--batch-size", "2", "--backup-dir", backupDir], "yes\n");
    openApiHook = undefined;
    expect(code).toBe(0);
    // It says how many full database reads the run costs before "yes":
    // card-art 2 → 1 batch, profile-media 1 → 1, card-renders 2 → 1.
    expect(out).toMatch(/3 batch\(es\) of up to 2 → 3 full read\(s\) of every table/);
    expect(out).toMatch(/appears-later\.jpg: a row references it now — kept/);
    expect(out).toMatch(/Deleted 4 object\(s\)/);
    for (const gone of [`card-art/${U1}/orphan.jpg`, `profile-media/${U2}/avatar-old.png`, `card-renders/${U1}/${CARD_GONE}.png`, `card-renders/${U1}/${CARD_GONE}.thumb.webp`]) {
      expect(store.has(gone), gone).toBe(false);
    }
    for (const kept of [
      `card-art/${U1}/used.jpg`,
      `card-art/${U1}/draft.jpg`,
      `card-art/${U1}/second-face.jpg`,
      `card-art/${U1}/appears-later.jpg`,
      `card-art/loose.jpg`,
      `profile-media/${U2}/avatar-new.png`,
      `custom-pips/${U2}/W.png`,
      `card-renders/${U1}/${CARD_LIVE}.png`,
      `card-renders/${U1}/${CARD_LIVE}.thumb.webp`,
      `card-exports/${U1}/${CARD_GONE}-1700000000.png`,
      `frames/ab/cdef.png`,
    ]) {
      expect(store.has(kept), kept).toBe(true);
    }
    const manifest = readManifest(path.join(tmp, "manifest.jsonl"));
    expect(manifest.map((e: { bucket: string; path: string }) => `${e.bucket}/${e.path}`).sort()).toEqual(
      [`card-art/${U1}/orphan.jpg`, `profile-media/${U2}/avatar-old.png`, `card-renders/${U1}/${CARD_GONE}.png`, `card-renders/${U1}/${CARD_GONE}.thumb.webp`].sort(),
    );
    for (const e of manifest) {
      expect(e).toMatchObject({ target: expect.stringMatching(/^127\.0\.0\.1:\d+$/), size: expect.any(Number), etag: expect.stringMatching(/^".+"$/), lastChanged: expect.any(String) });
    }
    for (const e of manifest) {
      expect(readFileSync(path.join(backupDir, e.bucket, e.path), "utf8")).toBe(`bytes:${e.bucket}/${e.path}`);
    }
    expect(existsSync(path.join(backupDir, "card-art", U1, "appears-later.jpg"))).toBe(false);
    expect(loadState(path.join(tmp, "state.json"))).toMatchObject({ pending: null, deleted: 4 });

    const again = await run(common());
    expect(again.out).toMatch(/Total: 0 orphan\(s\)/);
  });
});

// --- incident 2026-09-29: storage ran out of database connections --------------------------

describe("scripts/sweep-storage-orphans.mjs against a Storage whose database pool takes 4 calls at once", () => {
  // Production, 2026-09-29: `--apply --batch-size 100` fired each batch's
  // lookups all at once; after 193 deletes storage answered "Too many
  // connections issued to the database" and the batch's confirms failed.
  // This fake refuses a storage request that arrives while 4 are in flight.
  let tmp = "";
  let server: Server;
  const store = new Map<string, StoredObject>();
  const pool = storagePool({ max: 4, delayMs: 15 });
  const orphanKeys = Array.from({ length: 40 }, (_, i) => `card-art/${U1}/o-${String(i).padStart(2, "0")}.jpg`);

  function run(args: string[], input = ""): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, HOME: tmp } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(input);
    });
  }
  const common = () => ["--env-file", path.join(tmp, "env"), "--state", path.join(tmp, "state.json"), "--manifest", path.join(tmp, "manifest.jsonl")];

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "sweep-pool-"));
    const t = new Date(Date.now() - 30 * DAY).toISOString();
    for (const key of orphanKeys) {
      const bytes = Buffer.from(`bytes:${key}`);
      store.set(key, { bytes, etag: `"${createHash("md5").update(bytes).digest("hex")}"`, created: t, updated: t });
    }
    server = fakeSupabase(store, emptyDb(), { storagePool: pool });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    writeFileSync(path.join(tmp, "env"), `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\nSUPABASE_SECRET_KEY=sb_secret_fake\n`);
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("--storage-concurrency is 1 to 8", async () => {
    for (const bad of ["0", "9", "x"]) {
      const { code, out } = await run([...common(), "--storage-concurrency", bad]);
      expect(code).toBe(1);
      expect(out).toMatch(/--storage-concurrency must be a whole number from 1 to 8/);
    }
  });

  it("--storage-concurrency 2: never more than 2 storage calls in flight", async () => {
    pool.peak = 0;
    pool.refused = 0;
    const { code, out } = await run([...common(), "--apply", "--batch-size", "100", "--storage-concurrency", "2", "--limit", "10"], "yes\n");
    expect(code).toBe(0);
    expect(out).toMatch(/Storage calls: at most 2 at a time/);
    expect(out).toMatch(/Deleted 10 object\(s\)/);
    expect(pool.refused).toBe(0);
    expect(pool.peak).toBeLessThanOrEqual(2);
  });

  it("--apply --batch-size 100 (the incident's run): every orphan deleted and confirmed, at most 4 calls in flight; a busy confirm is retried", async () => {
    pool.peak = 0;
    pool.refused = 0;
    // One confirm lookup (the object's second info request) is refused once,
    // whatever the load — what failed on 2026-09-29.
    const busyKey = `/storage/v1/object/info/${orphanKeys[25]}`;
    let seen = 0;
    pool.refuse = (method, p) => method === "GET" && p === busyKey && ++seen === 2;
    const backupDir = path.join(tmp, "backup");
    const { code, out } = await run([...common(), "--apply", "--batch-size", "100", "--backup-dir", backupDir], "yes\n");
    pool.refuse = undefined;
    expect(out).not.toMatch(/couldn't confirm|lookup failed|backup failed/);
    expect(out).toMatch(/--apply re-reads the whole database once per batch: 1 batch\(es\) of up to 100 → 1 full read\(s\) of every table\. Storage calls: at most 4 at a time/);
    expect(out).not.toMatch(/use --batch-size 100/);
    expect(out).toMatch(new RegExp(`storage busy on info ${orphanKeys[25]}: Too many connections issued to the database — try 2 of 4`));
    expect(out).toMatch(/Deleted 30 object\(s\)/);
    expect(code).toBe(0);
    expect(pool.refused).toBe(1); // the one refusal picked above, nothing else
    expect(pool.peak).toBeLessThanOrEqual(4);
    expect(pool.peak).toBeGreaterThan(1); // still in parallel, just capped
    expect(orphanKeys.filter((k) => store.has(k))).toEqual([]);
    const manifest = readManifest(path.join(tmp, "manifest.jsonl"));
    expect(manifest.map((e: { bucket: string; path: string }) => `${e.bucket}/${e.path}`).sort()).toEqual([...orphanKeys].sort());
    expect(loadState(path.join(tmp, "state.json"))).toMatchObject({ pending: null, deleted: 40 });
  });

  it("a DELETE storage refuses as busy is sent again only after every object is looked up again", async () => {
    const more = ["m-1", "m-2", "m-3"].map((n) => `card-art/${U1}/${n}.jpg`);
    store.clear(); // on its own, whatever the tests above left
    const t = new Date(Date.now() - 30 * DAY).toISOString();
    for (const key of more) {
      const bytes = Buffer.from(`bytes:${key}`);
      store.set(key, { bytes, etag: `"${createHash("md5").update(bytes).digest("hex")}"`, created: t, updated: t });
    }
    const seen: string[] = [];
    let deletes = 0;
    pool.refused = 0;
    pool.refuse = (method, p) => {
      if (p.startsWith("/storage/v1/object/")) seen.push(`${method} ${p.replace(`/${U1}/`, "/")}`);
      return method === "DELETE" && ++deletes === 1;
    };
    const { code, out } = await run([...common(), "--apply"], "yes\n");
    pool.refuse = undefined;
    expect(out).toMatch(/storage busy on remove of 3 object\(s\) in card-art: Too many connections issued to the database — each looked up again in \d\.\d s, then try 2 of 4/);
    expect(out).toMatch(/Deleted 3 object\(s\)/);
    expect(code).toBe(0);
    expect(pool.refused).toBe(1);
    expect(more.filter((k) => store.has(k))).toEqual([]);
    // Refused DELETE → the three lookups again → the DELETE again → the confirms.
    const afterRefusal = seen.slice(seen.indexOf("DELETE /storage/v1/object/card-art"));
    expect(afterRefusal.slice(0, 5).map((e) => e.replace(/m-\d/, "m-N"))).toEqual([
      "DELETE /storage/v1/object/card-art",
      "GET /storage/v1/object/info/card-art/m-N.jpg",
      "GET /storage/v1/object/info/card-art/m-N.jpg",
      "GET /storage/v1/object/info/card-art/m-N.jpg",
      "DELETE /storage/v1/object/card-art",
    ]);
  });
});
