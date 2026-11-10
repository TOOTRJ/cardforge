import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// New pips PR 5: a remix of another maker's card brings the parent owner's
// symbols it names into the remixer's set (lib/symbols/remix-copy.ts) — a
// code the remixer already has stays theirs, and the creator shows and says
// so (lib/symbols/remix.ts).
// ---------------------------------------------------------------------------

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "99999999-9999-4999-8999-999999999999";
const ORIGIN = "https://auth.pipglyph.com";
const PIC1 = "sym-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";
const PIC2 = "sym-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png";
const pubUrl = (owner: string, name: string) => `${ORIGIN}/storage/v1/object/public/custom-pips/${owner}/${name}`;

const symbolRow = (code: string, picture: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`,
  code,
  name: `${code} name`,
  mana_value: 3,
  base_color: "R",
  image_url: `${pubUrl(THEM, picture)}?v=1`,
  source: "upload",
  deleted_at: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});

const state = vi.hoisted(() => ({
  mine: [] as Array<{ code: string }>,
  theirs: [] as unknown[],
  readError: null as null | { message: string },
  copies: [] as Array<{ from: string; to: string }>,
  copyError: null as null | { message: string },
  removed: [] as string[][],
  limited: false,
  limitChecks: 0,
  /** Per insert: the answer, in order (default: an id). */
  inserts: [] as ChainAnswer[],
  chain: null as null | ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => state.chain!.client.from(table),
    storage: {
      from: (bucket: string) => ({
        copy: async (from: string, to: string) => {
          state.copies.push({ from: `${bucket}:${from}`, to: `${bucket}:${to}` });
          return state.copyError ? { data: null, error: state.copyError } : { data: { path: to }, error: null };
        },
        remove: async (keys: string[]) => {
          state.removed.push(keys);
          return { data: null, error: null };
        },
        getPublicUrl: (key: string) => ({ data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${bucket}/${key}` } }),
      }),
    },
  }),
}));
vi.mock("@/lib/media/upload-rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/upload-rate-limit")>();
  return {
    ...actual,
    checkUploadRateLimit: async () => {
      state.limitChecks += 1;
      return state.limited
        ? { ok: false, code: "UPLOAD_RATE_LIMITED", window: "minute", retryAfterSeconds: 5, message: actual.UPLOAD_TOO_FAST_MESSAGE }
        : { ok: true };
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/tools/queries", () => ({ getViewerTool: async () => null }));

import { adoptRemixSymbols, REMIX_SYMBOLS_FAILED_MESSAGE, REMIX_SYMBOLS_FULL_MESSAGE } from "@/lib/symbols/remix-copy";
import { remixedSymbolCodes, remixSymbolsMessage, symbolCodesNamedBy, withRemixParentSymbols } from "@/lib/symbols/remix";

let insertIndex = 0;
function resolve(table: string, calls: ChainCall[]): ChainAnswer {
  if (table !== "custom_symbols") return {};
  if (calls.some((c) => c.method === "insert")) {
    const answer = state.inserts[insertIndex] ?? { data: { id: `new-${insertIndex}` } };
    insertIndex += 1;
    return answer;
  }
  if (calls.some((c) => c.method === "delete")) return {};
  if (state.readError) return { error: state.readError };
  const owner = calls.find((c) => c.method === "eq")?.args[1];
  return { data: owner === ME ? state.mine : state.theirs };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ORIGIN);
  vi.stubEnv("SUPABASE_SECRET_KEY", "test");
  state.mine = [];
  state.theirs = [symbolRow("FIRE", PIC1), symbolRow("BUG", PIC2, { mana_value: 0, base_color: null })];
  state.readError = null;
  state.copies = [];
  state.copyError = null;
  state.removed = [];
  state.limited = false;
  state.limitChecks = 0;
  state.inserts = [];
  insertIndex = 0;
  state.chain = chainClient(resolve);
});

const parent = { owner_id: THEM, title: "Pyre", cost: "{1}{*FIRE}", rules_text: "Add {*BUG}." };
const inserts = () =>
  state.chain!.forTable("custom_symbols").filter((e) => e.calls.some((c) => c.method === "insert")).map((e) => payloadOf(e.calls, "insert") as Record<string, unknown>);

describe("the codes a remix carries", () => {
  it("reads the fields 0195's in-use check reads, the name and nickname too", () => {
    expect(
      symbolCodesNamedBy({
        title: "{*A}",
        nickname: "{*B}",
        cost: "{*c}",
        rules_text: "{*D}",
        face_content: { loyalty: [{ text: "{*E}" }] },
        back_face: { rules_text: "{*F}" },
      }),
    ).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(symbolCodesNamedBy({ cost: "{1}{R}" })).toEqual([]);
    expect(symbolCodesNamedBy(null)).toEqual([]);
  });

  it("carries only the codes the parent names too", () => {
    expect(remixedSymbolCodes(parent, { cost: "{*FIRE}", rules_text: "{*NEW} and {*BUG}" })).toEqual(["FIRE", "BUG"]);
    expect(remixedSymbolCodes(null, { cost: "{*FIRE}" })).toEqual([]);
  });
});

