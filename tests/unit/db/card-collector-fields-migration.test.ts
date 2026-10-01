import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARD_LANG_VALUES,
  COLLECTOR_NUMBER_MAX,
  COLLECTOR_NUMBER_PATTERN,
  DEFAULT_CARD_LANG,
  PRINTED_LANGS,
  SET_CODE_PATTERN,
  isCardLang,
  normalizeSetCode,
  printedLangCode,
} from "@/lib/cards/collector-fields";
import {
  cardCollectorNumberSchema,
  cardLangSchema,
  cardSetCodeSchema,
  createCardSchema,
  updateCardSchema,
} from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// TODO 4.9a — the collector fields. The DB CHECKs (cards_set_code_format,
// cards_collector_number_format, cards_lang_valid; migration
// *_card_collector_fields.sql — found by name so a renumber at rebase
// doesn't break this) and the shared zod schemas must agree: the same
// pattern, the same length, the same 18 languages and the same default.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_card_collector_fields\.sql$/.test(f));

const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

/** The regex source inside `column ~ '…'`. */
const sqlPattern = (column: string): string =>
  new RegExp(`${column}\\s+~\\s+'([^']+)'`).exec(body)?.[1] ?? "";

describe("the collector fields migration", () => {
  it("has its migration", () => {
    expect(file).toBeDefined();
  });

  it("adds the three columns idempotently; lang is NOT NULL, English by default", () => {
    expect(body).toMatch(/add column if not exists set_code text/);
    expect(body).toMatch(/add column if not exists collector_number text/);
    expect(body).toMatch(new RegExp(`add column if not exists lang text not null default '${DEFAULT_CARD_LANG}'`));
  });

  it("the set-code CHECK is the app's pattern", () => {
    expect(sqlPattern("set_code")).toBe(SET_CODE_PATTERN.source);
    expect(body).toMatch(/drop constraint if exists cards_set_code_format/);
    expect(body).toMatch(/add constraint cards_set_code_format/);
    expect(body).toMatch(/set_code is null or set_code ~/);
  });

  it("the collector-number CHECK is the app's pattern and length", () => {
    expect(sqlPattern("collector_number")).toBe(COLLECTOR_NUMBER_PATTERN.source);
    const length = /char_length\(collector_number\)\s+between\s+1\s+and\s+(\d+)/.exec(body);
    expect(Number(length?.[1])).toBe(COLLECTOR_NUMBER_MAX);
    expect(COLLECTOR_NUMBER_MAX).toBe(12);
    expect(body).toMatch(/drop constraint if exists cards_collector_number_format/);
    expect(body).toMatch(/add constraint cards_collector_number_format/);
  });

  it("the lang CHECK names exactly Scryfall's 18 codes, as CARD_LANG_VALUES does", () => {
    const list = /lang\s+in\s*\(([^)]*)\)/i.exec(body)?.[1] ?? "";
    const values = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(values).toHaveLength(18);
    expect(values).toEqual([...CARD_LANG_VALUES]);
    expect(body).toMatch(/drop constraint if exists cards_lang_valid/);
    expect(body).toMatch(/add constraint cards_lang_valid/);
  });

  it("comments the columns and states its grants; no new object, no data", () => {
    expect(body).toMatch(/comment on column public\.cards\.set_code is/);
    expect(body).toMatch(/comment on column public\.cards\.collector_number is/);
    expect(body).toMatch(/comment on column public\.cards\.lang is/);
    // The printed-code warning: not deck_cards.set_code.
    expect(body).toMatch(/deck_cards\.set_code/);
    expect(sql).toMatch(/Grants: none/);
    expect(body.match(/^\s*(grant|revoke|create|update|insert|delete)\b/gim)).toBeNull();
  });
});

