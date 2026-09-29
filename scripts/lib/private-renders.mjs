// ---------------------------------------------------------------------------
// private-renders.mjs — `node scripts/sweep-storage-orphans.mjs
// --private-renders` (TODO 3.14b, owner decision 2026-09-29 (c)): remove the
// card-renders objects (the HD PNG and its WebP thumb) of cards that are
// PRIVATE. The bucket is public-read and the key is fixed
// (`{owner}/{cardId}.png`), so such a render is the full card image,
// fetchable by anyone who has — or guesses — the URL. The app deletes it when
// a card goes private (lib/cards/bake-core.ts removeRenderObjects), but only
// logs when that delete fails; the sweep's dry run lists what was left
// behind, and this mode removes it.
//
// Only on POSITIVE evidence (review 2026-09-29): a render goes only when its
// card's row was READ and says `private`, twice. A card with no row in the
// answer is never touched here — a short answer (a max-rows cap, a key that
// RLS limits) would otherwise turn a public card into a "deleted" one. The
// renders of cards that really are deleted are orphans: the orphan sweep
// judges them (every row read for a reference, the 7-day floor, the eTag
// re-check, the optional backup). Every visibility read also checks the
// server's exact count against the rows it returned and stops when they
// differ, so the plan never silently misses a private card.
//
// What it mirrors — nothing more:
//   * the objects: the two names a bake writes (renderObjectNames,
//     lib/cards/bake-core.ts), whatever folder they sit in;
//   * the row: every go-private path clears the card's render pointer in the
//     same UPDATE that makes it private (lib/cards/actions.ts bulk
//     visibility, lib/moderation/actions.ts hide: rendered_image_url,
//     rendered_thumb_url, rendered_at), then removes the objects. So does
//     this mode, per batch: first the pointers of the batch's cards that are
//     private AT THAT MOMENT (a conditional UPDATE — a card made public
//     since is not touched), then the objects. (The single-card save also
//     clears layout_version; it only records which renderer baked the PNG,
//     and the re-bake paths only read it on public/unlisted cards — left
//     alone.)
//
// Never touched: a render of a public or unlisted card, of a card with any
// other visibility, or of a card without a row. Per batch the objects are
// looked up first (the slow part: gone, or new bytes since the listing →
// kept — a bake only writes after reading the card as public/unlisted), THEN
// the visibility is read again, THEN the remove — so the only window left is
// one database read plus the remove call. A card published inside it can't
// lose a NEW render: the bake reads the card, renders (seconds) and only then
// uploads; what the remove takes in that window is the old bake of a card
// that was still private when read. A remove storage answers busy is never
// simply sent again seconds later: the lookup and the visibility read are
// repeated first (removeRechecked, scripts/lib/storage-calls.mjs), so the
// window stays the same on every try.
//
// No backups (the script refuses --backup-dir here): a render is derived — a
// card published again is baked again.
//
// The CDN (owner answer 2026-09-29): /render-cdn/<owner>/<card>.png is cached
// by Vercel for a year, tagged card-<id> (app/render-cdn/[...path]/route.ts),
// so removing the object is not enough — the CDN copy has to be purged, and
// only a function running on Vercel can. --apply therefore needs the app
// (POST /api/admin/storage-sweep, scripts/lib/app-endpoint.mjs, checked to
// talk to this database before "yes"): after each batch, the cards whose
// renders storage confirmed gone are purged through it (purgeHiddenCards —
// the same purge as going private in the app). Every card of a batch is
// noted in the state file (`purgePending`) BEFORE its remove and taken off
// only once the purge succeeded, so a crash or a failed purge is retried at
// the start of the next --apply; after one failed purge the run stops asking
// (the renders still go) and exits 1.
// ---------------------------------------------------------------------------
import { AppEndpointError } from "./app-endpoint.mjs";
import { limitStorage } from "./storage-calls.mjs";
import {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  appendManifest,
  formatBytes,
  manifestEntry,
  reconcilePending,
  renderCardId,
  sameEtag,
  saveState,
} from "./storage-orphans.mjs";

export const RENDER_BUCKET = "card-renders";

/** The render pointer every go-private path clears in the UPDATE that makes
 *  the card private (see the header). */
export const RENDER_POINTER_COLUMNS = ["rendered_image_url", "rendered_thumb_url", "rendered_at"];

/** A render of a card with one of these visibilities is never touched. */
export const VISIBLE = new Set(["public", "unlisted"]);

/** Card ids per `cards` read (`id=in.(…)`). */
export const CARD_READ_CHUNK = 100;

