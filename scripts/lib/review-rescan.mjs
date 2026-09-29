// ---------------------------------------------------------------------------
// review-rescan.mjs — `node scripts/sweep-storage-orphans.mjs --rescan-review`
// (TODO 3.14b, owner decision 2026-09-29 (b)): run the upload path's
// moderation scan over the sweep's REVIEW LIST — the user-folder files whose
// names the server doesn't make (`reviewList`, scripts/lib/storage-orphans
// .mjs): files written straight to storage with the user's own session before
// 0126 took the write policies away, so they skipped the byte sniff, the
// metadata strip and the moderation scan. Only that list, not every object.
//
// The SAME scan: the request and the category allowlist come from
// lib/moderation/image-scan-core.ts, which lib/moderation/image-scan.ts
// (every human upload) uses too — OpenAI's omni-moderation model, handed the
// object's public URL, flagged only for sexual, sexual/minors, self-harm (×3)
// and hate (×2). Two differences, both about bookkeeping, not the verdict:
//   * the upload path FAILS OPEN (a missing key or an API error lets the
//     upload through). Here an error is recorded as "not scanned" — never as
//     clean — and the next run tries again; a missing key stops the run;
//   * the URL carries `?v=<eTag>`, as the custom-pip scan's does, so a CDN
//     copy of older bytes can't answer for the current ones.
//
// The consequence (owner answer 2026-09-29): a flagged upload's object is
// removed from storage, as the upload path does (lib/cards/upload-art-
// server.ts, upload-watermark-server.ts, lib/profile/upload-server.ts,
// lib/media/upload-cover-server.ts, the pip's staged file in
// lib/pips/actions.ts). Unlike an upload, an old file may be IN USE, so
// --apply first acts on every row the app draws it from — through the APP
// (POST /api/admin/storage-sweep, scripts/lib/app-endpoint.mjs), with the
// app's own code paths (lib/moderation/flagged-file.ts):
//   * a card (art, second-face art, set icon, watermark icon, its bake) →
//     hidden: the moderation hide (private, render removed, reports actioned,
//     pages and CDN copies purged);
//   * an avatar / banner → a built-in of that kind (the settings "Remove"
//     pick);
//   * a deck cover → cleared;
//   * a custom pip → removed like the owner's "Remove" (row, object, re-bake
//     of the cards that draw it);
// and only when none of those failed is the file removed (a failure keeps
// it: a re-run retries — the app re-checks each row, and a row that no
// longer draws the file is skipped). A row that names the file anywhere else
// (a message, a notification, a job payload, a challenge's hero image, a
// deck entry) is listed, not changed. Every action and its result goes into
// the manifest. Nobody is notified (the moderation hide doesn't notify
// either).
//
// Nothing is copied to disk (the script refuses --backup-dir here): a flagged
// file may be exactly what must not be kept. The report names a flagged file
// by bucket/path and its categories — never its content. Resumable: every
// verdict is saved per object with the eTag it was made for; a re-run reuses
// it while the eTag is the same and scans again what errored or changed.
// ---------------------------------------------------------------------------
import { imageModerationRequest, scanVerdict } from "../../lib/moderation/image-scan-core.ts";
import { AppEndpointError } from "./app-endpoint.mjs";
import { limitStorage } from "./storage-calls.mjs";
import {
  KeyIndex,
  appendManifest,
  formatBytes,
  manifestEntry,
  plainMd5,
  reconcilePending,
  reviewList,
  sameEtag,
  saveState,
  scanReferences,
  userFolderKey,
} from "./storage-orphans.mjs";

/** Image types the moderation model reads. Anything else on the list is
 *  reported ("can't be scanned") and left alone. */
export const SCANNABLE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const DEFAULT_PER_MINUTE = 60;
export const MAX_PER_MINUTE = 600;
/** Tries per object (the first + retries on 429 / 5xx / a network error). */
export const MAX_ATTEMPTS = 4;
/** Objects in a row whose scan failed before the run stops. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** The longest one Retry-After wait honoured. */
export const MAX_RETRY_WAIT_MS = 60_000;

