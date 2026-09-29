import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formSupertypeOf } from "@/lib/creator/card-fields";
import { buildTypeLine, printsPowerToughness, showsPowerToughness } from "@/lib/cards/card-display";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3b.15 — migration *_token_creature_word.sql (found by name so a
// renumber at rebase doesn't break this). A stored token with a P/T and no
// Creature / Artifact / Enchantment word gains "Creature", the same word the
// creator reads onto it (formSupertypeOf) and the renderers print it by
// (printsPowerToughness). The same rows get a null render stamp, so the
// automatic re-bake draws them WITH the word whichever of the migration and
// the v34 deploy goes live first; no render column, no grant changes.
//
// The UPDATE was also run on 2026-09-29 against a TEMP copy of the columns
// inside a rolled-back transaction (the local stack's Postgres 17, with the
// cards_supertype_length CHECK): UPDATE 8 on the rows below (every row whose
// `after` differs), each of them left with a null layout_version and every
// other row with its stamp, then UPDATE 0 on a second run. ROWS pins what it
// wrote; the test holds the app's rule to the same answers.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_token_creature_word\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const statements = body
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter(Boolean);

type Row = {
  card_type: string;
  supertype: string | null;
  power: string | null;
  toughness: string | null;
  /** What the migration left in supertype (the Postgres run). */
  after: string | null;
};

const ROWS: Row[] = [
  { card_type: "token", supertype: null, power: "1", toughness: "1", after: "Creature" },
  { card_type: "token", supertype: "", power: "2", toughness: "2", after: "Creature" },
  { card_type: "token", supertype: "Legendary", power: "5", toughness: "5", after: "Legendary Creature" },
  { card_type: "token", supertype: "Artifact", power: null, toughness: null, after: "Artifact" },
  { card_type: "token", supertype: "Artifact", power: "1", toughness: "1", after: "Artifact" },
  { card_type: "token", supertype: "creature", power: "1", toughness: "1", after: "creature" },
  { card_type: "token", supertype: "Basic", power: null, toughness: null, after: "Basic" },
  { card_type: "token", supertype: "Legendary  Snow ", power: "0", toughness: "3", after: "Legendary Snow Creature" },
  { card_type: "creature", supertype: null, power: "2", toughness: "2", after: null },
  { card_type: "token", supertype: null, power: "", toughness: "", after: null },
  { card_type: "token", supertype: null, power: null, toughness: "3", after: "Creature" },
  { card_type: "token", supertype: "Enchantment", power: "1", toughness: "1", after: "Enchantment" },
  { card_type: "token", supertype: "Land", power: "1", toughness: "1", after: "Land Creature" },
  // 56 + " Creature" = 65 > the 64-character CHECK: skipped, not failed.
  { card_type: "token", supertype: "x".repeat(56), power: "1", toughness: "1", after: "x".repeat(56) },
  { card_type: "token", supertype: "x".repeat(55), power: "1", toughness: "1", after: `${"x".repeat(55)} Creature` },
  { card_type: "token", supertype: "Creatures", power: "1", toughness: "1", after: "Creatures Creature" },
];

describe("0124 — stored creature tokens gain \"Creature\"", () => {
  it("has its migration, numbered 0124", () => {
    expect(file).toBe("0124_token_creature_word.sql");
  });

  it("is one UPDATE of public.cards — no DDL, no grants; it nulls the changed rows' render stamp", () => {
    expect(statements).toHaveLength(1);
    const [stmt] = statements;
    expect(stmt).toMatch(/^update public\.cards set supertype = /i);
    expect(stmt).not.toMatch(/\b(create|alter|drop|grant|revoke|delete|insert|truncate)\b/i);
    // The SET clause writes the word AND a null stamp on the same rows: a
    // v34 bake made before the word (the deploy went live first) is owed
    // again, and the automatic re-bake (0120) redraws it with "Creature".
    const set = stmt.slice(0, stmt.toLowerCase().indexOf(" where "));
    expect(set).toMatch(/,\s*layout_version = null$/i);
    // The stored render stays until that re-bake replaces it.
    expect(stmt).not.toMatch(/rendered_image_url|rendered_thumb_url|rendered_at/i);
    expect(sql).toMatch(/Grants: none/);
    expect(sql).toMatch(/Ships through a PR; never applied ad-hoc\./);
  });

  it("scopes to tokens with a P/T and no type word, within the supertype CHECK", () => {
    const [stmt] = statements;
    const where = stmt.slice(stmt.toLowerCase().indexOf(" where "));
    expect(where).toContain("card_type = 'token'");
    expect(where).toContain("(coalesce(power, '') <> '' or coalesce(toughness, '') <> '')");
    expect(where).toContain("coalesce(supertype, '') !~* '(^|\\s)(creature|artifact|enchantment)(\\s|$)'");
    expect(where).toMatch(/char_length\(.*\) <= 64$/);
    // The header names the public count it was written against.
    expect(sql).toMatch(/8 have a P\/T\s+-- and no type word/);
  });

  // The app's reading of the same rows: the word the creator puts on a
  // stored token is the word the migration writes, and nothing prints a
  // different P/T after it than before it.
  const norm = (value: string) => value.replace(/\s+/g, " ").trim();
  const TOO_LONG = "x".repeat(56);
  for (const [index, row] of ROWS.entries()) {
    it(`row ${index + 1}: ${row.card_type} ${JSON.stringify(row.supertype)} ${row.power ?? "-"}/${row.toughness ?? "-"}`, () => {
      const migrated = row.after ?? row.supertype;
      const read = formSupertypeOf({ ...row, card_type: row.card_type as Card["card_type"] });
      if (row.supertype === TOO_LONG) {
        // Past the CHECK the migration skips it; the creator still reads
        // the word (and a save would be refused on length, as today).
        expect(migrated).toBe(TOO_LONG);
        expect(read).toBe(`${TOO_LONG} Creature`);
      } else {
        expect(norm(read)).toBe(norm(migrated ?? ""));
      }
      const face = { cardType: row.card_type as Card["card_type"], power: row.power, toughness: row.toughness };
      expect(printsPowerToughness({ ...face, supertype: migrated })).toBe(
        printsPowerToughness({ ...face, supertype: row.supertype }),
      );
      // A row the migration changed now shows its P/T inputs in the creator.
      if (migrated !== row.supertype && row.card_type === "token") {
        expect(showsPowerToughness("token", [], migrated)).toBe(true);
      }
    });
  }

  it("the 8 public rows print \"Token Creature — …\" with their P/T once migrated", () => {
    // Production 2026-09-29: e.g. Stalbokoblin (bokoblin et squelette) 3/1,
    // Prize Pig (Boar) 0/3, Samurai 1/1 — all with an empty supertype.
    for (const [subtypes, power, toughness] of [
      [["bokoblin et squelette"], "3", "1"],
      [["Boar"], "0", "3"],
      [[], "1", "1"],
    ] as const) {
      const face = { cardType: "token" as const, supertype: "Creature", subtypes: [...subtypes], power, toughness };
      expect(printsPowerToughness(face)).toBe(true);
      expect(buildTypeLine(face)).toBe(subtypes.length ? `Token Creature — ${subtypes.join(" ")}` : "Token Creature");
    }
  });
});