/** Cards whose render is listed in full by the dry run (the rest counted). */
export const LIST_CAP = 100;

/**
 * The card-renders objects that are a card's bake (`{uuid}/{cardId}.png` or
 * `.thumb.webp`), grouped by card id (a Map). Anything else in the bucket is
 * not a render (the sweep's review list covers it).
 */
export function rendersByCard(objects) {
  const groups = new Map();
  for (const obj of objects) {
    if (obj.bucket !== RENDER_BUCKET) continue;
    const cardId = renderCardId(obj.path);
    if (!cardId) continue;
    if (!groups.has(cardId)) groups.set(cardId, []);
    groups.get(cardId).push(obj);
  }
  return groups;
}

/**
 * What happens to a card's renders, from its visibility (`undefined` = no
 * row in the answer): only "private" is removed. "visible" (public /
 * unlisted), "other" (any other value) and "deleted" (no row — the orphan
 * sweep's to judge, see the header) are left alone.
 */
export function cardState(visibility) {
  if (visibility === undefined) return "deleted";
  if (visibility === "private") return "private";
  if (VISIBLE.has(visibility)) return "visible";
  return "other";
}

const sizeOf = (objects) => objects.reduce((n, o) => n + (Number(o.size) || 0), 0);

/**
 * One entry per card that has a render: `{ cardId, state, objects, bytes }`,
 * from ONE read of those cards' visibility. `db.cardVisibility(ids)` →
 * `Map<id, visibility>` for the rows that exist (throws on any error, and
 * when the server's exact count differs from the rows it returned).
 */
export async function planPrivateRenders(db, objects) {
  const groups = rendersByCard(objects);
  const visibility = await db.cardVisibility([...groups.keys()]);
  return [...groups]
    .map(([cardId, objs]) => ({ cardId, state: cardState(visibility.get(cardId)), objects: objs, bytes: sizeOf(objs) }))
    .sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
}

/** Cards per batch, whole cards only, at most `left` objects in all. */
function nextBatch(cards, start, batchSize, left) {
  const batch = [];
  let objects = 0;
  for (let i = start; i < cards.length && batch.length < batchSize; i += 1) {
    if (objects + cards[i].objects.length > left) break;
    batch.push(cards[i]);
    objects += cards[i].objects.length;
  }
  return batch;
}

/** Note card ids whose CDN copies must be purged (kept across runs). */
export function addPurgePending(state, ids) {
  state.purgePending = [...new Set([...(state.purgePending ?? []), ...ids])].sort();
}

/**
 * Purge these cards' caches through the app and take them off
 * `state.purgePending`. → true on success; false (logged, still pending)
 * when there is no app or it failed. Anything but the app's own failure
 * throws.
 */
export async function purgeThroughApp({ app, ids, state, statePath, manifestPath, target, run, log = () => {} }) {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) return true;
  if (!app) {
    log(`  ! ${unique.length} card(s) need their CDN copies purged and there is no app to do it — kept for the next --apply`);
    return false;
  }
  let answer;
  try {
    answer = await app.purgeCards(unique);
  } catch (err) {
    if (!(err instanceof AppEndpointError)) throw err;
    log(`  ✗ CDN purge of ${unique.length} card(s) failed (${err.message}) — kept in the state file; the next --apply retries`);
    return false;
  }
  state.purgePending = (state.purgePending ?? []).filter((id) => !unique.includes(id));
  saveState(statePath, state);
  appendManifest(manifestPath, [
    { at: new Date().toISOString(), target, run, purged: unique, cdn: answer.vercel ? "purged (tag card-<id>)" : "the app is not on Vercel — no CDN to purge" },
  ]);
  log(`  purged the caches of ${unique.length} card(s)${answer.vercel ? "" : " (the app is not on Vercel: no CDN copies)"}`);
  return true;
}

/**
 * Remove the renders of `cards` (entries of planPrivateRenders whose state is
 * "private"), `batchSize` cards at a time, at most `limit` objects. Per
 * batch:
 *   1. `db.clearRenderPointers(ids)` — the pointers of those that are private
 *      right now (conditional UPDATE, see the header); returns the ids;
 *   2. every object looked up (at most `--storage-concurrency` at a time,
 *      scripts/lib/storage-calls.mjs): gone → skipped; another eTag than the
 *      listing's (new bytes — a bake) → kept, the next run judges it again;
 *   3. `db.cardVisibility(ids)` — THE re-check, right before the remove:
 *      anything but a row that says private → kept, never touched;
 *   4. `state.pending` (and the batch's cards in `state.purgePending`), the
 *      remove — one storage answers busy is sent again only for what 2 and
 *      3, repeated after the backoff, still clear (`removeRechecked`) — then
 *      storage's own answer for every object: gone → the manifest; still
 *      there → kept; lookup failed → stays pending for the next run
 *      (reconcilePending);
 *   5. the CDN purge, through `app`, of the cards whose objects are gone
 *      (see the header) — after one failure, no more tries this run.
 */
