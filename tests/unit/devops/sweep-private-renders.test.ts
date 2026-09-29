import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppEndpointError } from "@/scripts/lib/app-endpoint.mjs";
import {
  RENDER_POINTER_COLUMNS,
  applyPrivateRenders,
  cardState,
  planPrivateRenders,
  rendersByCard,
} from "@/scripts/lib/private-renders.mjs";
import { loadState, readManifest, reconcilePending } from "@/scripts/lib/storage-orphans.mjs";
import { emptyDb, fakeStorage, fakeSupabase, type Obj, type Row, type StoredObject } from "./helpers/fake-supabase";
import { fakeApp } from "./helpers/fake-app";

// ---------------------------------------------------------------------------
// TODO 3.14b, owner decision 2026-09-29 (c): `sweep-storage-orphans.mjs
// --private-renders` removes the card-renders PNG + thumb of cards whose row
// says PRIVATE, clears their render pointer the way going private does, and
// (owner answer 2026-09-29) purges the CDN copies of their /render-cdn URLs
// through the app — only a function on Vercel can — after storage confirmed
// each card's objects gone; a purge that fails is kept for the next run.
// Only on positive evidence (review 2026-09-29): a card missing from the
// answer — deleted, or left out of a short read — is never touched here (a
// deleted card's render is the orphan sweep's). The objects are looked up,
// then the visibility is read again, right before each delete; a public or
// unlisted card's render is never touched. First the helpers against
// in-memory fakes, then the real CLI against a fake Supabase.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/sweep-storage-orphans.mjs");
const DAY = 24 * 60 * 60 * 1000;

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const PRIVATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DELETED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PUBLIC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNLISTED = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FLIPS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRIVATE2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SECRET_TITLE = "The Secret Dragon of Nobody";
const RENDER_HOST = "https://auth.pipglyph.com/storage/v1/object/public/card-renders";

const render = (owner: string, card: string, kind: "png" | "thumb" = "png", size = 1000): Obj => {
  const t = new Date(Date.now() - 30 * DAY).toISOString();
  return {
    bucket: "card-renders",
    path: `${owner}/${card}.${kind === "png" ? "png" : "thumb.webp"}`,
    size,
    etag: `"etag-${card}-${kind}"`,
    createdAt: t,
    updatedAt: t,
    lastModified: t,
  };
};
const both = (owner: string, card: string) => [render(owner, card, "png"), render(owner, card, "thumb", 100)];

type Card = { id: string; visibility: string } & Partial<Record<(typeof RENDER_POINTER_COLUMNS)[number], string | null>>;

/** The two database calls the mode makes, over an in-memory `cards` table,
 *  with an event log shared with the storage fake (order checks) and hooks
 *  that change a card between calls. */
function cardsDb(cards: Card[], events: string[], hooks: { afterClear?: () => void; hidden?: Set<string> } = {}) {
  const rows = new Map(cards.map((c) => [c.id, c]));
  return {
    rows,
    async cardVisibility(ids: string[]) {
      events.push(`read ${ids.length}`);
      // `hidden`: rows that exist but the answer leaves out (a short read).
      return new Map(ids.filter((id) => rows.has(id) && !hooks.hidden?.has(id)).map((id) => [id, rows.get(id)!.visibility]));
    },
    async clearRenderPointers(ids: string[]) {
      events.push(`clear ${ids.length}`);
      const changed = ids.filter((id) => {
        const row = rows.get(id);
        if (!row || row.visibility !== "private") return false;
        if (!RENDER_POINTER_COLUMNS.some((c) => row[c] != null)) return false;
        for (const c of RENDER_POINTER_COLUMNS) row[c] = null;
        return true;
      });
      hooks.afterClear?.();
      return changed;
    },
  };
}

function trackedStorage(objects: Obj[], events: string[], opts: Parameters<typeof fakeStorage>[1] = {}) {
  const inner = fakeStorage(objects, opts);
  return {
    ...inner,
    store: inner.store,
    removes: inner.removes,
    async info(bucket: string, p: string) {
      events.push(`info ${p.split("/")[1]}`);
      return inner.info(bucket, p);
    },
    async remove(bucket: string, paths: string[]) {
      events.push(`remove ${paths.length}`);
      return inner.remove.call(inner, bucket, paths);
    },
  };
}