describe("the creator's view of a remix's symbols", () => {
  const own = { pictures: { "*BUG": "mine-bug.png", R: "mine-red.png" }, meanings: { BUG: { manaValue: 5, baseColor: "G" as const } } };
  const theirs = {
    pictures: { "*FIRE": "their-fire.png", "*BUG": "their-bug.png", "*OTHER": "their-other.png" },
    meanings: { FIRE: { manaValue: 3, baseColor: "R" as const }, BUG: { manaValue: 0, baseColor: null }, OTHER: { manaValue: 1, baseColor: null } },
  };

  it("adds the parent owner's symbols the remixer lacks, and keeps the remixer's own on a clash", () => {
    const view = withRemixParentSymbols(own, theirs, ["FIRE", "BUG"]);
    expect(view.pictures).toEqual({ "*BUG": "mine-bug.png", R: "mine-red.png", "*FIRE": "their-fire.png" });
    expect(view.meanings).toEqual({ BUG: { manaValue: 5, baseColor: "G" }, FIRE: { manaValue: 3, baseColor: "R" } });
  });

  it("is the remixer's own without a parent map or codes", () => {
    expect(withRemixParentSymbols(own, null, ["FIRE"])).toBe(own);
    expect(withRemixParentSymbols(own, theirs, [])).toBe(own);
  });
});

describe("the save's notice", () => {
  it("says what was copied, kept removed and kept yours", () => {
    expect(remixSymbolsMessage(null)).toBeNull();
    expect(remixSymbolsMessage({ copied: [], copiedRemoved: [], keptYours: [] })).toBeNull();
    expect(remixSymbolsMessage({ copied: ["FIRE"], copiedRemoved: [], keptYours: [] })).toBe(
      "Your remix brought the mana symbol {*FIRE} into your symbols.",
    );
    expect(remixSymbolsMessage({ copied: ["FIRE"], copiedRemoved: ["BUG"], keptYours: ["AE1"] })).toBe(
      "Your remix brought the mana symbols {*FIRE} and {*BUG} into your symbols. You already have 20 symbols, so {*BUG} is kept as removed — the card still shows it. You already have a symbol {*AE1}, so your remix uses yours.",
    );
  });
});