/** Verdicts a re-run reuses (while the eTag is unchanged). "error" is scanned again. */
const SETTLED = new Set(["clean", "flagged", "unscannable"]);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const stateKey = (obj) => `${obj.bucket}/${obj.path}`;

/**
 * What --apply does, through the app, to a row that names a flagged file —
 * by table and the columns the app draws a picture from (the columns match
 * lib/moderation/flagged-file.ts CARD_PICTURE_COLUMNS and the action schema
 * there; a unit test keeps them in step). Any other place is listed only.
 */
export const ROW_ACTIONS = {
  cards: {
    columns: ["art_url", "back_face", "set_icon_url", "watermark", "rendered_image_url", "rendered_thumb_url"],
    does: "hide the card (the moderation hide)",
    action: (row) => ({ kind: "hide-card", cardId: row.id }),
  },
  profiles: {
    columns: ["avatar_url", "banner_url"],
    does: "swap in a built-in image",
    action: (row, column) => ({ kind: "profile-default", userId: row.id, column }),
  },
  decks: {
    columns: ["cover_url"],
    does: "clear the deck cover",
    action: (row) => ({ kind: "clear-deck-cover", deckId: row.id }),
  },
  custom_pips: {
    columns: ["image_url"],
    does: "remove the custom pip",
    action: (row) => ({ kind: "remove-custom-pip", pipId: row.id }),
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The row action for one place (`{ table, column, row }`), or null when the
 *  app doesn't draw a picture from it (listed only). */
export function rowActionFor(place) {
  const rule = ROW_ACTIONS[place?.table];
  if (!rule || !rule.columns.includes(place.column)) return null;
  const id = place.row?.id;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  return rule.action({ id: id.toLowerCase() }, place.column);
}

/** `{ actions, listed }` for the places that name one flagged file: one
 *  action per row and column that draws it (a card named twice is hidden
 *  once), the rest listed only. */
export function planRowActions(places) {
  const actions = [];
  const seen = new Set();
  const listed = [];
  for (const place of places ?? []) {
    const action = rowActionFor(place);
    if (!action) {
      listed.push(place);
      continue;
    }
    const key = JSON.stringify(action);
    if (!seen.has(key)) {
      seen.add(key);
      actions.push(action);
    }
  }
  return { actions, listed };
}

/** "hide card <id>" — how an action reads in the output. */
export function describeAction(action) {
  switch (action?.kind) {
    case "hide-card":
      return `hide card ${action.cardId}`;
    case "profile-default":
      return `built-in ${action.column === "avatar_url" ? "avatar" : "banner"} for profile ${action.userId}`;
    case "clear-deck-cover":
      return `clear the cover of deck ${action.deckId}`;
    case "remove-custom-pip":
      return `remove custom pip ${action.pipId}`;
    default:
      return JSON.stringify(action);
  }
}

/** The rescan's state: the sweep's (pending/deleted/bytes/runs) plus one
 *  verdict per object. */
export function withVerdicts(state) {
  state.objects ??= {};
  return state;
}

/** The URL the moderation model fetches: the object's public URL, versioned
 *  by its eTag. */
export function moderationUrl(publicUrl, obj) {
  const version = plainMd5(obj.etag) ?? String(obj.etag ?? "").replace(/[^A-Za-z0-9-]/g, "");
  return version ? `${publicUrl}?v=${version}` : publicUrl;
}

/** Spaces calls `60 / perMinute` seconds apart. */
export function createPacer(perMinute, { now = () => Date.now(), sleep = defaultSleep } = {}) {
  if (!(perMinute >= 1 && perMinute <= MAX_PER_MINUTE)) throw new Error(`--per-minute must be 1–${MAX_PER_MINUTE}`);
  const gap = 60_000 / perMinute;
  let next = -Infinity;
  return {
    async wait() {
      const t = now();
      if (t < next) await sleep(next - t);
      next = Math.max(t, next) + gap;
    },
  };
}

/** The moderation API refused the key (401 / 403): the run stops. */
export class ModerationKeyRefused extends Error {}

/** What went wrong, WITHOUT the API's message: a 401's message quotes part of
 *  the key. Status and error code only. */
export function describeModerationError(err) {
  const status = typeof err?.status === "number" ? err.status : null;
  const code = typeof err?.code === "string" && /^[a-z0-9_]{1,60}$/i.test(err.code) ? err.code : null;
  if (status) return `HTTP ${status}${code ? ` ${code}` : ""}`;
  if (/timed? ?out/i.test(String(err?.name ?? "")) || /timed? ?out/i.test(String(err?.constructor?.name ?? ""))) return "timed out";
  return "no answer (network error)";
}

function retryWaitMs(err, attempt) {
  const header = err?.headers?.get?.("retry-after");
  const seconds = Number(header);
  if (header && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  return Math.min(2 ** attempt * 1000, MAX_RETRY_WAIT_MS);
}

const retryable = (err) => {
  const status = typeof err?.status === "number" ? err.status : null;
  return status === null || status === 408 || status === 409 || status === 429 || status >= 500;
};

/**
 * One scan: `moderate(request)` → the moderation response
 * (`{ results: [{ flagged, categories }] }`), with `request` exactly what the
 * upload path sends (imageModerationRequest). → `{ verdict: "clean" |
 * "flagged", categories }` or `{ verdict: "error", error, transient? }`.
 * 429 / 5xx / no answer are retried (Retry-After, else 2 s, 4 s, 8 s) and
 * `transient` once the tries run out; 401 / 403 throw ModerationKeyRefused.
 */
export async function moderateOnce({ moderate, url, sleep = defaultSleep, maxAttempts = MAX_ATTEMPTS, log = () => {} }) {
  const request = imageModerationRequest(url);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await moderate(request);
      const result = response?.results?.[0];
      if (!result) return { verdict: "error", error: "empty answer" };
      const verdict = scanVerdict(result);
      return verdict.flagged ? { verdict: "flagged", categories: verdict.categories } : { verdict: "clean", categories: [] };
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        throw new ModerationKeyRefused(`the moderation API refused the key (HTTP ${err.status}) — nothing more is scanned`);
      }
      const why = describeModerationError(err);
      // A 4xx about this one file (it can't be fetched or read) is its own
      // problem; only what retries couldn't fix counts towards stopping.
      if (!retryable(err)) return { verdict: "error", error: why };
      if (attempt >= maxAttempts) return { verdict: "error", error: why, transient: true };
      const wait = retryWaitMs(err, attempt);
      log(`    (${why} — retrying in ${Math.round(wait / 1000)} s)`);
      await sleep(wait);
    }
  }
}