describe("zod ⇄ CHECK parity", () => {
  const setCodeSql = new RegExp(sqlPattern("set_code"));
  const numberSql = new RegExp(sqlPattern("collector_number"));
  const langSql = new Set([...(/lang\s+in\s*\(([^)]*)\)/i.exec(body)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

  it.each([
    ["DMU", "DMU"],
    ["dmu", "DMU"], // upper-cased before the check, so the stored value passes
    [" fdn ", "FDN"],
    ["PRM", "PRM"],
    ["C17", "C17"],
    ["PLST", "PLST"],
    ["PMPS11", "PMPS11"],
  ])("set code %j stores as %j and passes the CHECK", (input, stored) => {
    const parsed = cardSetCodeSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBe(stored);
    expect(setCodeSql.test(stored)).toBe(true);
    expect(normalizeSetCode(input)).toBe(stored);
  });

  it.each(["A", "ABCDEFG", "DM-U", "DM U", "dm.u", "★"])("set code %j fails both", (input) => {
    expect(cardSetCodeSchema.safeParse(input).success).toBe(false);
    expect(setCodeSql.test(input.trim().toUpperCase())).toBe(false);
  });

  it.each(["107", "107/281", "1/16", "237a", "H13", "XLN-117", "★", "265★", "†", "1".repeat(12)])(
    "collector number %j passes both",
    (input) => {
      expect(cardCollectorNumberSchema.safeParse(input).success).toBe(true);
      expect(numberSql.test(input) && input.length <= COLLECTOR_NUMBER_MAX).toBe(true);
    },
  );

  it.each(["", "1 2", "1".repeat(13), "107/281 M", "№7", "1.5"])("collector number %j fails both", (input) => {
    expect(cardCollectorNumberSchema.safeParse(input).success).toBe(false);
    expect(numberSql.test(input) && input.length >= 1 && input.length <= COLLECTOR_NUMBER_MAX).toBe(false);
  });

  it("the 18 languages pass both; anything else fails both", () => {
    for (const lang of CARD_LANG_VALUES) {
      expect(cardLangSchema.safeParse(lang).success, lang).toBe(true);
      expect(langSql.has(lang), lang).toBe(true);
      expect(isCardLang(lang)).toBe(true);
    }
    for (const bad of ["EN", "xx", "", "english", "zh"]) {
      expect(cardLangSchema.safeParse(bad).success, bad).toBe(false);
      expect(langSql.has(bad), bad).toBe(false);
      expect(isCardLang(bad)).toBe(false);
    }
  });

  it("null clears a code or number; the language has no null (NOT NULL) and is optional", () => {
    expect(cardSetCodeSchema.safeParse(null)).toEqual({ success: true, data: null });
    expect(cardCollectorNumberSchema.safeParse(null)).toEqual({ success: true, data: null });
    expect(cardLangSchema.safeParse(null).success).toBe(false);
    expect(cardLangSchema.safeParse(undefined)).toEqual({ success: true, data: undefined });
  });

  it("the create and update card schemas carry the three fields", () => {
    const base = { title: "Sheoldred, the Apocalypse", game_system_id: "33333333-3333-4333-8333-333333333333" };
    const created = createCardSchema.safeParse({ ...base, set_code: "dmu", collector_number: "107/281", lang: "es" });
    expect(created.success, JSON.stringify(created.error?.issues)).toBe(true);
    expect(created.data).toMatchObject({ set_code: "DMU", collector_number: "107/281", lang: "es" });
    // Omitted = untouched on update; a bad value is a field error.
    const untouched = updateCardSchema.safeParse({ title: "x" });
    expect(untouched.success).toBe(true);
    expect(untouched.data).not.toHaveProperty("set_code");
    expect(untouched.data).not.toHaveProperty("lang");
    const bad = updateCardSchema.safeParse({ set_code: "toolongcode", lang: "xx" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.map((i) => i.path[0]).sort()).toEqual(["lang", "set_code"]);
  });
});

describe("the printed language codes (4.9 design §1.1, scan-verified)", () => {
  it("twelve printed codes: es prints SP and ko prints KR", () => {
    expect(PRINTED_LANGS.map((l) => `${l.code}:${l.printed}`)).toEqual([
      "en:EN", "es:SP", "fr:FR", "de:DE", "it:IT", "pt:PT",
      "ja:JP", "ko:KR", "ru:RU", "zhs:CS", "zht:CT", "ph:PH",
    ]);
    expect(printedLangCode("es")).toBe("SP");
    expect(printedLangCode("ko")).toBe("KR");
  });

  it("the six without a verified printed code are stored but print nothing", () => {
    for (const lang of ["he", "la", "grc", "ar", "sa", "qya"]) {
      expect(isCardLang(lang), lang).toBe(true);
      expect(printedLangCode(lang), lang).toBeNull();
    }
    expect(printedLangCode(null)).toBeNull();
  });
});

describe("the dev seed (TODO 4.9a)", () => {
  const seed = readFileSync(join(process.cwd(), "supabase/seeds/10_dev_data.sql"), "utf8");

  it("gives previews the five collector cases: a 2015 rare, FDN #1, a Spanish card, a token and an empty-fields imported card", () => {
    // The 2c block: (id, title, slug, cost, colors, supertype, card_type,
    // subtypes, rarity, rules, power, toughness, art, template,
    // set_code, collector_number, lang, source_scryfall_id, tags, age).
    const block = /-- 2c\.[\s\S]*?on conflict \(id\) do nothing;/.exec(seed)?.[0] ?? "";
    expect(block).not.toBe("");
    expect(block).toMatch(/'DMU', '107\/281', 'en'/);
    expect(block).toMatch(/'FDN', '1', 'en'/);
    expect(block).toMatch(/'DMU', '42\/281', 'es'/);
    expect(block).toMatch(/'token', [^\n]*\n[^\n]*\n[^\n]*'DOM', '1\/16', 'en'/);
    // Empty fields on a card imported from a real printing: the "Fill from
    // the printing" offer has something to fill from.
    expect(block).toMatch(/null, null, 'en', 'd67be074-cdd4-41d9-ac89-0a0456c4e4b2'/);
    // Unlisted, so the seeded public gallery keeps its one 24-card page.
    expect(block).toMatch(/'unlisted'/);
    expect(block).not.toMatch(/'public'/);
  });
});
