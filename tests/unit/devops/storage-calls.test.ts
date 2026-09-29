import { StorageApiError, createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_CONCURRENCY,
  LIST_PAGE_SIZE,
  MAX_STORAGE_CONCURRENCY,
  STORAGE_ATTEMPTS,
  backoffMs,
  createLimiter,
  isRetryableStorageError,
  limitStorage,
  listObjects,
  storageCallError,
} from "@/scripts/lib/storage-calls.mjs";
import { fakeStorage, tooManyConnections, type Obj } from "./helpers/fake-supabase";

// ---------------------------------------------------------------------------
// Incident 2026-09-29: production's first `sweep-storage-orphans.mjs --apply
// --batch-size 100` deleted 193 objects, then a batch failed — 7 objects
// "couldn't confirm the delete (Too many connections issued to the
// database)": each batch fired every storage lookup at once and Supabase
// Storage ran out of database connections. scripts/lib/storage-calls.mjs
// puts every storage call of the owner-run storage scripts through ONE
// small limiter (default 4, max 8) and retries a busy storage with backoff.
// ---------------------------------------------------------------------------

const U1 = "11111111-1111-4111-8111-111111111111";
const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const obj = (i: number): Obj => ({
  bucket: "card-art",
  path: `${U1}/${i}.jpg`,
  size: 1000,
  etag: `"etag-${i}"`,
  createdAt: old,
  updatedAt: old,
  lastModified: old,
});

/** A sleep that doesn't: records each wait. */
const recordingSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe("createLimiter", () => {
  it("never runs more than its slots at once, and runs the rest in order", async () => {
    const limiter = createLimiter(3);
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          order.push(i);
          await new Promise((resolve) => setImmediate(resolve));
          inFlight -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(limiter.peak).toBe(3);
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(limiter.active).toBe(0);
  });

  it("hands a finished call's slot to the next waiter — a call made in between can't squeeze past the cap", async () => {
    const limiter = createLimiter(1);
    let inFlight = 0;
    let peak = 0;
    const work = () =>
      limiter.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setImmediate(resolve));
        inFlight -= 1;
      });
    const first = work();
    const second = work(); // waits
    // A third call made right as the first finishes (same tick as the hand-over).
    const third = first.then(() => work());
    await Promise.all([first, second, third]);
    expect(peak).toBe(1);
  });

  it("frees the slot when a call throws", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(async () => "next")).toBe("next");
  });

  it("refuses a cap that isn't a whole number ≥ 1", () => {
    expect(() => createLimiter(0)).toThrow();
    expect(() => createLimiter(1.5)).toThrow();
  });
});

describe("isRetryableStorageError — busy or no answer, never a 4xx about the object", () => {
  it("retries what storage says when it is overloaded, whatever the status", () => {
    expect(isRetryableStorageError(tooManyConnections())).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("Too many connections issued to the database"), { status: 544 }))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("anything"), { status: 544 }))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("Bad gateway"), { status: 502 }))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("Service unavailable"), { status: 503 }))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("slow down"), { status: 429 }))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("Request timeout"), { status: 408 }))).toBe(true);
    expect(isRetryableStorageError(new Error("Knex: Timeout acquiring a connection. The pool is probably full."))).toBe(true);
    expect(isRetryableStorageError(Object.assign(new Error("fetch failed"), { network: true }))).toBe(true);
  });

  it("fails at once on a 4xx about the object or the request", () => {
    expect(isRetryableStorageError(Object.assign(new Error("Object not found"), { status: 400, code: "404" }))).toBe(false);
    expect(isRetryableStorageError(Object.assign(new Error("Object not found"), { status: 404 }))).toBe(false);
    expect(isRetryableStorageError(Object.assign(new Error("invalid signature"), { status: 403 }))).toBe(false);
    expect(isRetryableStorageError(new Error("its bytes changed since it was listed"))).toBe(false);
    expect(isRetryableStorageError(null)).toBe(false);
  });
});