/**
 * Scan every object of `objects` (the review list) that has no settled
 * verdict for its current eTag, one at a time, paced; save each verdict as it
 * comes. `publicUrl(bucket, path)` → the object's public URL. Stops after
 * `limit` scans, after MAX_CONSECUTIVE_FAILURES scans in a row that failed
 * even after their retries (the API is down or over its limit — a 4xx about
 * one file doesn't count), or when the key is refused (`stopped` says why).
 */
export async function rescanObjects({
  objects,
  state,
  statePath,
  moderate,
  publicUrl,
  pacer,
  sleep = defaultSleep,
  limit = Infinity,
  now = () => new Date(),
  log = () => {},
}) {
  withVerdicts(state);
  const out = { results: [], scanned: 0, reused: 0, notScanned: 0, stopped: null };
  const record = (obj, verdict) => {
    // What is kept per object: never `transient` (this run's bookkeeping).
    const entry = { etag: obj.etag ?? null, size: obj.size ?? null, verdict: verdict.verdict, at: now().toISOString() };
    if (verdict.categories) entry.categories = verdict.categories;
    if (verdict.error) entry.error = verdict.error;
    if ("contentType" in verdict) entry.contentType = verdict.contentType;
    state.objects[stateKey(obj)] = entry;
    saveState(statePath, state);
    return entry;
  };
  let failuresInARow = 0;
  for (const obj of objects) {
    const prior = state.objects[stateKey(obj)];
    if (prior && SETTLED.has(prior.verdict) && sameEtag(prior.etag, obj.etag)) {
      out.reused += 1;
      out.results.push({ obj, ...prior, reused: true });
      continue;
    }
    const type = String(obj.contentType ?? "").toLowerCase().split(";")[0].trim();
    if (!SCANNABLE_TYPES.has(type)) {
      out.results.push({ obj, ...record(obj, { verdict: "unscannable", contentType: type || null }) });
      continue;
    }
    if (out.stopped || out.scanned >= limit) {
      out.notScanned += 1;
      continue;
    }
    await pacer.wait();
    let verdict;
    try {
      verdict = await moderateOnce({ moderate, url: moderationUrl(publicUrl(obj.bucket, obj.path), obj), sleep, log });
    } catch (err) {
      if (!(err instanceof ModerationKeyRefused)) throw err;
      out.stopped = err.message;
      out.notScanned += 1;
      continue;
    }
    out.scanned += 1;
    const entry = record(obj, verdict);
    out.results.push({ obj, ...entry });
    log(`  ${obj.bucket}/${obj.path}: ${entry.verdict}${entry.categories?.length ? ` (${entry.categories.join(", ")})` : ""}${entry.error ? ` — ${entry.error}` : ""}`);
    failuresInARow = verdict.transient ? failuresInARow + 1 : 0;
    if (failuresInARow >= MAX_CONSECUTIVE_FAILURES) {
      out.stopped = `${failuresInARow} scans in a row failed — stopped; re-run later (the verdicts so far are saved)`;
    }
  }
  return out;
}