describe("which objects are a card's render, and what happens to them", () => {
  it("groups only {uuid}/{cardId}.png and .thumb.webp in card-renders", () => {
    const groups = rendersByCard([
      ...both(U1, PRIVATE),
      render(U2, PUBLIC),
      { ...render(U1, PRIVATE), bucket: "card-art" },
      { ...render(U1, PRIVATE), path: `${U1}/notes.png` },
      { ...render(U1, PRIVATE), path: `${U1}/${PRIVATE}.jpg` },
    ]);
    expect([...groups.keys()].sort()).toEqual([PRIVATE, PUBLIC]);
    expect(groups.get(PRIVATE)!.map((o: Obj) => o.path)).toEqual([`${U1}/${PRIVATE}.png`, `${U1}/${PRIVATE}.thumb.webp`]);
  });

  it("only a row that says private loses its render; public, unlisted, no row and anything else keep it", () => {
    expect(cardState("private")).toBe("private");
    expect(cardState(undefined)).toBe("deleted");
    expect(cardState("public")).toBe("visible");
    expect(cardState("unlisted")).toBe("visible");
    expect(cardState(null)).toBe("other");
    expect(cardState("draft")).toBe("other");
  });

  it("plans from ONE read of the cards' visibility", async () => {
    const events: string[] = [];
    const db = cardsDb(
      [
        { id: PRIVATE, visibility: "private" },
        { id: PUBLIC, visibility: "public" },
        { id: UNLISTED, visibility: "unlisted" },
      ],
      events,
    );
    const plan = await planPrivateRenders(db, [...both(U1, PRIVATE), ...both(U1, DELETED), ...both(U2, PUBLIC), render(U2, UNLISTED)]);
    expect(plan.map((c: { cardId: string; state: string; objects: Obj[]; bytes: number }) => [c.cardId, c.state, c.objects.length, c.bytes])).toEqual([
      [PRIVATE, "private", 2, 1100],
      [DELETED, "deleted", 2, 1100],
      [PUBLIC, "visible", 2, 1100],
      [UNLISTED, "visible", 1, 1000],
    ]);
    expect(events).toEqual(["read 4"]);
  });
});

