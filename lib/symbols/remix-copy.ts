import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import { checkUploadRateLimit, UPLOAD_RATE_LIMITED } from "@/lib/media/upload-rate-limit";
import { SYMBOL_COLUMNS, symbolFromRow, type SymbolRow } from "@/lib/symbols/queries";
import { remixedSymbolCodes, type RemixSymbolsNotice, type SymbolNamingRow } from "@/lib/symbols/remix";
import { ownSymbolFileName, removeSymbolPictures } from "@/lib/symbols/write-symbol";

// ---------------------------------------------------------------------------
// A remix of another maker's card COPIES the parent owner's symbols it names
// into the remixer's set (new pips PR 5; lib/symbols/remix.ts says why).
// Run by createCardAction before its symbol check (lib/symbols/card-check.ts),
// which then finds every carried code the remixer's own.
//
// - Only codes the remix AND its parent name, and only symbols the parent's
//   owner has (removed ones too: their card still draws them).
// - A code the remixer already has (live or removed) is never copied: theirs
//   wins, and the notice says so.
// - The copy is the remixer's own row and picture: a new `sym-<uuid>.png`
//   in their custom-pips folder (the parent's picture copied, counted as ONE
//   upload), the parent's name, mana value and colour. Written by the
//   SERVICE ROLE whether or not the tool is open to the remixer — a remix is
//   not a symbol made by hand (0193's insert policy is the tool's), and a
//   remixer without it would otherwise be refused (or draw blank discs).
//   0193's trigger still counts: at 20 live symbols a copy is kept REMOVED
//   (it still draws), at 60 rows the remix is refused.
// - All or nothing: a failed copy takes back the ones before it, and the
//   caller calls `undo` when the card itself is not saved.
// ---------------------------------------------------------------------------

export type RemixSymbolCopy =
  | { ok: true; notice: RemixSymbolsNotice | null; undo: () => Promise<void> }
  | { ok: false; error: string; code?: typeof UPLOAD_RATE_LIMITED };

const nothing = async () => undefined;
const NOTHING: RemixSymbolCopy = { ok: true, notice: null, undo: nothing };

export const REMIX_SYMBOLS_FULL_MESSAGE =
  "Your mana symbols are full (60, removed ones included), so this card's symbols can't come with your remix. Take them out of the card, or delete symbols you no longer use.";
export const REMIX_SYMBOLS_FAILED_MESSAGE = "Couldn't copy the original card's mana symbols — try again.";

type CopiedRow = { id: string; fileName: string };

export async function adoptRemixSymbols(
  userId: string,
  parent: SymbolNamingRow & { owner_id: string },
  remix: SymbolNamingRow,
): Promise<RemixSymbolCopy> {
  if (!parent.owner_id || parent.owner_id === userId) return NOTHING;
  const codes = remixedSymbolCodes(parent, remix);
  if (codes.length === 0) return NOTHING;
  if (!isUserStorageConfigured()) return { ok: false, error: REMIX_SYMBOLS_FAILED_MESSAGE };

  const admin = createAdminClient();
  const [mine, theirs] = await Promise.all([
    admin.from("custom_symbols").select("code").eq("owner_id", userId),
    admin.from("custom_symbols").select(SYMBOL_COLUMNS).eq("owner_id", parent.owner_id).in("code", codes),
  ]);
  if (mine.error || theirs.error) {
    console.error("[custom-symbols] a remix could not read the symbols", mine.error?.message ?? theirs.error?.message);
    return { ok: false, error: REMIX_SYMBOLS_FAILED_MESSAGE };
  }
  const own = new Set(((mine.data ?? []) as Array<{ code: string }>).map((row) => row.code.toUpperCase()));
  const keptYours = codes.filter((code) => own.has(code));
  // The parent owner's symbols, as the app trusts them (a picture in their
  // own folder); a code they have none for is left for the card check.
  const sources = ((theirs.data ?? []) as SymbolRow[])
    .map((row) => symbolFromRow(row, parent.owner_id))
    .filter((symbol) => symbol !== null && !own.has(symbol.code) && codes.includes(symbol.code))
    .map((symbol) => ({ symbol: symbol!, fileName: ownSymbolFileName(parent.owner_id, symbol!.imageUrl) }))
    .filter((source): source is { symbol: NonNullable<typeof source.symbol>; fileName: string } => source.fileName !== null);

  if (sources.length === 0) {
    return keptYours.length > 0 ? { ok: true, notice: { copied: [], copiedRemoved: [], keptYours }, undo: nothing } : NOTHING;
  }

  const limit = await checkUploadRateLimit(userId);
  if (!limit.ok) return { ok: false, error: limit.message, code: limit.code };

  const folder = userFolder("custom-pips", userId);
  const done: CopiedRow[] = [];
  const undo = async () => {
    if (done.length === 0) return;
    const ids = done.map((row) => row.id);
    const { error } = await admin.from("custom_symbols").delete().in("id", ids);
    if (error) console.error("[custom-symbols] a remix's copies could not be taken back", error.message);
    await removeSymbolPictures(userId, done.map((row) => row.fileName));
  };
  const fail = async (error: string): Promise<RemixSymbolCopy> => {
    await undo();
    return { ok: false, error };
  };

  const notice: RemixSymbolsNotice = { copied: [], copiedRemoved: [], keptYours };
  for (const { symbol, fileName: sourceName } of sources) {
    const fileName = `sym-${randomUUID()}.png`;
    const copied = await folder.copyIn(`${parent.owner_id}/${sourceName}`, fileName);
    if (copied.error) {
      console.error(`[custom-symbols] copying ${symbol.code}'s picture for a remix failed:`, copied.error.message);
      return fail(REMIX_SYMBOLS_FAILED_MESSAGE);
    }
    const row = {
      owner_id: userId,
      code: symbol.code,
      name: symbol.name,
      mana_value: symbol.manaValue,
      base_color: symbol.baseColor,
      image_url: `${folder.publicUrl(fileName)}?v=${Date.now()}`,
      source: symbol.source,
    };
    const insertRow = (values: typeof row & { deleted_at?: string }) =>
      admin.from("custom_symbols").insert(values).select("id").single();
    let removed = false;
    let { data, error } = await insertRow(row);
    // At 20 live symbols: kept as removed — it still draws on the card.
    if (error && /custom_symbol_limit/.test(error.message ?? "")) {
      removed = true;
      ({ data, error } = await insertRow({ ...row, deleted_at: new Date().toISOString() }));
    }
    if (error || !data) {
      await removeSymbolPictures(userId, [fileName]);
      // Made in the meantime (another save of theirs): theirs, as above.
      if (error?.code === "23505") {
        notice.keptYours.push(symbol.code);
        continue;
      }
      if (/custom_symbol_row_limit/.test(error?.message ?? "")) return fail(REMIX_SYMBOLS_FULL_MESSAGE);
      console.error(`[custom-symbols] copying ${symbol.code} for a remix failed:`, error?.message);
      return fail(REMIX_SYMBOLS_FAILED_MESSAGE);
    }
    done.push({ id: (data as { id: string }).id, fileName });
    (removed ? notice.copiedRemoved : notice.copied).push(symbol.code);
  }
  return { ok: true, notice, undo };
}