/**
 * Where each flagged file is used: one full read of the database (every
 * text/JSON column of every table, scripts/lib/storage-orphans.mjs) for just
 * these keys. → Map<"bucket/path", [{ table, column, row }]>. Matching is by
 * `{uuid}/{file}` key, bucket-agnostic like the sweep's: a row naming the
 * same key in another bucket is listed too (over-listing is the safe side).
 */
export async function referencesOf(db, flagged, { log = () => {} } = {}) {
  const byKey = new Map();
  const where = new Map();
  for (const f of flagged) {
    const key = f.path.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(stateKey(f));
    where.set(stateKey(f), []);
  }
  await scanReferences(db, new KeyIndex(flagged.map((f) => f.path)), {
    log,
    onReference: (key, place) => {
      for (const k of byKey.get(key) ?? []) where.get(k).push(place);
    },
  });
  return where;
}

const describePlace = (p) =>
  `${p.table}.${p.column} (${Object.entries(p.row)
    .map(([c, v]) => `${c} ${v}`)
    .join(", ")})`;

/**
 * Per flagged file, in order:
 *   1. looked up again: another eTag → skipped (the next run scans the new
 *      bytes; no row is touched for bytes nobody judged); a failed lookup →
 *      skipped;
 *   2. the rows that draw it (planRowActions over `references`) acted on
 *      through `app.flaggedFile` — every result appended to the manifest; a
 *      FAILED action keeps the file (a re-run retries, the app re-checks each
 *      row); the app not answering stops the run;
 *   3. gone already → nothing to delete; else `state.pending`, the remove
 *      (a busy one sent again only while a fresh lookup still shows the
 *      scanned bytes — `removeRechecked`), then storage's own answer: gone →
 *      the manifest (with its categories and the rows that named it); lookup
 *      failed → stays pending, the next run settles it.
 */
