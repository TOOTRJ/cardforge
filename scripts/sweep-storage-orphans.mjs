#!/usr/bin/env node
// ---------------------------------------------------------------------------
// sweep-storage-orphans.mjs — list, and with --apply delete, storage objects
// no database row references (TODO 3.14b): flagged uploads and replaced
// avatars/banners that the old user-session removes never deleted (0126),
// art uploaded for a card that was never saved, renders of deleted cards,
// leftovers of deleted accounts. OWNER-RUN.
//
//   node scripts/sweep-storage-orphans.mjs                        # dev, dry run
//   node scripts/sweep-storage-orphans.mjs --target prod          # prod, dry run
//   node scripts/sweep-storage-orphans.mjs --target prod --apply  # prod, delete
//
// Run it from an up-to-date `main` checkout (trusted code). Production's
// secret key is asked for at a hidden prompt (it never lives in .env.local or
// the shell history) — the dry run needs it too: listing a bucket and reading
// every table are not public. The dev target reads NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SECRET_KEY from .env.local (or --env-file) and refuses production.
//
// Flags:
//   --target dev|prod     default dev
//   --apply               delete (after a "type yes" confirm); default: list
//   --bucket <name>       card-art, profile-media, set-covers, custom-pips,
//                         card-renders (repeatable; default all five). Never
//                         frames or card-exports (see NOT_SWEPT).
//   --min-age-days <n>    only objects unchanged for n days (default and
//                         floor 7 — every bucket, not only card-art)
//   --batch-size <n>      objects per delete, each batch re-checked first
//                         (default 25, max 100). Every batch re-reads the
//                         WHOLE database, so use 100 on production (the
//                         prompt says how many full reads the run makes)
//   --limit <n>           delete at most n objects this run (re-run resumes)
//   --backup-dir <dir>    download each object there before deleting it (an
//                         object whose copy fails, or whose bytes no longer
//                         match the listed MD5 eTag, is kept). Never inside a
//                         git working tree — this repo is public and the
//                         backups are users' images (refused); use e.g.
//                         ~/.pipglyph/sweep-backups/<date>
//   --state <file>        resume file (default ~/.pipglyph/sweep-storage-
//                         orphans.<project>.json)
//   --manifest <file>     delete log, JSON lines (default ~/.pipglyph/sweep-
//                         storage-orphans.<project>.manifest.jsonl)
//   --env-file <path>     dev target's env file (default .env.local)
//
// An object is an ORPHAN when all of these hold (scripts/lib/storage-orphans
// .mjs):
//   * it is a `{uuid}/{file}` user-folder object in a swept bucket (anything
//     else — a root file, a nested path, an odd name — is listed and kept);
//   * its key appears in NO string of ANY row: the scan reads every text and
//     JSON column of every table the API exposes (not a column list), and
//     finds the key inside URLs, encoded URLs, Markdown, JSON at any depth,
//     bare storage paths;
//   * card-renders only: its card (`{cardId}.png` / `.thumb.webp`) no longer
//     exists — a live card's bake or thumb is never touched, whatever the
//     row says;
//   * it hasn't changed for --min-age-days (created/updated/last modified).
//
// --apply, after "type yes", batch by batch: the copies (--backup-dir), then
// the whole database is scanned AGAIN for that batch's keys and card ids,
// then every object is looked up again, all at once (gone, a different
// eTag/size, or now too young → kept), and right after that the batch is
// noted in the state file and removed; every object is then looked up once
// more, and only what storage says is gone goes into the manifest (bucket,
// path, size, eTag, last change, reason, copy). Storage has no conditional
// delete, so the lookups sit right before the remove. A run that dies
// mid-delete is settled on the next run (what is gone is logged, the rest is
// judged again). Nothing about an object is printed but its key, size and
// age.
//
// The dry run also lists, for review only (nothing here deletes them):
//   * renders of PRIVATE cards that are still stored — publicly fetchable at
//     their fixed URL; going private should have deleted them;
//   * user-folder objects whose names the server doesn't make — an older
//     upload path, or a file written straight to storage with the user's own
//     session before 0126 (it skipped the sniff, the strip and the scan).
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { promptHidden } from "./lib/hidden-prompt.mjs";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";
import {
  DEFAULT_BATCH_SIZE,
  KeyIndex,
  MAX_BATCH_SIZE,
  MIN_AGE_DAYS,
  NOT_SWEPT,
  SWEEP_BUCKETS,
  VERDICTS,
  ageDays,
  applySweep,
  backupDirProblem,
  classify,
  formatBytes,
  isServerMintedName,
  loadState,
  plannedBatches,
  privateCardRenders,
  reconcilePending,
  referenceKey,
  saveState,
  scanReferences,
  summarize,
  userFolderKey,
} from "./lib/storage-orphans.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- flags ---------------------------------------------------------------------
const VALUE_FLAGS = new Set([
  "--target",
  "--bucket",
  "--min-age-days",
  "--batch-size",
  "--limit",
  "--backup-dir",
  "--state",
  "--manifest",
  "--env-file",
]);
const BARE_FLAGS = new Set(["--apply"]);
const values = new Map();
const buckets = [];
const bare = new Set();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    if (BARE_FLAGS.has(name) && inline === undefined) {
      bare.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) fail(`Unknown argument "${argv[i]}".`);
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
    if (name === "--bucket") buckets.push(value);
    else values.set(name, value);
  }
}
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const intFlag = (name, fallback, min, max) => {
  if (!values.has(name)) return fallback;
  const n = Number(values.get(name));
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
};