describe("applyPrivateRenders", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "private-renders-"));
  });
  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  async function setup(cards: Card[], objects: Obj[], hooks: Parameters<typeof cardsDb>[2] = {}, storageOpts: Parameters<typeof fakeStorage>[1] = {}) {
    const events: string[] = [];
    const db = cardsDb(cards, events, hooks);
    const storage = trackedStorage(objects, events, storageOpts);
    /** The app endpoint's purge (scripts/lib/app-endpoint.mjs), in the same event log. */
    let purgeFails = false;
    const app = {
      url: "http://127.0.0.1:1/api/admin/storage-sweep",
      async purgeCards(ids: string[]) {
        events.push(`purge ${ids.join(",")}`);
        if (purgeFails) throw new AppEndpointError("HTTP 503 — purge refused");
        return { purged: ids.length, vercel: true };
      },
    };
    const statePath = path.join(tmp, "state.json");
    const manifestPath = path.join(tmp, "manifest.jsonl");
    const state = loadState(statePath);
    // The plan read is not part of the apply's event log.
    const plan = await planPrivateRenders(cardsDb(cards.map((c) => ({ ...c })), []), objects);
    const doomed = plan.filter((c: { state: string }) => c.state === "private");
    const run = (extra: Record<string, unknown> = {}) =>
      applyPrivateRenders({ db, storage, cards: doomed, app: app as never, state, statePath, manifestPath, target: "dev.example", run: "r1", ...extra });
    return { db, storage, events, statePath, manifestPath, state, plan, doomed, run, failPurges: (v: boolean) => (purgeFails = v) };
  }
  const withPointer = (id: string, visibility: string): Card => ({
    id,
    visibility,
    rendered_image_url: `${RENDER_HOST}/${U1}/${id}.png?v=1`,
    rendered_thumb_url: `${RENDER_HOST}/${U1}/${id}.thumb.webp?v=1`,
    rendered_at: "2026-09-01T00:00:00Z",
  });

  it("removes the PNG + thumb of private cards and clears their pointer; a public card and a card with no row are never touched", async () => {
    const pub = withPointer(PUBLIC, "public");
    const s = await setup([withPointer(PRIVATE, "private"), pub], [...both(U1, PRIVATE), ...both(U1, DELETED), ...both(U2, PUBLIC)]);
    expect(s.doomed.map((c: { cardId: string }) => c.cardId)).toEqual([PRIVATE]);
    const result = await s.run();
    expect(result).toMatchObject({ deleted: 2, bytes: 1100, pointersCleared: 1, failed: [] });
    // A deleted card's render is an orphan — the orphan sweep judges it, not this mode.
    expect([...s.storage.store.keys()].sort()).toEqual([
      `card-renders/${U1}/${DELETED}.png`,
      `card-renders/${U1}/${DELETED}.thumb.webp`,
      `card-renders/${U2}/${PUBLIC}.png`,
      `card-renders/${U2}/${PUBLIC}.thumb.webp`,
    ]);
    // The private row now looks like going private leaves it; the public row is as it was.
    expect(s.db.rows.get(PRIVATE)).toMatchObject({ rendered_image_url: null, rendered_thumb_url: null, rendered_at: null });
    expect(s.db.rows.get(PUBLIC)).toEqual(pub);
    const manifest = readManifest(s.manifestPath);
    expect(manifest[0]).toMatchObject({ table: "cards", cleared: ["rendered_image_url", "rendered_thumb_url", "rendered_at"], ids: [PRIVATE] });
    expect(manifest.slice(1, 3).map((e: { path: string; reason: string; card: string }) => [e.path, e.reason, e.card])).toEqual([
      [`${U1}/${PRIVATE}.png`, "render of a private card", PRIVATE],
      [`${U1}/${PRIVATE}.thumb.webp`, "render of a private card", PRIVATE],
    ]);
    // …then the CDN purge of that card, through the app.
    expect(manifest.slice(3)).toMatchObject([{ purged: [PRIVATE] }]);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 2, bytes: 1100, purgePending: [] });
  });

  it("a short visibility answer never deletes: a PUBLIC card left out of the read is not a deleted card here", async () => {
    // The row exists and is public, but the read leaves it out (a max-rows
    // cap, a key that RLS limits). Absence is never evidence for a delete.
    const events: string[] = [];
    const objects = [...both(U2, PUBLIC), ...both(U1, PRIVATE)];
    const shortDb = cardsDb([withPointer(PUBLIC, "public"), withPointer(PRIVATE, "private")], events, { hidden: new Set([PUBLIC]) });
    const plan = await planPrivateRenders(shortDb, objects);
    expect(plan.map((c: { cardId: string; state: string }) => [c.cardId, c.state])).toEqual([
      [PRIVATE, "private"],
      [PUBLIC, "deleted"],
    ]);
    const s = await setup([withPointer(PUBLIC, "public"), withPointer(PRIVATE, "private")], objects, { hidden: new Set([PUBLIC]) });
    const result = await s.run({ cards: plan.filter((c: { state: string }) => c.state === "private") });
    expect(result.deleted).toBe(2);
    expect(s.storage.store.has(`card-renders/${U2}/${PUBLIC}.png`)).toBe(true);
    expect(s.storage.store.has(`card-renders/${U2}/${PUBLIC}.thumb.webp`)).toBe(true);
    // …and the apply refuses a card without positive evidence outright.
    await expect(s.run({ cards: plan.filter((c: { state: string }) => c.state === "deleted") })).rejects.toThrow(/only a private card/);
  });

  it("a private card whose row is left out of the RE-read is kept (only a row that says private lets a render go)", async () => {
    const hidden = new Set<string>();
    const s = await setup([withPointer(PRIVATE, "private")], both(U1, PRIVATE), { afterClear: () => hidden.add(PRIVATE), hidden });
    const result = await s.run();
    expect(result.deleted).toBe(0);
    expect(s.storage.removes).toEqual([]);
    expect(result.skipped.map((k: { why: string }) => k.why)).toEqual([
      "its card has no row now — the orphan sweep's to judge",
      "its card has no row now — the orphan sweep's to judge",
    ]);
  });

  it("reads the visibility AGAIN right before the delete: a card made public since the plan is kept, pointer and all", async () => {
    const flips = withPointer(FLIPS, "private");
    const s = await setup([withPointer(PRIVATE, "private"), flips], [...both(U1, PRIVATE), ...both(U1, FLIPS)]);
    // The owner publishes FLIPS after the plan, before the apply.
    s.db.rows.get(FLIPS)!.visibility = "public";
    const result = await s.run();
    expect(result.deleted).toBe(2);
    expect(result.skipped.map((k: { path: string; why: string }) => [k.path, k.why])).toEqual([
      [`${U1}/${FLIPS}.png`, "its card is public now — never touched"],
      [`${U1}/${FLIPS}.thumb.webp`, "its card is public now — never touched"],
    ]);
    expect(s.storage.store.has(`card-renders/${U1}/${FLIPS}.png`)).toBe(true);
    // The conditional clear never touched a card that isn't private.
    expect(s.db.rows.get(FLIPS)!.rendered_image_url).toBe(flips.rendered_image_url);
    // Order within the batch: clear → lookups (the slow part) → re-read → remove,
    // so nothing slow sits between the re-read and the remove.
    expect(s.events).toEqual([
      "clear 2",
      `info ${PRIVATE}.png`,
      `info ${PRIVATE}.thumb.webp`,
      `info ${FLIPS}.png`,
      `info ${FLIPS}.thumb.webp`,
      "read 2",
      "remove 2",
      `info ${PRIVATE}.png`,
      `info ${PRIVATE}.thumb.webp`,
      // The CDN purge comes last — after storage confirmed the objects gone,
      // so a request in between can't refill the CDN from them — and only
      // for the card whose renders went.
      `purge ${PRIVATE}`,
    ]);
  });

  it("purges the CDN copies of each batch's cards whose renders are gone — noted in the state file before the remove, taken off once purged", async () => {
    const s = await setup(
      [PRIVATE, PRIVATE2].map((id) => withPointer(id, "private")),
      [...both(U1, PRIVATE), ...both(U1, PRIVATE2)],
    );
    let pendingAtRemove: string[] | undefined;
    const remove = s.storage.remove;
    s.storage.remove = async (bucket: string, paths: string[]) => {
      pendingAtRemove = loadState(s.statePath).purgePending;
      return remove(bucket, paths);
    };
    const result = await s.run({ batchSize: 1 });
    expect(result).toMatchObject({ deleted: 4, purged: 2, purgeFailed: false });
    expect(s.events.filter((e) => e.startsWith("purge"))).toEqual([`purge ${PRIVATE}`, `purge ${PRIVATE2}`]);
    expect(pendingAtRemove).toEqual([PRIVATE2]);
    expect(loadState(s.statePath).purgePending).toEqual([]);
    expect(readManifest(s.manifestPath).filter((e: { purged?: string[] }) => e.purged)).toMatchObject([
      { purged: [PRIVATE], cdn: "purged (tag card-<id>)" },
      { purged: [PRIVATE2], cdn: "purged (tag card-<id>)" },
    ]);
  });

  it("a failed purge keeps the renders going but leaves the cards pending (and stops asking the app this run)", async () => {
    const s = await setup(
      [PRIVATE, PRIVATE2].map((id) => withPointer(id, "private")),
      [...both(U1, PRIVATE), ...both(U1, PRIVATE2)],
    );
    s.failPurges(true);
    const result = await s.run({ batchSize: 1 });
    expect(result).toMatchObject({ deleted: 4, purged: 0, purgeFailed: true });
    expect(s.events.filter((e) => e.startsWith("purge"))).toEqual([`purge ${PRIVATE}`]);
    expect(loadState(s.statePath).purgePending).toEqual([PRIVATE, PRIVATE2]);
    expect(s.storage.store.size).toBe(0);
  });

  it("a card whose objects were already gone (nothing removed) is not purged", async () => {
    const s = await setup([withPointer(PRIVATE, "private")], both(U1, PRIVATE));
    s.storage.store.clear();
    const result = await s.run();
    expect(result).toMatchObject({ deleted: 0, purged: 0 });
    expect(s.events.filter((e) => e.startsWith("purge"))).toEqual([]);
  });

  it("a card published between the pointer clear and the re-read keeps its render (the re-read decides)", async () => {
    const s = await setup([withPointer(FLIPS, "private")], both(U1, FLIPS), {
      afterClear: () => {
        s.db.rows.get(FLIPS)!.visibility = "unlisted";
      },
    });
    const result = await s.run();
    expect(result.deleted).toBe(0);
    expect(s.storage.removes).toEqual([]);
    expect(result.skipped.map((k: { why: string }) => k.why)).toEqual([
      "its card is unlisted now — never touched",
      "its card is unlisted now — never touched",
    ]);
  });

  it("an object already gone is skipped; one with new bytes since the listing (a bake) is kept for the next run", async () => {
    const s = await setup([withPointer(PRIVATE, "private"), withPointer(PRIVATE2, "private")], [render(U1, PRIVATE), ...both(U1, PRIVATE2)]);
    s.storage.store.delete(`card-renders/${U1}/${PRIVATE}.png`);
    // PRIVATE2 was public for a moment after the listing and its bake landed.
    s.storage.store.get(`card-renders/${U1}/${PRIVATE2}.png`)!.etag = `"etag-rebaked"`;
    const result = await s.run();
    expect(result.deleted).toBe(1);
    expect(Object.fromEntries(result.skipped.map((k: { path: string; why: string }) => [k.path.split("/")[1], k.why]))).toEqual({
      [`${PRIVATE}.png`]: "already gone",
      [`${PRIVATE2}.png`]: "new bytes since the listing (a bake) — the next run judges it again",
    });
    expect(s.storage.store.has(`card-renders/${U1}/${PRIVATE2}.png`)).toBe(true);
    expect(s.storage.store.has(`card-renders/${U1}/${PRIVATE2}.thumb.webp`)).toBe(false);
  });

  it("refuses to act on a visible card or on an object that isn't that card's render", async () => {
    const s = await setup([], []);
    await expect(s.run({ cards: [{ cardId: PUBLIC, state: "visible", objects: both(U2, PUBLIC), bytes: 0 }] })).rejects.toThrow(/only a private card/);
    await expect(s.run({ cards: [{ cardId: DELETED, state: "deleted", objects: both(U1, DELETED), bytes: 0 }] })).rejects.toThrow(/only a private card/);
    await expect(s.run({ cards: [{ cardId: PRIVATE, state: "private", objects: [render(U1, DELETED)], bytes: 0 }] })).rejects.toThrow(/not a render of card/);
    await expect(
      s.run({ cards: [{ cardId: PRIVATE, state: "private", objects: [{ ...render(U1, PRIVATE), bucket: "card-art" }], bytes: 0 }] }),
    ).rejects.toThrow(/not a render of card/);
    expect(s.storage.removes).toEqual([]);
  });

  it("batches whole cards, stops at --limit (objects), and a re-run picks up the rest", async () => {
    const s = await setup(
      [PRIVATE, PRIVATE2, FLIPS].map((id) => withPointer(id, "private")),
      [...both(U1, PRIVATE), ...both(U1, PRIVATE2), ...both(U1, FLIPS)],
    );
    const first = await s.run({ limit: 3, batchSize: 1 });
    // Whole cards only: 2 + 2 would pass 3, so the second card waits.
    expect(first).toMatchObject({ deleted: 2, limitReached: true });
    expect(s.storage.removes).toHaveLength(1);
    const rest = await s.run({ batchSize: 1 });
    expect(rest.deleted).toBe(4);
    expect(s.storage.store.size).toBe(0);
  });

  it("a failed delete stays pending; the next run settles it into the manifest", async () => {
    const s = await setup([{ id: PRIVATE, visibility: "private" }], both(U1, PRIVATE), {}, { removeFails: true });
    const result = await s.run();
    expect(result.failed).toHaveLength(1);
    const state = loadState(s.statePath);
    expect(state.pending.items.map((i: { path: string }) => i.path)).toEqual([`${U1}/${PRIVATE}.png`, `${U1}/${PRIVATE}.thumb.webp`]);
    // The delete had in fact gone through for the PNG.
    s.storage.store.delete(`card-renders/${U1}/${PRIVATE}.png`);
    const settled = await reconcilePending({ storage: s.storage, state, statePath: s.statePath, manifestPath: s.manifestPath, target: "dev.example" });
    expect(settled).toEqual({ gone: 1, present: 1 });
    expect(readManifest(s.manifestPath)).toMatchObject([
      { bucket: "card-renders", path: `${U1}/${PRIVATE}.png`, reason: "render of a private card", note: "confirmed after an interrupted run" },
    ]);
  });

  it("an unconfirmed delete stays pending", async () => {
    const s = await setup([{ id: PRIVATE, visibility: "private" }], both(U1, PRIVATE), {}, { lookupFailsAfterRemove: [`${U1}/${PRIVATE}.thumb.webp`] });
    const result = await s.run();
    expect(result.deleted).toBe(1);
    expect(result.failed).toEqual([{ bucket: "card-renders", paths: [`${U1}/${PRIVATE}.thumb.webp`], error: "delete not confirmed" }]);
    expect(loadState(s.statePath).pending.items.map((i: { path: string }) => i.path)).toEqual([`${U1}/${PRIVATE}.thumb.webp`]);
  });

  // Incident 2026-09-29 (the orphan sweep's `--batch-size 100`): every lookup
  // of a batch went out at once and storage ran out of database connections.
  // A batch of 100 private cards is 200 lookups before the remove and 200
  // after it.
  it("a batch of 100 cards against a storage that refuses a 5th call at once: every render removed and confirmed, never more than 4 in flight", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`);
    const s = await setup(
      ids.map((id) => withPointer(id, "private")),
      ids.flatMap((id) => both(U1, id)),
      {},
      { maxConcurrent: 4 },
    );
    const result = await s.run({ batchSize: 100 });
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result).toMatchObject({ deleted: 200, purged: 100 });
    expect(s.storage.store.size).toBe(0);
    expect(s.storage.stats).toMatchObject({ peak: 4, refused: 0 });
    expect(loadState(s.statePath)).toMatchObject({ pending: null, purgePending: [] });
  });
});

// --- the CLI against a fake Supabase ------------------------------------------------------

describe("sweep-storage-orphans.mjs --private-renders against a fake Supabase", () => {
  let tmp = "";
  let server: Server;
  let supabaseHost = "";
  let appHost = () => supabaseHost;
  let purgeStatus = 200;
  const app = fakeApp({ secret: "cron-test-secret", supabaseHost: () => appHost(), purgeStatus: () => purgeStatus });
  let appUrl = "";
  const store = new Map<string, StoredObject>();
  const db = emptyDb();
  const rest: string[] = [];
  let onPatch: (() => void) | undefined;
  let maxRows = Infinity;
  const put = (key: string) => {
    const t = new Date(Date.now() - 30 * DAY).toISOString();
    const bytes = Buffer.from(`bytes:${key}`);
    store.set(key, { bytes, etag: `"${createHash("md5").update(bytes).digest("hex")}"`, created: t, updated: t });
  };
  const pointer = (owner: string, id: string) => ({
    rendered_image_url: `${RENDER_HOST}/${owner}/${id}.png?v=1`,
    rendered_thumb_url: `${RENDER_HOST}/${owner}/${id}.thumb.webp?v=1`,
    rendered_at: "2026-09-01T00:00:00Z",
  });

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
  const common = () => [
    "--private-renders",
    "--env-file",
    path.join(tmp, "env"),
    "--state",
    path.join(tmp, "state.json"),
    "--manifest",
    path.join(tmp, "manifest.jsonl"),
    "--app-url",
    appUrl,
  ];
  const appOps = () => app.calls.map((c) => c.op);

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "private-renders-cli-"));
    Object.assign(db.cards.columns, { visibility: "text", rendered_at: "timestamp with time zone" });
    const rows: Row[] = [
      { id: PRIVATE, owner_id: U1, title: SECRET_TITLE, visibility: "private", ...pointer(U1, PRIVATE) },
      { id: PUBLIC, owner_id: U2, title: "A Public Card", visibility: "public", ...pointer(U2, PUBLIC) },
      { id: UNLISTED, owner_id: U2, title: "An Unlisted Card", visibility: "unlisted", ...pointer(U2, UNLISTED) },
      { id: FLIPS, owner_id: U1, title: "Soon Public", visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_at: null },
    ];
    db.cards.rows.push(...rows);
    for (const [owner, id] of [
      [U1, PRIVATE],
      [U1, DELETED],
      [U2, PUBLIC],
      [U2, UNLISTED],
      [U1, FLIPS],
    ]) {
      put(`card-renders/${owner}/${id}.png`);
      put(`card-renders/${owner}/${id}.thumb.webp`);
    }
    put(`card-renders/${U1}/stray-upload.png`); // not a render name — not this mode's business
    put(`card-art/${U1}/${PRIVATE}.png`); // another bucket — never read by this mode

    server = fakeSupabase(store, db, {
      maxRows: () => maxRows,
      onRest: (method, table, params) => {
        rest.push(`${method} ${table} ${[...params.keys()].join(",")}`);
        // Before the fake applies it: a change here lands "just before" the write.
        if (method === "PATCH") onPatch?.();
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    supabaseHost = `127.0.0.1:${port}`;
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
    writeFileSync(
      path.join(tmp, "env"),
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\nSUPABASE_SECRET_KEY=sb_secret_fake\nCRON_SECRET=cron-test-secret\n`,
    );
    writeFileSync(
      path.join(tmp, "env-wrong-secret"),
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${port}\nSUPABASE_SECRET_KEY=sb_secret_fake\nCRON_SECRET=not-the-secret\n`,
    );
    writeFileSync(path.join(tmp, "prod-env"), "NEXT_PUBLIC_SUPABASE_URL=https://zkwkisxoqdhdchqyjwdc.supabase.co\nSUPABASE_SECRET_KEY=x\n");
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await new Promise((resolve) => app.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses production through the dev path, a production run without a terminal, and flags that don't apply", async () => {
    expect((await run(["--private-renders", "--env-file", path.join(tmp, "prod-env")])).out).toMatch(/points at PRODUCTION/);
    const prod = await run(["--private-renders", "--target", "prod"], "sb_secret_typed_into_a_pipe\n");
    expect(prod.code).toBe(1);
    expect(prod.out).toMatch(/hidden prompt/);
    expect(prod.out).not.toContain("sb_secret_typed_into_a_pipe");
    for (const [flags, message] of [
      [["--backup-dir", path.join(os.tmpdir(), "x")], /--backup-dir doesn't apply to --private-renders/],
      [["--bucket", "card-art"], /--bucket doesn't apply to --private-renders/],
      [["--min-age-days", "30"], /--min-age-days doesn't apply to --private-renders/],
      [["--per-minute", "10"], /--per-minute doesn't apply to --private-renders/],
      [["--rescan-review"], /separate runs/],
      [["--app-url", "http://app.example.test"], /--app-url: https only \(http is allowed for localhost\)/],
      [["--app-url", "https://app.example.test/api"], /--app-url: the site's origin only/],
    ] as const) {
      const r = await run([...common(), ...flags]);
      expect(r.code, flags.join(" ")).toBe(1);
      expect(r.out).toMatch(message);
    }
    // Production's app is fixed; the orphan sweep never acts through one.
    const prodApp = await run(["--private-renders", "--target", "prod", "--app-url", appUrl]);
    expect(prodApp.out).toMatch(/--app-url is for the dev target; production's app is https:\/\/www\.pipglyph\.com/);
    const orphans = await run(["--env-file", path.join(tmp, "env"), "--app-url", appUrl]);
    expect(orphans.out).toMatch(/--app-url doesn't apply: only --rescan-review and --private-renders act through the app/);
    expect(rest).toEqual([]);
    expect(app.calls).toEqual([]);
  });

  it("dry run: card ids and counts only — no titles, no owners — and nothing changes", async () => {
    const before = [...store.keys()].sort();
    const { code, out } = await run(common());
    expect(code).toBe(0);
    expect(out).toMatch(/--private-renders dry run/);
    expect(out).toMatch(/card-renders: 11 objects .* 10 render\(s\) of 5 card\(s\), 1 with another name/);
    expect(out).toMatch(/public\/unlisted cards: 2 \(4 objects\) — never touched/);
    expect(out).toMatch(/cards with no row: 1 \(2 objects\) — never touched here/);
    expect(out).toMatch(/Renders to remove: 4 object\(s\) .* of 2 private card\(s\)\./);
    expect(out).toMatch(new RegExp(`${PRIVATE}\\s+2 object\\(s\\)`));
    expect(out).toMatch(new RegExp(`${FLIPS}\\s+2 object\\(s\\)`));
    expect(out).not.toContain(DELETED);
    expect(out).not.toContain(PUBLIC);
    expect(out).not.toContain(SECRET_TITLE);
    expect(out).not.toContain(U1);
    expect(out).not.toContain(U2);
    expect(out).toMatch(/Dry run: nothing deleted, no row changed, nothing purged/);
    expect([...store.keys()].sort()).toEqual(before);
    expect(rest.filter((r) => r.startsWith("PATCH"))).toEqual([]);
    expect(app.calls).toEqual([]); // a dry run never needs the app
  });

  it("--apply asks the app which database it talks to BEFORE yes: another database, a refused secret or no --app-url stop the run", async () => {
    const before = [...store.keys()].sort();
    appHost = () => "znipzaxgpaiandwiqabn.supabase.co";
    const other = await run([...common(), "--apply"], "yes\n");
    appHost = () => supabaseHost;
    expect(other.code).toBe(1);
    expect(other.out).toMatch(/talks to database znipzaxgpaiandwiqabn\.supabase\.co, not 127\.0\.0\.1:\d+ — nothing is done through it/);
    expect(other.out).toMatch(/nothing deleted, nothing purged/);
    expect(other.out).not.toMatch(/Type "yes"/);

    const refused = await run([...common().map((a) => (a.endsWith("/env") ? path.join(tmp, "env-wrong-secret") : a)), "--apply"], "yes\n");
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/refused the CRON_SECRET \(HTTP 401\)/);
    expect(refused.out).not.toContain("not-the-secret");

    const noUrl = await run([...common().slice(0, -2), "--apply"], "yes\n");
    expect(noUrl.code).toBe(1);
    expect(noUrl.out).toMatch(/pass --app-url/);

    expect([...store.keys()].sort()).toEqual(before);
    expect(rest.filter((r) => r.startsWith("PATCH"))).toEqual([]);
    expect(appOps()).toEqual(["whoami", "whoami"]);
    app.calls.length = 0;
  });

  it("--apply without typing yes changes nothing", async () => {
    const before = store.size;
    const { code, out } = await run([...common(), "--apply"], "no\n");
    expect(code).toBe(1);
    expect(out).toMatch(/Aborted — nothing deleted/);
    expect(out).toMatch(/purge their CDN copies through http:\/\/127\.0\.0\.1:\d+\/api\/admin\/storage-sweep\?/);
    expect(store.size).toBe(before);
    expect(rest.filter((r) => r.startsWith("PATCH"))).toEqual([]);
    expect(appOps()).toEqual(["whoami"]);
    app.calls.length = 0;
  });

  it("a visibility answer cut short (server max-rows below the chunk) stops the run before anything is planned or deleted", async () => {
    maxRows = 1;
    const before = [...store.keys()].sort();
    const dry = await run(common());
    const apply = await run([...common(), "--apply"], "yes\n");
    maxRows = Infinity;
    for (const r of [dry, apply]) {
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/read cards: the answer was cut short \(1 of 4 rows\)/);
      expect(r.out).not.toMatch(/Renders to remove/);
    }
    expect([...store.keys()].sort()).toEqual(before);
    expect(rest.filter((r) => r.startsWith("PATCH"))).toEqual([]);
  });

  it("--apply: private renders go and their pointer is cleared; a card published mid-run, every public card and a deleted card's render are untouched", async () => {
    // The owner publishes FLIPS (and its bake lands) after the run read the
    // plan, just before the batch's pointer clear reaches the database: the
    // conditional clear must skip it (it isn't private any more) and the
    // re-read must keep its render.
    onPatch = () => {
      Object.assign(db.cards.rows.find((r) => r.id === FLIPS)!, { visibility: "public", ...pointer(U1, FLIPS) });
    };
    const { code, out } = await run([...common(), "--apply"], "yes\n");
    onPatch = undefined;
    expect(code).toBe(0);
    expect(out).toMatch(/Deleted 2 render object\(s\).*cleared 1 private card pointer\(s\); purged the CDN copies of 1 card\(s\); kept 2 on re-check/);
    expect(out).toMatch(new RegExp(`${FLIPS}\\.png: its card is public now — never touched — kept`));
    for (const gone of [`card-renders/${U1}/${PRIVATE}.png`, `card-renders/${U1}/${PRIVATE}.thumb.webp`]) {
      expect(store.has(gone), gone).toBe(false);
    }
    for (const kept of [
      `card-renders/${U2}/${PUBLIC}.png`,
      `card-renders/${U2}/${PUBLIC}.thumb.webp`,
      `card-renders/${U2}/${UNLISTED}.png`,
      `card-renders/${U2}/${UNLISTED}.thumb.webp`,
      `card-renders/${U1}/${FLIPS}.png`,
      `card-renders/${U1}/${FLIPS}.thumb.webp`,
      // A deleted card's render: an orphan, the orphan sweep's to judge.
      `card-renders/${U1}/${DELETED}.png`,
      `card-renders/${U1}/${DELETED}.thumb.webp`,
      `card-renders/${U1}/stray-upload.png`,
      `card-art/${U1}/${PRIVATE}.png`,
    ]) {
      expect(store.has(kept), kept).toBe(true);
    }
    const row = (id: string) => db.cards.rows.find((r) => r.id === id)!;
    expect(row(PRIVATE)).toMatchObject({ visibility: "private", rendered_image_url: null, rendered_thumb_url: null, rendered_at: null });
    expect(row(PUBLIC)).toMatchObject(pointer(U2, PUBLIC));
    expect(row(UNLISTED)).toMatchObject(pointer(U2, UNLISTED));
    expect(row(FLIPS)).toMatchObject({ visibility: "public", ...pointer(U1, FLIPS) });
    // The one write: a conditional UPDATE — private rows with a pointer only.
    const patches = rest.filter((r) => r.startsWith("PATCH"));
    expect(patches).toEqual(["PATCH cards id,visibility,or,select"]);
    const manifest = readManifest(path.join(tmp, "manifest.jsonl"));
    expect(manifest.filter((e: { table?: string }) => e.table === "cards")).toMatchObject([{ ids: [PRIVATE] }]);
    expect(manifest.filter((e: { path?: string }) => e.path).map((e: { path: string }) => e.path).sort()).toEqual(
      [`${U1}/${PRIVATE}.png`, `${U1}/${PRIVATE}.thumb.webp`].sort(),
    );
    expect(loadState(path.join(tmp, "state.json"))).toMatchObject({ pending: null, deleted: 2, purgePending: [] });
    // The CDN copies of the one card whose renders went, purged through the
    // app with the env file's secret — never FLIPS, PUBLIC or DELETED.
    expect(app.calls.map((c) => [c.op, c.body.cardIds ?? null])).toEqual([
      ["whoami", null],
      ["purge-cards", [PRIVATE]],
    ]);
    expect(app.calls.every((c) => c.auth === "Bearer cron-test-secret")).toBe(true);
    expect(out).toMatch(/purged the caches of 1 card\(s\)/);
    expect(out).not.toContain("cron-test-secret");
    expect(manifest.filter((e: { purged?: string[] }) => e.purged)).toMatchObject([{ purged: [PRIVATE] }]);
    app.calls.length = 0;

    const again = await run(common());
    expect(again.out).toMatch(/Renders to remove: 0 object\(s\)/);
  });

  it("a purge the app refuses: the renders still go, the run exits 1, and the next --apply purges them first", async () => {
    db.cards.rows.push({ id: PRIVATE2, owner_id: U1, title: "Another Secret", visibility: "private", ...pointer(U1, PRIVATE2) });
    put(`card-renders/${U1}/${PRIVATE2}.png`);
    put(`card-renders/${U1}/${PRIVATE2}.thumb.webp`);
    purgeStatus = 503;
    const failed = await run([...common(), "--apply"], "yes\n");
    purgeStatus = 200;
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/CDN purge of 1 card\(s\) failed \(.*HTTP 503 — purge refused\)/);
    expect(failed.out).toMatch(/1 card\(s\) still need their CDN copies purged/);
    expect(store.has(`card-renders/${U1}/${PRIVATE2}.png`)).toBe(false);
    expect(loadState(path.join(tmp, "state.json")).purgePending).toEqual([PRIVATE2]);

    // A dry run says so and purges nothing…
    app.calls.length = 0;
    expect((await run(common())).out).toMatch(/1 card\(s\) from an earlier run still need their CDN copies purged/);
    expect(app.calls).toEqual([]);
    // …the next --apply purges them before anything else (nothing left to remove: no "yes" needed).
    const retry = await run([...common(), "--apply"]);
    expect(retry.code).toBe(0);
    expect(app.calls.map((c) => [c.op, c.body.cardIds ?? null])).toEqual([
      ["whoami", null],
      ["purge-cards", [PRIVATE2]],
    ]);
    expect(loadState(path.join(tmp, "state.json")).purgePending).toEqual([]);
  });
});
