import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importMergeKey, MAX_DECK_ENTRIES, type ImportEntry } from "@/lib/decks/import-plan";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { SCRYFALL_LIMITS } from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// The app's half of the deck-entry contract, held to migration 0143 (whose
// own test, tests/unit/db/deck-counts-migration.test.ts, ships with the
// migration and imports nothing from the app):
//   * MAX_DECK_ENTRIES is the cap the SQL states;
//   * importMergeKey is the key import_deck_entries merges on;
//   * every field an ImportEntry carries is a column the RPC inserts, and
//     nothing else is;
//   * the quantity clamp is the entry maximum;
//   * every Scryfall action the app logs is one the CHECK accepts.
// ---------------------------------------------------------------------------

const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(
  readFileSync(join(process.cwd(), "supabase/migrations/0143_deck_counts_and_counter_guards.sql"), "utf8"),
);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const IMPORT_RPC = squash(/create or replace function public\.import_deck_entries\([\s\S]*?\$\$;/.exec(SQL)?.[0] ?? "");

describe("the app's deck-entry contract matches 0143", () => {
  it("one cap", () => {
    expect([...SQL.matchAll(/at most (\d+) entries/g)].map((m) => Number(m[1]))).toContain(MAX_DECK_ENTRIES);
    expect(new Set([...SQL.matchAll(/at most (\d+) entries/g)].map((m) => Number(m[1])))).toEqual(
      new Set([MAX_DECK_ENTRIES]),
    );
  });

  it("one merge key: board + Scryfall id, else board + the trimmed, lower-cased name", () => {
    expect(importMergeKey({ board: "main", scryfall_id: null, name: " Bolt " })).toBe("main|name:bolt");
    expect(importMergeKey({ board: "side", scryfall_id: "abc", name: "x" })).toBe("side|abc");
    expect(IMPORT_RPC).toContain("group by e.board, coalesce(e.scryfall_id, 'name:' || lower(btrim(e.name)))");
  });

  it("the RPC inserts exactly an ImportEntry's fields (plus the deck and the position)", () => {
    const cols = /insert into public\.deck_cards \( ([^)]*) \)/.exec(IMPORT_RPC)?.[1].split(",").map((c) => c.trim());
    const entry: Record<keyof ImportEntry, true> = {
      board: true,
      quantity: true,
      name: true,
      scryfall_id: true,
      set_code: true,
      collector_number: true,
      type_line: true,
      mana_cost: true,
      mana_value: true,
      color_identity: true,
      rarity: true,
      image_url: true,
    };
    expect(new Set(cols)).toEqual(new Set(["deck_id", "position", ...Object.keys(entry)]));
  });

  it("merges clamp to the entry maximum", () => {
    expect(IMPORT_RPC).toContain(`least(dc.quantity + m.added, ${MAX_ENTRY_QUANTITY})`);
  });

  it("every Scryfall action the app rate-limits is one scryfall_calls accepts", () => {
    const check = /add constraint scryfall_calls_action_check\s+check \(action in \(([^)]*)\)\)/.exec(SQL)?.[1] ?? "";
    const allowed = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(Object.keys(SCRYFALL_LIMITS).sort());
  });
});