const target = values.get("--target") ?? "dev";
if (target !== "dev" && target !== "prod") fail("--target must be dev or prod.");
const apply = bare.has("--apply");
for (const b of buckets) {
  if (b in NOT_SWEPT) fail(`--bucket ${b}: never swept — ${NOT_SWEPT[b]}.`);
  if (!SWEEP_BUCKETS.includes(b)) fail(`--bucket ${b}: only ${SWEEP_BUCKETS.join(", ")}.`);
}
const sweepBuckets = buckets.length ? [...new Set(buckets)] : SWEEP_BUCKETS;
if (values.has("--min-age-days")) {
  const n = Number(values.get("--min-age-days"));
  if (!Number.isFinite(n) || n < MIN_AGE_DAYS) fail(`--min-age-days is never below ${MIN_AGE_DAYS}.`);
}
const minAgeDays = values.has("--min-age-days") ? Number(values.get("--min-age-days")) : MIN_AGE_DAYS;
const batchSize = intFlag("--batch-size", DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
const limit = intFlag("--limit", Infinity, 1, Number.MAX_SAFE_INTEGER);
const backupDir = values.has("--backup-dir") ? path.resolve(values.get("--backup-dir")) : null;
if (backupDir) {
  const problem = backupDirProblem(backupDir, REPO_ROOT);
  if (problem) fail(`--backup-dir: ${problem}.`);
}

// --- target ----------------------------------------------------------------------
function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

let url;
let key;
if (target === "prod") {
  if (values.has("--env-file")) fail("--env-file is for the dev target; production's key is only read at the prompt.");
  url = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
  if (!isProductionSupabaseUrl(url)) fail("Production URL check failed.");
  if (!process.stdin.isTTY) fail("Run this in a terminal: production's secret key is read at a hidden prompt.");
  key = await promptHidden("Production secret key (Supabase dashboard → API keys; not echoed): ");
  if (!key) fail("No key given.");
} else {
  const envFile = path.resolve(values.get("--env-file") ?? ".env.local");
  const env = parseEnvFile(envFile);
  url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  key = env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) fail(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.`);
  if (isProductionSupabaseUrl(url)) fail(`${envFile} points at PRODUCTION — use --target prod (hidden-prompt key) for that.`);
}
const host = new URL(url).host;
const project = host.split(".")[0];
const pipglyphDir = path.join(os.homedir(), ".pipglyph");
const statePath = path.resolve(values.get("--state") ?? path.join(pipglyphDir, `sweep-storage-orphans.${project}.json`));
const manifestPath = path.resolve(
  values.get("--manifest") ?? path.join(pipglyphDir, `sweep-storage-orphans.${project}.manifest.jsonl`),
);
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// --- storage + database, as the helpers want them ---------------------------------
const bucketApi = (bucket) => supabase.storage.from(bucket);
const isMissing = (error) =>
  (String(error?.statusCode) === "404" || error?.status === 404) && !/bucket/i.test(String(error?.message ?? ""));

const storage = {
  /** Every object under `prefix`, depth-first (folders have id null). */
  async *list(bucket, prefix = "") {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucketApi(bucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
      for (const entry of data ?? []) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) yield* storage.list(bucket, full);
        else
          yield {
            bucket,
            path: full,
            etag: entry.metadata?.eTag ?? null,
            size: entry.metadata?.size ?? null,
            createdAt: entry.created_at ?? null,
            updatedAt: entry.updated_at ?? null,
            lastModified: entry.metadata?.lastModified ?? null,
          };
      }
      if (!data || data.length < 1000) return;
    }
  },
  async info(bucket, objectPath) {
    const { data, error } = await bucketApi(bucket).info(objectPath);
    if (error) {
      if (isMissing(error)) return { missing: true };
      throw new Error(error.message);
    }
    return {
      etag: data?.etag ?? null,
      size: data?.size ?? null,
      createdAt: data?.createdAt ?? null,
      lastModified: data?.lastModified ?? null,
    };
  },
  async remove(bucket, paths) {
    const { data, error } = await bucketApi(bucket).remove(paths);
    if (error) throw new Error(error.message);
    return (data ?? []).map((o) => o.name);
  },
  async download(bucket, objectPath) {
    const { data, error } = await bucketApi(bucket).download(objectPath);
    if (error || !data) throw new Error(error?.message ?? "empty download");
    return Buffer.from(await data.arrayBuffer());
  },
};

const quoteColumn = (c) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(c) ? c : `"${c.replaceAll('"', '""')}"`);
const db = {
  async openApi() {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
    });
    if (!res.ok) throw new Error(`the API schema could not be read (HTTP ${res.status})`);
    return res.json();
  },
  async select(table, { columns, order, after, offset, limit: pageSize }) {
    let q = supabase.from(table).select(columns.map(quoteColumn).join(","));
    for (const column of order) q = q.order(column, { ascending: true });
    if (after !== null && after !== undefined) q = q.gt(order[0], after);
    q = offset ? q.range(offset, offset + pageSize - 1) : q.limit(pageSize);
    const { data, error } = await q;
    if (error) throw new Error(`read ${table}: ${error.message}`);
    return data;
  },
};