describe("storageCallError — a storage-js error, with what the retry needs", () => {
  it("keeps the HTTP status, storage's own code and the message", () => {
    const err = storageCallError(new StorageApiError("Too many connections issued to the database", 544, "DatabaseTimeout"), "list card-art/x: ");
    expect(err.message).toBe("list card-art/x: Too many connections issued to the database");
    expect(err).toMatchObject({ status: 544, code: "DatabaseTimeout" });
    expect(isRetryableStorageError(err)).toBe(true);
    const missing = storageCallError(new StorageApiError("Object not found", 400, "404"));
    expect(missing).toMatchObject({ status: 400, code: "404" });
    expect(isRetryableStorageError(missing)).toBe(false);
  });

  it("marks no HTTP answer at all (storage-js's StorageUnknownError: a refused or reset connection) as retryable", async () => {
    // A real storage-js call to a port nothing listens on.
    const client = createClient("http://127.0.0.1:1", "sb_secret_fake", { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.storage.from("card-art").info(`${U1}/1.jpg`);
    expect(error?.name).toBe("StorageUnknownError");
    const err = storageCallError(error);
    expect(err.network).toBe(true);
    expect(err.status).toBeUndefined();
    expect(isRetryableStorageError(err)).toBe(true);
  });
});

describe("backoffMs", () => {
  it("doubles from 1 s with ±25 % jitter, capped", () => {
    expect([1, 2, 3].map((a) => backoffMs(a, () => 0.5))).toEqual([1000, 2000, 4000]);
    expect(backoffMs(1, () => 0)).toBe(750);
    expect(backoffMs(1, () => 0.9999)).toBeLessThanOrEqual(1250);
    expect(backoffMs(20, () => 0.5)).toBe(15_000);
  });
});

describe("limitStorage", () => {
  it("defaults to 4 in flight, at most 8", () => {
    expect(DEFAULT_STORAGE_CONCURRENCY).toBe(4);
    expect(MAX_STORAGE_CONCURRENCY).toBe(8);
    const storage = fakeStorage([]);
    expect(limitStorage(storage).concurrency).toBe(4);
    expect(() => limitStorage(storage, { concurrency: 0 })).toThrow(/1 to 8/);
    expect(() => limitStorage(storage, { concurrency: 9 })).toThrow(/1 to 8/);
  });

  it("100 lookups at once against a storage that refuses a 5th: all answered, never more than 4 in flight", async () => {
    const objects = Array.from({ length: 100 }, (_, i) => obj(i));
    const raw = fakeStorage(objects, { maxConcurrent: 4 });
    // What the sweep did before: every lookup at once — refused.
    const unlimited = await Promise.allSettled(objects.map((o) => raw.info(o.bucket, o.path)));
    expect(unlimited.filter((r) => r.status === "rejected").length).toBeGreaterThan(90);

    raw.stats.peak = 0;
    raw.stats.refused = 0;
    const storage = limitStorage(raw);
    const answers = await Promise.all(objects.map((o) => storage.info(o.bucket, o.path)));
    expect(answers.every((a: { etag?: string }) => typeof a.etag === "string")).toBe(true);
    expect(raw.stats).toMatchObject({ peak: 4, refused: 0 });
  });

  it("--storage-concurrency 2 means 2", async () => {
    const objects = Array.from({ length: 20 }, (_, i) => obj(i));
    const raw = fakeStorage(objects, { maxConcurrent: 8 });
    const storage = limitStorage(raw, { concurrency: 2 });
    await Promise.all(objects.map((o) => storage.info(o.bucket, o.path)));
    expect(raw.stats.peak).toBe(2);
  });

  it("retries a busy storage with backoff, logging each retry, and answers once it can", async () => {
    const raw = fakeStorage([obj(1)], { busyInfo: { [`${U1}/1.jpg`]: 2 } });
    const { waits, sleep } = recordingSleep();
    const lines: string[] = [];
    const storage = limitStorage(raw, { sleep, random: () => 0.5, log: (l: string) => lines.push(l) });
    expect(await storage.info("card-art", `${U1}/1.jpg`)).toMatchObject({ etag: '"etag-1"' });
    expect(waits).toEqual([1000, 2000]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`storage busy on info card-art/${U1}/1.jpg: Too many connections issued to the database — try 2 of ${STORAGE_ATTEMPTS} in 1.0 s`);
  });

  it(`gives up after ${STORAGE_ATTEMPTS} tries with storage's own error`, async () => {
    const raw = fakeStorage([obj(1)], { busyInfo: { [`${U1}/1.jpg`]: 99 } });
    const { waits, sleep } = recordingSleep();
    const storage = limitStorage(raw, { sleep });
    await expect(storage.info("card-art", `${U1}/1.jpg`)).rejects.toThrow("Too many connections issued to the database");
    expect(waits).toHaveLength(STORAGE_ATTEMPTS - 1);
  });

  it("does not retry an error that isn't about load", async () => {
    const { waits, sleep } = recordingSleep();
    const raw = fakeStorage([obj(1)], { downloadFails: `${U1}/1.jpg` });
    const storage = limitStorage(raw, { sleep });
    await expect(storage.download("card-art", `${U1}/1.jpg`)).rejects.toThrow("download failed");
    expect(waits).toEqual([]);
  });

  it("a retry keeps its slot while it waits — a busy storage gets fewer calls from us, not the same number", async () => {
    const raw = fakeStorage([obj(1), obj(2)], { busyInfo: { [`${U1}/1.jpg`]: 1 } });
    const events: string[] = [];
    let release: () => void = () => {};
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        events.push(`wait ${ms}`);
        release = resolve;
      });
    const storage = limitStorage(raw, { concurrency: 1, sleep, random: () => 0.5 });
    const first = storage.info("card-art", `${U1}/1.jpg`).then(() => events.push("1 answered"));
    const second = storage.info("card-art", `${U1}/2.jpg`).then(() => events.push("2 answered"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events).toEqual(["wait 1000"]); // the second call has not started
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["wait 1000", "1 answered", "2 answered"]);
  });

  it("wraps once: an already limited storage is returned as it is (one limiter per run)", () => {
    const limited = limitStorage(fakeStorage([]), { concurrency: 2 });
    expect(limitStorage(limited)).toBe(limited);
    expect(limitStorage(limited).concurrency).toBe(2);
  });

  it("looks each method up when it is called (a test may swap one in)", async () => {
    const raw = fakeStorage([obj(1)]);
    const storage = limitStorage(raw);
    raw.remove = async () => ["swapped"];
    expect(await storage.remove("card-art", [`${U1}/1.jpg`])).toEqual(["swapped"]);
  });

  // Skeptic review 2026-09-29: storage has no conditional delete — a remove
  // re-sent after a backoff must not lean on the re-check made before it,
  // nor delete again what landed at a name after a first try that went
  // through (its answer lost).
  it("remove is one try: a busy remove is never sent again on its own", async () => {
    const raw = fakeStorage([obj(1)], { busyRemove: 1 });
    const { waits, sleep } = recordingSleep();
    const storage = limitStorage(raw, { sleep });
    await expect(storage.remove("card-art", [`${U1}/1.jpg`])).rejects.toThrow("Too many connections");
    expect(raw.removes).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("removeRechecked: a busy remove is sent again after the backoff, only for what the re-check clears", async () => {
    const raw = fakeStorage([obj(1), obj(2), obj(3)], { busyRemove: 1 });
    const events: string[] = [];
    const storage = limitStorage(raw, { sleep: async (ms: number) => void events.push(`wait ${ms}`), random: () => 0.5 });
    const echoed = await storage.removeRechecked("card-art", [`${U1}/1.jpg`, `${U1}/2.jpg`, `${U1}/3.jpg`], async (paths: string[]) => {
      events.push(`recheck ${paths.length}`);
      // 2.jpg changed meanwhile; the re-check also names a path never asked for.
      return [...paths.filter((p) => !p.endsWith("/2.jpg")), `${U1}/9.jpg`];
    });
    expect(events).toEqual(["wait 1000", "recheck 3"]);
    expect(raw.removes).toEqual([
      [`card-art/${U1}/1.jpg`, `card-art/${U1}/2.jpg`, `card-art/${U1}/3.jpg`],
      [`card-art/${U1}/1.jpg`, `card-art/${U1}/3.jpg`],
    ]);
    expect(echoed).toEqual([`${U1}/1.jpg`, `${U1}/3.jpg`]);
    expect(raw.store.has(`card-art/${U1}/2.jpg`)).toBe(true);
  });

  it("removeRechecked: nothing left after the re-check → no second remove", async () => {
    const raw = fakeStorage([obj(1)], { busyRemoveAfterDelete: 1 });
    const storage = limitStorage(raw, { sleep: async () => {} });
    const echoed = await storage.removeRechecked("card-art", [`${U1}/1.jpg`], async (paths: string[]) => {
      const answers = await Promise.all(paths.map((p) => storage.info("card-art", p)));
      return paths.filter((_, i) => !(answers[i] as { missing?: boolean }).missing);
    });
    expect(echoed).toEqual([]);
    expect(raw.removes).toHaveLength(1);
  });

  it("removeRechecked: waits and re-checks holding no slot — a limiter of 1 still runs the re-check's lookups", async () => {
    const raw = fakeStorage([obj(1)], { busyRemove: 1, maxConcurrent: 1 });
    const storage = limitStorage(raw, { concurrency: 1, sleep: async () => {} });
    const echoed = await storage.removeRechecked("card-art", [`${U1}/1.jpg`], async (paths: string[]) => {
      await storage.info("card-art", paths[0]);
      return paths;
    });
    expect(echoed).toEqual([`${U1}/1.jpg`]);
    expect(raw.stats).toMatchObject({ peak: 1, refused: 0 });
  });

  it(`removeRechecked: gives up after ${STORAGE_ATTEMPTS} tries; an error that isn't about load fails at once, with no re-check`, async () => {
    const busy = fakeStorage([obj(1)], { busyRemove: 99 });
    let rechecks = 0;
    const recheck = async (paths: string[]) => {
      rechecks += 1;
      return paths;
    };
    await expect(limitStorage(busy, { sleep: async () => {} }).removeRechecked("card-art", [`${U1}/1.jpg`], recheck)).rejects.toThrow("Too many connections");
    expect(busy.removes).toHaveLength(STORAGE_ATTEMPTS);
    expect(rechecks).toBe(STORAGE_ATTEMPTS - 1);

    rechecks = 0;
    const refused = fakeStorage([obj(1)], { removeFails: true });
    await expect(limitStorage(refused, { sleep: async () => {} }).removeRechecked("card-art", [`${U1}/1.jpg`], recheck)).rejects.toThrow("gateway timeout");
    expect(refused.removes).toHaveLength(1);
    expect(rechecks).toBe(0);
  });

  it("removeRechecked refuses to run without a re-check", async () => {
    const storage = limitStorage(fakeStorage([obj(1)]));
    await expect(storage.removeRechecked("card-art", [`${U1}/1.jpg`])).rejects.toThrow(/re-check/);
  });

  it("a listing given whole (an in-memory fake) is limited step by step too", async () => {
    let inFlight = 0;
    let peak = 0;
    const raw = {
      ...fakeStorage([]),
      async *list() {
        for (let i = 0; i < 3; i += 1) {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setImmediate(resolve));
          inFlight -= 1;
          yield obj(i);
        }
      },
    };
    const storage = limitStorage(raw, { concurrency: 1 });
    const seen: string[] = [];
    // Two listings at once: never more than one step in flight.
    await Promise.all([
      (async () => {
        for await (const o of storage.list("card-art")) seen.push(o.path);
      })(),
      (async () => {
        for await (const o of storage.list("card-art")) seen.push(o.path);
      })(),
    ]);
    expect(seen).toHaveLength(6);
    expect(peak).toBe(1);
    expect(storage.limiter.peak).toBe(1);
  });

  it("lists page by page through the limiter — every page retried when storage is busy", async () => {
    const entry = (name: string) => ({ name, id: `id-${name}`, created_at: old, updated_at: old, metadata: { eTag: `"${name}"`, size: 1, mimetype: "image/png" } });
    const folder = (name: string) => ({ name, id: null, metadata: null });
    const pages: Record<string, unknown[]> = {
      "": [folder(U1), entry("loose.png")],
      [U1]: Array.from({ length: LIST_PAGE_SIZE + 2 }, (_, i) => entry(`${String(i).padStart(4, "0")}.png`)),
    };
    const calls: string[] = [];
    let busy = 1;
    const raw = {
      async listPage(bucket: string, prefix: string, { offset, limit }: { offset: number; limit: number }) {
        calls.push(`${bucket}:${prefix}@${offset}`);
        if (prefix === U1 && offset === LIST_PAGE_SIZE && busy-- > 0) {
          throw Object.assign(new Error("Too many connections issued to the database"), { status: 544 });
        }
        return (pages[prefix] ?? []).slice(offset, offset + limit);
      },
      info: async () => ({ missing: true }),
      remove: async () => [],
      download: async () => Buffer.from(""),
    };
    const { waits, sleep } = recordingSleep();
    const storage = limitStorage(raw, { sleep });
    const listed = [];
    for await (const o of storage.list("card-art")) listed.push(o);
    expect(listed).toHaveLength(LIST_PAGE_SIZE + 3);
    expect(listed[0]).toMatchObject({ bucket: "card-art", path: `${U1}/0000.png`, etag: '"0000.png"', size: 1, contentType: "image/png" });
    expect(listed.at(-1)).toMatchObject({ path: "loose.png" });
    expect(calls).toEqual(["card-art:@0", `card-art:${U1}@0`, `card-art:${U1}@${LIST_PAGE_SIZE}`, `card-art:${U1}@${LIST_PAGE_SIZE}`]);
    expect(waits).toHaveLength(1);
  });

  it("listObjects stops on a short page", async () => {
    const seen: number[] = [];
    const listed = [];
    for await (const o of listObjects(async (_b: string, _p: string, { offset }: { offset: number }) => {
      seen.push(offset);
      return offset === 0 ? [{ name: "a.png", id: "1", metadata: { eTag: '"a"', size: 1 } }] : [];
    }, "card-art")) {
      listed.push(o);
    }
    expect(seen).toEqual([0]);
    expect(listed.map((o: { path: string }) => o.path)).toEqual(["a.png"]);
  });
});