export async function applyPrivateRenders({
  db,
  storage,
  cards,
  batchSize = DEFAULT_BATCH_SIZE,
  limit = Infinity,
  app = null,
  state,
  statePath,
  manifestPath,
  target,
  run,
  log = () => {},
}) {
  if (!(batchSize >= 1 && batchSize <= MAX_BATCH_SIZE)) throw new Error(`batch size must be 1–${MAX_BATCH_SIZE}`);
  storage = limitStorage(storage, { log });
  for (const card of cards) {
    if (card.state !== "private") throw new Error(`card ${card.cardId} is ${card.state} — only a private card's renders are removed here`);
    for (const obj of card.objects) {
      if (obj.bucket !== RENDER_BUCKET || renderCardId(obj.path) !== card.cardId) {
        throw new Error(`${obj.bucket}/${obj.path} is not a render of card ${card.cardId}`);
      }
    }
  }
  const result = { deleted: 0, bytes: 0, pointersCleared: 0, purged: 0, purgeFailed: false, skipped: [], failed: [], limitReached: false };
  const skip = (obj, why) => {
    result.skipped.push({ bucket: obj.bucket, path: obj.path, why });
    log(`  - ${obj.bucket}/${obj.path}: ${why} — kept`);
  };

  for (let i = 0; i < cards.length; ) {
    const batch = nextBatch(cards, i, batchSize, limit - result.deleted);
    if (!batch.length) {
      result.limitReached = true;
      break;
    }
    i += batch.length;
    const ids = batch.map((c) => c.cardId);

    // 1. The pointers of the batch's cards that are private right now.
    const cleared = await db.clearRenderPointers(ids);
    if (cleared.length) {
      result.pointersCleared += cleared.length;
      appendManifest(manifestPath, [
        { at: new Date().toISOString(), target, run, table: "cards", cleared: RENDER_POINTER_COLUMNS, ids: [...cleared].sort() },
      ]);
      log(`  cleared the render pointer of ${cleared.length} private card(s)`);
    }

    // 2. The objects (the slow part, so it comes before the re-check; a few
    //    at a time, busy storage retried — scripts/lib/storage-calls.mjs).
    const looked = await Promise.all(
      batch.flatMap((card) =>
        card.objects.map(async (obj) => {
          try {
            return { obj, card, info: await storage.info(RENDER_BUCKET, obj.path) };
          } catch (err) {
            return { obj, card, error: err };
          }
        }),
      ),
    );
    const present = [];
    for (const { obj, card, info, error } of looked) {
      if (error) skip(obj, `lookup failed (${error.message})`);
      else if (info.missing) skip(obj, "already gone");
      else if (!sameEtag(info.etag, obj.etag)) skip(obj, "new bytes since the listing (a bake) — the next run judges it again");
      else present.push({ obj, card, info });
    }
    if (!present.length) continue;

    // 3. The visibility, again, right before the delete: only a row that says
    //    private lets its card's renders go.
    const now = await db.cardVisibility(ids);
    const notPrivate = (visibility) => {
      const current = cardState(visibility);
      if (current === "private") return null;
      return current === "visible"
        ? `its card is ${visibility} now — never touched`
        : current === "deleted"
          ? "its card has no row now — the orphan sweep's to judge"
          : `its card's visibility is "${visibility}"`;
    };
    const toRemove = [];
    for (const { obj, card, info } of present) {
      const why = notPrivate(now.get(card.cardId));
      if (why) {
        skip(obj, why);
        continue;
      }
      toRemove.push({
        path: obj.path,
        size: info.size ?? obj.size ?? null,
        etag: info.etag ?? obj.etag ?? null,
        card: card.cardId,
        reason: "render of a private card",
      });
    }
    if (!toRemove.length) continue;

    // 4. The delete, then storage's own answer. A busy remove is sent again
    //    only after steps 2 and 3 are repeated for what it still covers
    //    (removeRechecked, scripts/lib/storage-calls.mjs) — so the window
    //    stays one database read plus the remove call, whatever the retries.
    state.pending = { bucket: RENDER_BUCKET, run, at: new Date().toISOString(), items: toRemove };
    addPurgePending(state, toRemove.map((item) => item.card));
    saveState(statePath, state);
    const byPath = new Map(toRemove.map((item) => [item.path, item]));
    const notSentAgain = new Map();
    const recheck = async (paths) => {
      const again = await Promise.all(
        paths.map(async (p) => {
          try {
            return { item: byPath.get(p), info: await storage.info(RENDER_BUCKET, p) };
          } catch (err) {
            return { item: byPath.get(p), error: err };
          }
        }),
      );
      const stillThere = [];
      for (const { item, info, error } of again) {
        if (error) notSentAgain.set(item.path, `lookup failed before the delete was sent again (${error.message})`);
        else if (info.missing) continue; // the first try took it — the confirm below records it
        else if (!sameEtag(info.etag, item.etag)) notSentAgain.set(item.path, "new bytes since the listing (a bake) — the next run judges it again");
        else stillThere.push(item);
      }
      if (!stillThere.length) return [];
      const visibilityNow = await db.cardVisibility([...new Set(stillThere.map((item) => item.card))]);
      const send = [];
      for (const item of stillThere) {
        const why = notPrivate(visibilityNow.get(item.card));
        if (why) notSentAgain.set(item.path, why);
        else send.push(item.path);
      }
      return send;
    };
    try {
      await storage.removeRechecked(RENDER_BUCKET, toRemove.map((item) => item.path), recheck);
    } catch (err) {
      result.failed.push({ bucket: RENDER_BUCKET, paths: toRemove.map((item) => item.path), error: err.message });
      log(`  ✗ ${RENDER_BUCKET}: delete of ${toRemove.length} object(s) failed (${err.message}) — re-run to settle it`);
      break;
    }
    const confirmed = await Promise.all(
      toRemove.map(async (item) => {
        try {
          return { item, gone: Boolean((await storage.info(RENDER_BUCKET, item.path)).missing) };
        } catch (err) {
          return { item, error: err };
        }
      }),
    );
    const done = [];
    const unsettled = [];
    for (const { item, gone, error } of confirmed) {
      if (error) {
        unsettled.push(item);
        log(`  ? ${RENDER_BUCKET}/${item.path}: couldn't confirm the delete (${error.message}) — the next run settles it`);
      } else if (gone) {
        done.push(item);
      } else {
        skip({ bucket: RENDER_BUCKET, path: item.path }, notSentAgain.get(item.path) ?? "storage did not remove it");
      }
    }
    appendManifest(
      manifestPath,
      done.map((item) => ({ ...manifestEntry(target, RENDER_BUCKET, item, run), card: item.card })),
    );
    const bytes = done.reduce((n, item) => n + (Number(item.size) || 0), 0);
    result.deleted += done.length;
    result.bytes += bytes;
    state.deleted = (state.deleted ?? 0) + done.length;
    state.bytes = (state.bytes ?? 0) + bytes;
    state.pending = unsettled.length ? { ...state.pending, items: unsettled } : null;
    saveState(statePath, state);
    for (const item of done) log(`  ✓ ${RENDER_BUCKET}/${item.path}  ${formatBytes(Number(item.size) || 0)}`);
    const gone = [...new Set(done.map((item) => item.card))];
    if (gone.length && !result.purgeFailed) {
      if (await purgeThroughApp({ app, ids: gone, state, statePath, manifestPath, target, run, log })) result.purged += gone.length;
      else result.purgeFailed = true;
    }
    if (unsettled.length) {
      result.failed.push({ bucket: RENDER_BUCKET, paths: unsettled.map((item) => item.path), error: "delete not confirmed" });
      break;
    }
  }
  return result;
}