// --- run -------------------------------------------------------------------------
const log = (line) => console.log(line);
const state = loadState(statePath);
if (state.target && state.target !== host) fail(`${statePath} belongs to ${state.target}, not ${host} — pass --state.`);
state.target = host;
state.runs = (state.runs ?? 0) + 1;
const run = `${new Date().toISOString()}#${state.runs}`;
saveState(statePath, state);

console.log(
  `${target === "prod" ? "PRODUCTION" : "dev"} ${host} — ${apply ? "APPLY" : "dry run"}; buckets: ${sweepBuckets.join(", ")}; ` +
    `only objects unchanged for ${minAgeDays} days`,
);
console.log(`State: ${statePath}\nManifest: ${manifestPath}\n`);

try {
  await reconcilePending({ storage, state, statePath, manifestPath, target: host, log });
} catch (err) {
  fail(`Could not settle the interrupted batch in ${statePath}: ${err.message}`);
}

const listed = [];
for (const bucket of [...sweepBuckets, "card-exports"]) {
  let n = 0;
  let bytes = 0;
  try {
    for await (const obj of storage.list(bucket)) {
      listed.push(obj);
      n += 1;
      bytes += Number(obj.size) || 0;
    }
  } catch (err) {
    fail(`Listing ${bucket} failed: ${err.message}`);
  }
  console.log(`  ${bucket}: ${n} objects (${formatBytes(bytes)})`);
}

let scan;
try {
  scan = await scanReferences(db, new KeyIndex(listed.map((o) => o.path)), { log });
} catch (err) {
  fail(`Reference scan failed — nothing is deleted without a complete one: ${err.message}`);
}

const now = Date.now();
const classified = classify(listed, { referenced: scan.referenced, cardIds: scan.cardIds, now, minAgeDays });
const totals = summarize(classified);
const orphans = classified
  .filter((o) => o.verdict === "orphan")
  .sort((a, b) => (a.bucket === b.bucket ? (a.path < b.path ? -1 : 1) : a.bucket < b.bucket ? -1 : 1));

console.log("");
const LABELS = [
  ["referenced", "referenced"],
  ["liveCard", "live card's bake"],
  ["tooNew", `under ${minAgeDays} d`],
  ["outside", "outside a user folder"],
  ["unknownRender", "unrecognised render name"],
];
for (const bucket of sweepBuckets) {
  const t = totals[bucket] ?? { objects: 0, bytes: 0 };
  const kept = LABELS.filter(([v]) => t[v]?.n).map(([v, label]) => `${label} ${t[v].n}`);
  const o = t.orphan ?? { n: 0, bytes: 0 };
  console.log(
    `${bucket.padEnd(14)} ${String(t.objects).padStart(6)} objects ${formatBytes(t.bytes).padStart(9)} · ` +
      `${kept.length ? `${kept.join(" · ")} · ` : ""}ORPHANS ${o.n} (${formatBytes(o.bytes)})`,
  );
}
const exportsTotals = totals["card-exports"] ?? { objects: 0, bytes: 0 };
console.log(
  `card-exports   ${String(exportsTotals.objects).padStart(6)} objects ${formatBytes(exportsTotals.bytes).padStart(9)} · ` +
    `not swept (${NOT_SWEPT["card-exports"].split(":")[0]}); ` +
    `${classified.filter((o) => o.bucket === "card-exports" && scan.referenced.has(referenceKey(o.path))).length} named by a row`,
);

