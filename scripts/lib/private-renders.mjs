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
// that was still private when read.
//
// No backups (the script refuses --backup-dir here): a render is derived — a
// card published again is baked again.
// ---------------------------------------------------------------------------
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

/**
 * Remove the renders of `cards` (entries of planPrivateRenders whose state is
 * "private"), `batchSize` cards at a time, at most `limit` objects. Per
 * batch:
 *   1. `db.clearRenderPointers(ids)` — the pointers of those that are private
 *      right now (conditional UPDATE, see the header); returns the ids;
 *   2. every object looked up at once: gone → skipped; another eTag than the
 *      listing's (new bytes — a bake) → kept, the next run judges it again;
 *   3. `db.cardVisibility(ids)` — THE re-check, right before the remove:
 *      anything but a row that says private → kept, never touched;
 *   4. `state.pending`, the remove, then storage's own answer for every
 *      object: gone → the manifest; still there → kept; lookup failed →
 *      stays pending for the next run (reconcilePending).
 */
export async function applyPrivateRenders({
  db,
  storage,
  cards,
  batchSize = DEFAULT_BATCH_SIZE,
  limit = Infinity,
  state,
  statePath,
  manifestPath,
  target,
  run,
  log = () => {},
}) {
  if (!(batchSize >= 1 && batchSize <= MAX_BATCH_SIZE)) throw new Error(`batch size must be 1–${MAX_BATCH_SIZE}`);
  for (const card of cards) {
    if (card.state !== "private") throw new Error(`card ${card.cardId} is ${card.state} — only a private card's renders are removed here`);
    for (const obj of card.objects) {
      if (obj.bucket !== RENDER_BUCKET || renderCardId(obj.path) !== card.cardId) {
        throw new Error(`${obj.bucket}/${obj.path} is not a render of card ${card.cardId}`);
      }
    }
  }
  const result = { deleted: 0, bytes: 0, pointersCleared: 0, skipped: [], failed: [], limitReached: false };
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

    // 2. The objects, all at once (the slow part, so it comes before the re-check).
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
    const toRemove = [];
    for (const { obj, card, info } of present) {
      const visibility = now.get(card.cardId);
      const current = cardState(visibility);
      if (current !== "private") {
        skip(
          obj,
          current === "visible"
            ? `its card is ${visibility} now — never touched`
            : current === "deleted"
              ? "its card has no row now — the orphan sweep's to judge"
              : `its card's visibility is "${visibility}"`,
        );
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

    // 4. The delete, then storage's own answer.
    state.pending = { bucket: RENDER_BUCKET, run, at: new Date().toISOString(), items: toRemove };
    saveState(statePath, state);
    try {
      await storage.remove(RENDER_BUCKET, toRemove.map((item) => item.path));
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
        skip({ bucket: RENDER_BUCKET, path: item.path }, "storage did not remove it");
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

  if (!apply) {
    log(
      doomed.length
        ? `\nDry run: nothing deleted, no row changed. Re-run with --private-renders --apply to remove them (the visibility is read again right before each delete).`
        : "\nNothing to remove.",
    );
    return 0;
  }
  if (!doomed.length) {
    log("\nNothing to remove.");
    return 0;
  }
  const take = Math.min(doomedObjects, limit);
  const answer = await confirm(
    `\nRemove ${take === doomedObjects ? "" : `up to ${take} of `}${doomedObjects} render object(s) (${formatBytes(doomedBytes)}) from ${targetLabel}, ` +
      `and clear the render pointer of those private cards (what going private does)? Storage has no undo — ` +
      `a card published again is baked again. Type "yes": `,
  );
  if (answer !== "yes") {
    log("Aborted — nothing deleted.");
    return 1;
  }
  const result = await applyPrivateRenders({ db, storage, cards: doomed, batchSize, limit, state, statePath, manifestPath, target, run, log });
  log(
    `\nDeleted ${result.deleted} render object(s), ${formatBytes(result.bytes)}; cleared ${result.pointersCleared} private card pointer(s); ` +
      `kept ${result.skipped.length} on re-check${result.failed.length ? `; ${result.failed.length} batch(es) failed — re-run to settle` : ""}. Manifest: ${manifestPath}`,
  );
  if (result.limitReached) log(`--limit ${limit} reached: re-run to continue.`);
  return result.failed.length ? 1 : 0;
}