export async function applyFlagged({
  storage,
  flagged,
  references = new Map(),
  app = null,
  state,
  statePath,
  manifestPath,
  target,
  run,
  log = () => {},
}) {
  withVerdicts(state);
  storage = limitStorage(storage, { log });
  const result = { deleted: 0, bytes: 0, skipped: [], failed: [], rows: { done: 0, skipped: 0, failed: 0 } };
  const skip = (f, why) => {
    result.skipped.push({ bucket: f.bucket, path: f.path, why });
    log(`  - ${f.bucket}/${f.path}: ${why} — kept`);
  };
  for (const f of flagged) {
    if (state.objects[stateKey(f)]?.verdict !== "flagged") throw new Error(`${stateKey(f)} is not flagged`);
    let info;
    try {
      info = await storage.info(f.bucket, f.path);
    } catch (err) {
      skip(f, `lookup failed (${err.message})`);
      continue;
    }
    if (!info.missing && !sameEtag(info.etag, f.etag)) {
      skip(f, "changed since it was scanned — the next run scans the new bytes");
      continue;
    }

    const usedBy = references.get(stateKey(f)) ?? [];
    const { actions, listed } = planRowActions(usedBy);
    if (actions.length) {
      if (!app) throw new Error(`${stateKey(f)}: rows to act on, but no app to act through`);
      log(`  ${stateKey(f)} — ${actions.length} row(s) through the app:`);
      let outcomes;
      try {
        outcomes = await app.flaggedFile({ bucket: f.bucket, path: f.path }, actions);
      } catch (err) {
        if (!(err instanceof AppEndpointError)) throw err;
        result.failed.push({ bucket: f.bucket, paths: [f.path], error: err.message });
        log(`  ✗ ${stateKey(f)}: the app didn't act on its rows (${err.message}) — the file is kept; stopping`);
        break;
      }
      appendManifest(manifestPath, [
        {
          at: new Date().toISOString(),
          target,
          run,
          bucket: f.bucket,
          path: f.path,
          rowActions: outcomes.map((o) => ({ action: o?.action ?? null, status: o?.status ?? "failed", detail: o?.detail ?? null })),
          listedOnly: listed,
        },
      ]);
      let rowFailed = false;
      for (const o of outcomes) {
        const status = ["done", "skipped"].includes(o?.status) ? o.status : "failed";
        result.rows[status] += 1;
        if (status === "failed") rowFailed = true;
        log(`    ${status === "done" ? "✓" : status === "skipped" ? "·" : "✗"} ${describeAction(o?.action)}: ${o?.detail ?? status}`);
      }
      if (rowFailed || outcomes.length !== actions.length) {
        result.failed.push({ bucket: f.bucket, paths: [f.path], error: "a row action failed" });
        skip(f, "a row action failed — the file stays so a re-run can retry");
        continue;
      }
    }

    if (info.missing) {
      skip(f, "already gone");
      continue;
    }
    const categories = state.objects[stateKey(f)].categories ?? [];
    const item = {
      path: f.path,
      size: info.size ?? f.size ?? null,
      etag: f.etag ?? null,
      reason: `flagged by the moderation scan (${categories.join(", ")})`,
    };
    state.pending = { bucket: f.bucket, run, at: new Date().toISOString(), items: [item] };
    saveState(statePath, state);
    // A busy remove is sent again only while a fresh lookup still shows the
    // bytes that were scanned (removeRechecked, scripts/lib/storage-calls
    // .mjs): gone → not sent (the first try took it; the confirm records
    // it), new bytes or no answer → not sent, kept.
    let notSentAgain = null;
    const recheck = async () => {
      let again;
      try {
        again = await storage.info(f.bucket, f.path);
      } catch (err) {
        notSentAgain = `lookup failed before the delete was sent again (${err.message})`;
        return [];
      }
      if (again.missing) return [];
      if (!sameEtag(again.etag, f.etag)) {
        notSentAgain = "changed since it was scanned — the next run scans the new bytes";
        return [];
      }
      return [f.path];
    };
    try {
      await storage.removeRechecked(f.bucket, [f.path], recheck);
    } catch (err) {
      result.failed.push({ bucket: f.bucket, paths: [f.path], error: err.message });
      log(`  ✗ ${f.bucket}/${f.path}: delete failed (${err.message}) — re-run to settle it`);
      break;
    }
    let after;
    try {
      after = await storage.info(f.bucket, f.path);
    } catch (err) {
      result.failed.push({ bucket: f.bucket, paths: [f.path], error: "delete not confirmed" });
      log(`  ? ${f.bucket}/${f.path}: couldn't confirm the delete (${err.message}) — the next run settles it`);
      break;
    }
    state.pending = null;
    if (!after.missing) {
      saveState(statePath, state);
      skip(f, notSentAgain ?? "storage did not remove it");
      continue;
    }
    appendManifest(manifestPath, [{ ...manifestEntry(target, f.bucket, item, run), categories, usedBy }]);
    state.objects[stateKey(f)] = { ...state.objects[stateKey(f)], verdict: "deleted", deletedAt: new Date().toISOString() };
    state.deleted = (state.deleted ?? 0) + 1;
    state.bytes = (state.bytes ?? 0) + (Number(item.size) || 0);
    saveState(statePath, state);
    result.deleted += 1;
    result.bytes += Number(item.size) || 0;
    log(`  ✓ ${f.bucket}/${f.path}  ${formatBytes(Number(item.size) || 0)}`);
  }
  return result;
}