const unusual = classified.filter((o) => o.verdict === "outside" || o.verdict === "unknownRender");
if (unusual.length) {
  console.log(`\nKept, not a shape the sweep deletes (${unusual.length}):`);
  for (const o of unusual) console.log(`  ${o.bucket}/${o.path}  ${formatBytes(Number(o.size) || 0)}  — ${VERDICTS[o.verdict]}`);
}

const privateRenders = privateCardRenders(classified, scan.privateCardIds);
if (privateRenders.length) {
  console.log(
    `\nPrivacy follow-up — ${privateRenders.length} render(s) of PRIVATE cards still stored (publicly fetchable at ` +
      `their URL; going private should have deleted them). Listed only — the sweep never deletes a live card's render:`,
  );
  for (const o of privateRenders) console.log(`  ${o.bucket}/${o.path}  ${formatBytes(Number(o.size) || 0)}`);
}

const LIST_CAP = 100;
const oddNames = classified.filter(
  (o) => SWEEP_BUCKETS.includes(o.bucket) && userFolderKey(o.path) && !isServerMintedName(o.bucket, o.path),
);
if (oddNames.length) {
  const byBucket = oddNames.reduce((m, o) => m.set(o.bucket, (m.get(o.bucket) ?? 0) + 1), new Map());
  console.log(
    `\nReview — ${oddNames.length} user-folder object(s) with a name the server doesn't make today ` +
      `(${[...byBucket].map(([b, n]) => `${b} ${n}`).join(", ")}): an older upload path, or a file written straight to ` +
      `storage before 0126 (no sniff, strip or scan). Listed only; deleted only if also an orphan:`,
  );
  for (const o of oddNames.slice(0, LIST_CAP)) {
    console.log(`  ${o.bucket}/${o.path}  ${formatBytes(Number(o.size) || 0)}  — ${VERDICTS[o.verdict]}`);
  }
  if (oddNames.length > LIST_CAP) console.log(`  … and ${oddNames.length - LIST_CAP} more`);
}

const reclaimable = orphans.reduce((n, o) => n + (Number(o.size) || 0), 0);
if (orphans.length) {
  console.log(`\nOrphans (${orphans.length}):`);
  for (const o of orphans) {
    const age = ageDays(o, now);
    console.log(`  ${o.bucket}/${o.path}  ${formatBytes(Number(o.size) || 0)}  ${age === null ? "?" : age.toFixed(1)} d`);
  }
}
console.log(`\nTotal: ${orphans.length} orphan(s), ${formatBytes(reclaimable)} reclaimable.`);

if (!apply) {
  console.log(
    orphans.length
      ? `Dry run: nothing deleted. Re-run with --apply to delete them (each batch is re-checked first).`
      : "Nothing to delete.",
  );
  process.exit(0);
}
if (orphans.length === 0) {
  console.log("Nothing to delete.");
  process.exit(0);
}

// --- apply -----------------------------------------------------------------------
const count = Math.min(orphans.length, limit);
const reads = plannedBatches(orphans, batchSize, limit);
console.log(
  `\n--apply re-reads the whole database once per batch: ${reads} batch(es) of up to ${batchSize} → ${reads} full read(s) of ` +
    `every table.${target === "prod" && batchSize < MAX_BATCH_SIZE ? ` On production use --batch-size ${MAX_BATCH_SIZE} to cut that.` : ""}`,
);
const answer = await promptLine(
  `\nDelete ${count === orphans.length ? "" : `${count} of `}${orphans.length} object(s) (${formatBytes(reclaimable)}) from ` +
    `${target === "prod" ? "PRODUCTION" : "dev"} (${host})? Storage has no undo — ${backupDir ? `copies go to ${backupDir}` : "no --backup-dir given"}. Type "yes": `,
);
if (answer !== "yes") {
  console.log("Aborted — nothing deleted.");
  process.exit(1);
}

let result;
try {
  result = await applySweep({
    db,
    storage,
    candidates: orphans,
    batchSize,
    limit,
    minAgeDays,
    state,
    statePath,
    manifestPath,
    target: host,
    run,
    backupDir,
    log,
  });
} catch (err) {
  fail(`Stopped: ${err.message}. Re-run to continue — the state file settles an interrupted batch.`);
}
console.log(
  `\nDeleted ${result.deleted} object(s), ${formatBytes(result.bytes)}; kept ${result.skipped.length} on re-check` +
    `${result.failed.length ? `; ${result.failed.length} batch(es) failed` : ""}. Manifest: ${manifestPath}`,
);
if (result.deleted < orphans.length && result.deleted >= limit) console.log(`--limit ${limit} reached: re-run to continue.`);
process.exit(result.failed.length ? 1 : 0);