/**
 * The whole mode: settle an interrupted batch, list card-renders, read the
 * cards' visibility, print the plan (card ids and counts only — no titles, no
 * owners), and with `apply` (after "yes") remove. Returns the exit code.
 * `confirm(question)` → the typed answer.
 */
export async function runPrivateRenders({
  storage,
  db,
  apply,
  confirm,
  appFor = async () => {
    throw new AppEndpointError("no app endpoint configured");
  },
  batchSize = DEFAULT_BATCH_SIZE,
  limit = Infinity,
  state,
  statePath,
  manifestPath,
  target,
  targetLabel,
  run,
  log = () => {},
}) {
  storage = limitStorage(storage, { log });
  await reconcilePending({ storage, state, statePath, manifestPath, target, log });

  const objects = [];
  for await (const obj of storage.list(RENDER_BUCKET)) objects.push(obj);
  const plan = await planPrivateRenders(db, objects);
  const renders = plan.reduce((n, c) => n + c.objects.length, 0);
  const count = (s) => plan.filter((c) => c.state === s);
  const doomed = count("private");
  const doomedObjects = doomed.reduce((n, c) => n + c.objects.length, 0);
  const doomedBytes = doomed.reduce((n, c) => n + c.bytes, 0);
  const objectsOf = (cards) => cards.reduce((n, c) => n + c.objects.length, 0);

  log(
    `${RENDER_BUCKET}: ${objects.length} objects (${formatBytes(sizeOf(objects))}) — ${renders} render(s) of ${plan.length} card(s)` +
      `${objects.length - renders ? `, ${objects.length - renders} with another name (not a render — the orphan sweep and its review list judge them)` : ""}.`,
  );
  log(`  public/unlisted cards: ${count("visible").length} (${objectsOf(count("visible"))} objects) — never touched`);
  if (count("deleted").length) {
    log(
      `  cards with no row: ${count("deleted").length} (${objectsOf(count("deleted"))} objects) — never touched here: a deleted ` +
        `card's render is an orphan, judged by the orphan sweep (reference check, age floor, backup)`,
    );
  }
  if (count("other").length) log(`  cards with another visibility: ${count("other").length} — left alone`);
  log(`\nRenders to remove: ${doomedObjects} object(s) (${formatBytes(doomedBytes)}) of ${doomed.length} private card(s).`);
  for (const c of doomed.slice(0, LIST_CAP)) {
    log(`  ${c.cardId}  ${c.objects.length} object(s)  ${formatBytes(c.bytes)}`);
  }
  if (doomed.length > LIST_CAP) log(`  … and ${doomed.length - LIST_CAP} more card(s)`);

  const pendingPurge = state.purgePending ?? [];
  if (pendingPurge.length) {
    log(`\n${pendingPurge.length} card(s) from an earlier run still need their CDN copies purged — --apply retries that first.`);
  }
  if (!apply) {
    log(
      doomed.length
        ? `\nDry run: nothing deleted, no row changed, nothing purged. Re-run with --private-renders --apply to remove them (the visibility is read again right before each delete) and purge their CDN copies through the app.`
        : "\nNothing to remove.",
    );
    return 0;
  }
  if (!doomed.length && !pendingPurge.length) {
    log("\nNothing to remove.");
    return 0;
  }
  // The app first — before "yes" — so a run never removes renders it can't
  // purge the CDN copies of.
  let app;
  try {
    app = await appFor();
  } catch (err) {
    if (!(err instanceof AppEndpointError)) throw err;
    log(`\nThe app can't be reached (${err.message}) — nothing deleted, nothing purged.`);
    return 1;
  }
  if (pendingPurge.length) {
    log(`\nPurging the CDN copies of ${pendingPurge.length} card(s) left from an earlier run:`);
    const ok = await purgeThroughApp({ app, ids: pendingPurge, state, statePath, manifestPath, target, run, log });
    if (!ok) return 1;
  }
  if (!doomed.length) {
    log("\nNothing (more) to remove.");
    return 0;
  }
  const take = Math.min(doomedObjects, limit);
  const answer = await confirm(
    `\nRemove ${take === doomedObjects ? "" : `up to ${take} of `}${doomedObjects} render object(s) (${formatBytes(doomedBytes)}) from ${targetLabel}, ` +
      `clear the render pointer of those private cards (what going private does), and purge their CDN copies through ` +
      `${app.url}? Storage has no undo — a card published again is baked again. Type "yes": `,
  );
  if (answer !== "yes") {
    log("Aborted — nothing deleted.");
    return 1;
  }
  const result = await applyPrivateRenders({ db, storage, cards: doomed, batchSize, limit, app, state, statePath, manifestPath, target, run, log });
  log(
    `\nDeleted ${result.deleted} render object(s), ${formatBytes(result.bytes)}; cleared ${result.pointersCleared} private card pointer(s); ` +
      `purged the CDN copies of ${result.purged} card(s); kept ${result.skipped.length} on re-check` +
      `${result.failed.length ? `; ${result.failed.length} batch(es) failed — re-run to settle` : ""}. Manifest: ${manifestPath}`,
  );
  if (result.purgeFailed || (state.purgePending ?? []).length) {
    log(
      `${(state.purgePending ?? []).length} card(s) still need their CDN copies purged (state file: purgePending) — re-run --private-renders --apply, ` +
        `or purge their tags card-<id> in the Vercel dashboard (CDN → Caches → Purge cache → Cache Tag, Delete).`,
    );
  }
  if (result.limitReached) log(`--limit ${limit} reached: re-run to continue.`);
  return result.failed.length || result.purgeFailed || (state.purgePending ?? []).length ? 1 : 0;
}