/**
 * The whole mode: settle an interrupted delete, list the buckets, take the
 * review list, scan what has no verdict yet (`moderateFor()` is called only
 * then — it asks for the moderation key), report each flagged file with the
 * rows that name it and what --apply does to each, and with `apply` — after
 * `appFor()` (the app endpoint, asked for only when a row needs an action;
 * it checks the app talks to this database) and "yes" — act on the rows and
 * remove the flagged objects. Returns the exit code.
 */
export async function runReviewRescan({
  storage,
  db,
  buckets,
  apply,
  confirm,
  moderateFor,
  appFor = async () => {
    throw new AppEndpointError("no app endpoint configured");
  },
  publicUrl,
  perMinute = DEFAULT_PER_MINUTE,
  limit = Infinity,
  sleep = defaultSleep,
  state,
  statePath,
  manifestPath,
  target,
  targetLabel,
  run,
  log = () => {},
}) {
  withVerdicts(state);
  storage = limitStorage(storage, { log });
  await reconcilePending({ storage, state, statePath, manifestPath, target, log });

  const listed = [];
  for (const bucket of buckets) {
    for await (const obj of storage.list(bucket)) listed.push(obj);
  }
  const review = reviewList(listed).sort((a, b) => (stateKey(a) < stateKey(b) ? -1 : 1));
  const byBucket = review.reduce((m, o) => m.set(o.bucket, (m.get(o.bucket) ?? 0) + 1), new Map());
  log(
    `Review list: ${review.length} user-folder object(s) with a name the server doesn't make` +
      `${review.length ? ` (${[...byBucket].map(([b, n]) => `${b} ${n}`).join(", ")})` : ""} of ${listed.length} listed.`,
  );
  const outside = listed.filter((o) => userFolderKey(o.path) === null).length;
  if (outside) {
    log(`  (${outside} object(s) outside the {uuid}/{file} shape are not on the review list and are not scanned — the sweep's dry run lists them.)`);
  }

  const needsScan = review.filter((o) => {
    const prior = state.objects[stateKey(o)];
    return !(prior && SETTLED.has(prior.verdict) && sameEtag(prior.etag, o.etag));
  });
  let moderate = null;
  if (needsScan.some((o) => SCANNABLE_TYPES.has(String(o.contentType ?? "").toLowerCase().split(";")[0].trim()))) {
    moderate = await moderateFor();
  }
  if (!review.length) log("Nothing to scan.");
  else if (needsScan.length) {
    log(
      `Scanning ${needsScan.length} (${review.length - needsScan.length} already have a verdict for their current bytes), ` +
        `${perMinute} a minute at most:`,
    );
  } else log(`All ${review.length} already have a verdict for their current bytes.`);
  const scan = await rescanObjects({
    objects: review,
    state,
    statePath,
    moderate: moderate ?? (() => Promise.reject(new Error("no moderation client"))),
    publicUrl,
    pacer: createPacer(perMinute, { sleep }),
    sleep,
    limit,
    log,
  });

  const of = (v) => scan.results.filter((r) => r.verdict === v);
  const flagged = of("flagged");
  log(
    `\nClean ${of("clean").length} · flagged ${flagged.length} · can't be scanned ${of("unscannable").length} · ` +
      `scan failed ${of("error").length}${scan.notScanned ? ` · not scanned this run ${scan.notScanned}` : ""}.`,
  );
  for (const r of of("unscannable")) log(`  can't be scanned: ${stateKey(r.obj)}  (${r.contentType ?? "no content type"}) — left alone`);
  for (const r of of("error")) log(`  scan failed: ${stateKey(r.obj)}  (${r.error}) — the next run tries again`);
  if (scan.stopped) log(`\nStopped: ${scan.stopped}.`);

  let references = new Map();
  const plans = new Map();
  if (flagged.length) {
    references = await referencesOf(
      db,
      flagged.map((r) => r.obj),
      { log },
    );
    log(`\nFlagged (${flagged.length}) — by bucket/path and category only:`);
    for (const r of flagged) {
      const used = references.get(stateKey(r.obj)) ?? [];
      const plan = planRowActions(used);
      plans.set(stateKey(r.obj), plan);
      log(`  ${stateKey(r.obj)}  ${formatBytes(Number(r.obj.size) || 0)}  ${r.categories.join(", ")}`);
      if (!used.length) log("      named by no row");
      for (const place of used) {
        const action = rowActionFor(place);
        log(`      named by ${describePlace(place)} → ${action ? ROW_ACTIONS[place.table].does : "listed only"}`);
      }
    }
    const actionCount = [...plans.values()].reduce((n, p) => n + p.actions.length, 0);
    if (actionCount) {
      log(
        `  --apply acts on ${actionCount} row(s) through the app first (the moderation hide for a card, a built-in image ` +
          `for an avatar/banner, no cover for a deck, the pip removed), then removes each file whose rows all succeeded.`,
      );
    }
    if ([...plans.values()].some((p) => p.listed.length)) {
      log(`  A row listed only keeps its value (it names the file somewhere the app doesn't draw a picture from) — yours to decide about.`);
    }
  }

  const exitCode = scan.stopped || of("error").length ? 1 : 0;
  if (!apply) {
    log(
      flagged.length
        ? `\nDry run: nothing deleted, no row changed. Re-run with --rescan-review --apply to act on those rows and remove the flagged file(s).`
        : "\nNothing flagged.",
    );
    return exitCode;
  }
  if (!flagged.length) {
    log("\nNothing flagged — nothing to delete.");
    return exitCode;
  }
  const counts = { "hide-card": 0, "profile-default": 0, "clear-deck-cover": 0, "remove-custom-pip": 0 };
  for (const plan of plans.values()) for (const a of plan.actions) counts[a.kind] += 1;
  const rowCount = Object.values(counts).reduce((n, c) => n + c, 0);
  let app = null;
  if (rowCount) {
    try {
      app = await appFor();
    } catch (err) {
      if (!(err instanceof AppEndpointError)) throw err;
      log(`\nThe app can't be reached (${err.message}) — nothing deleted, no row changed.`);
      return 1;
    }
  }
  const through = rowCount
    ? ` First, through the app: hide ${counts["hide-card"]} card(s), swap ${counts["profile-default"]} avatar/banner(s) for a ` +
      `built-in, clear ${counts["clear-deck-cover"]} deck cover(s), remove ${counts["remove-custom-pip"]} custom pip(s).`
    : " No row draws them.";
  const answer = await confirm(
    `\nDelete ${flagged.length} flagged object(s) from ${targetLabel}?${through} ` +
      `Storage has no undo and no copy is kept. Type "yes": `,
  );
  if (answer !== "yes") {
    log("Aborted — nothing deleted, no row changed.");
    return 1;
  }
  const result = await applyFlagged({
    storage,
    flagged: flagged.map((r) => ({ ...r.obj, etag: r.etag ?? r.obj.etag })),
    references,
    app,
    state,
    statePath,
    manifestPath,
    target,
    run,
    log,
  });
  log(
    `\nRows: ${result.rows.done} done, ${result.rows.skipped} skipped (no longer draw the file), ${result.rows.failed} failed. ` +
      `Deleted ${result.deleted} flagged object(s), ${formatBytes(result.bytes)}; kept ${result.skipped.length}` +
      `${result.failed.length ? `; ${result.failed.length} failed — re-run to retry` : ""}. Manifest: ${manifestPath}`,
  );
  return result.failed.length ? 1 : exitCode;
}