describe("adoptRemixSymbols", () => {
  it("copies each symbol's picture into the remixer's folder and writes it as theirs", async () => {
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}", rules_text: "Add {*bug}." });
    expect(result).toMatchObject({ ok: true, notice: { copied: ["FIRE", "BUG"], copiedRemoved: [], keptYours: [] } });
    expect(state.limitChecks).toBe(1);
    expect(state.copies).toHaveLength(2);
    expect(state.copies[0].from).toBe(`custom-pips:${THEM}/${PIC1}`);
    expect(state.copies[0].to).toMatch(new RegExp(`^custom-pips:${ME}/sym-[0-9a-f-]{36}\\.png$`));
    const [fire, bug] = inserts();
    expect(fire).toEqual({
      owner_id: ME,
      code: "FIRE",
      name: "FIRE name",
      mana_value: 3,
      base_color: "R",
      image_url: expect.stringMatching(new RegExp(`^${pubUrl(ME, "sym-")}[0-9a-f-]{36}\\.png\\?v=\\d+$`)),
      source: "upload",
    });
    expect(bug).toMatchObject({ owner_id: ME, code: "BUG", mana_value: 0, base_color: null });
  });

  it("does nothing for the remixer's own card, or a remix naming none of the parent's codes", async () => {
    expect(await adoptRemixSymbols(ME, { ...parent, owner_id: ME }, { cost: "{*FIRE}" })).toMatchObject({ ok: true, notice: null });
    expect(await adoptRemixSymbols(ME, parent, { cost: "{1}{R}", rules_text: "{*NEW}" })).toMatchObject({ ok: true, notice: null });
    expect(state.chain!.log).toHaveLength(0);
    expect(state.limitChecks).toBe(0);
  });

  it("keeps the remixer's own symbol on a clash and says so — nothing copied, no upload counted", async () => {
    state.mine = [{ code: "FIRE" }, { code: "BUG" }];
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}{*BUG}" });
    expect(result).toMatchObject({ ok: true, notice: { copied: [], copiedRemoved: [], keptYours: ["FIRE", "BUG"] } });
    expect(state.copies).toHaveLength(0);
    expect(state.limitChecks).toBe(0);
  });

  it("copies a symbol its maker removed (their card still draws it)", async () => {
    state.theirs = [symbolRow("FIRE", PIC1, { deleted_at: "2026-11-02T00:00:00Z" })];
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" });
    expect(result).toMatchObject({ ok: true, notice: { copied: ["FIRE"] } });
    expect(inserts()[0]).not.toHaveProperty("deleted_at");
  });

  it("at the remixer's 20 live symbols keeps the copy as removed", async () => {
    state.inserts = [{ error: { message: "custom_symbol_limit: at most 20 symbols", code: "23514" } }, { data: { id: "kept" } }];
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" });
    expect(result).toMatchObject({ ok: true, notice: { copied: [], copiedRemoved: ["FIRE"] } });
    expect(inserts()[1]).toMatchObject({ code: "FIRE", deleted_at: expect.any(String) });
  });

  it("at 60 rows refuses, taking back the copies before it", async () => {
    state.inserts = [{ data: { id: "first" } }, { error: { message: "custom_symbol_row_limit: at most 60 symbols", code: "23514" } }];
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}{*BUG}" });
    expect(result).toEqual({ ok: false, error: REMIX_SYMBOLS_FULL_MESSAGE });
    const deleted = state.chain!.forTable("custom_symbols").find((e) => e.calls.some((c) => c.method === "delete"));
    expect(deleted?.calls.find((c) => c.method === "in")?.args).toEqual(["id", ["first"]]);
    // Both copied pictures are gone: the refused one at once, the first by the undo.
    expect(state.removed.flat()).toHaveLength(2);
  });

  it("treats a code made meanwhile (unique clash) as the remixer's own", async () => {
    state.inserts = [{ error: { message: "duplicate key value", code: "23505" } }];
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" });
    expect(result).toMatchObject({ ok: true, notice: { copied: [], keptYours: ["FIRE"] } });
    expect(state.removed.flat()).toHaveLength(1);
  });

  it("refuses when a picture can't be copied, or the symbols can't be read", async () => {
    state.copyError = { message: "Object not found" };
    expect(await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" })).toEqual({ ok: false, error: REMIX_SYMBOLS_FAILED_MESSAGE });
    expect(inserts()).toHaveLength(0);
    state.copyError = null;
    state.readError = { message: "boom" };
    expect(await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" })).toEqual({ ok: false, error: REMIX_SYMBOLS_FAILED_MESSAGE });
  });

  it("is held by the upload rate limit", async () => {
    state.limited = true;
    expect(await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" })).toMatchObject({ ok: false, code: "UPLOAD_RATE_LIMITED" });
    expect(state.copies).toHaveLength(0);
  });

  it("never copies a picture outside the parent owner's own folder", async () => {
    state.theirs = [symbolRow("FIRE", PIC1, { image_url: pubUrl(ME, PIC1) })];
    expect(await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" })).toMatchObject({ ok: true, notice: null });
    expect(state.copies).toHaveLength(0);
  });

  it("its undo takes the copies back (rows and pictures)", async () => {
    const result = await adoptRemixSymbols(ME, parent, { cost: "{*FIRE}" });
    if (!result.ok) throw new Error("expected ok");
    await result.undo();
    const deleted = state.chain!.forTable("custom_symbols").find((e) => e.calls.some((c) => c.method === "delete"));
    expect(deleted?.calls.find((c) => c.method === "in")?.args).toEqual(["id", ["new-0"]]);
    expect(state.removed.flat()).toEqual([expect.stringMatching(new RegExp(`^${ME}/sym-`))]);
  });
});

describe("wiring", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("createCardAction copies before its symbol check, and takes the copies back when the card isn't saved", () => {
    const source = read("lib/cards/actions.ts");
    const create = source.slice(source.indexOf("export async function createCardAction"), source.indexOf("export async function updateCardAction"));
    const copy = create.indexOf("await adoptRemixSymbols(user.id, parent, insert)");
    const check = create.indexOf("await unknownSymbolFieldError(supabase, user.id, insert, null)");
    expect(copy).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(copy);
    expect(create).toMatch(/if \(parent && parent\.owner_id !== user\.id\)/);
    expect(create).toMatch(/if \(unknownSymbol\) \{\s*await remixSymbols\?\.undo\(\);/);
    expect(create).toMatch(/if \(error \|\| !row\) await remixSymbols\?\.undo\(\);/);
    expect(create).toContain("remixSymbols: remixSymbols.notice");
  });

  it("the remix page shows the parent's symbols, and the creator says what the save did", () => {
    const page = read("app/(app)/create/page.tsx");
    expect(page).toMatch(/remixParent && remixParent\.owner_id !== user\.id \? symbolCodesNamedBy\(remixParent\)/);
    expect(page).toContain("readOwnerSymbolsOf([remixParent.owner_id])");
    expect(page).toContain("withRemixParentSymbols(");
    const form = read("components/creator/card-creator-form.tsx");
    expect(form).toContain("remixSymbolsMessage(result.remixSymbols)");
  });
});
