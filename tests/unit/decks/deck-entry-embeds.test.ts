import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// An embedded read between `decks` and `deck_cards` names its foreign key.
//
// 2026-11-13 (production): migration 0209 added `deck_reart_prompts`, keyed
// on (deck_id, entry_id) — two foreign keys, to decks and to deck_cards,
// that together were its PRIMARY KEY. The database API (PostgREST) reads a
// table shaped like that as a many-to-many link between the two tables, so
// decks and deck_cards had TWO relationships, and every embedded read that
// named neither was refused as ambiguous (PGRST201). Three reads did:
//
//   * every deck tile's colours and fan  — lib/decks/tile-art.ts
//   * Bulk Customize's deck entries      — lib/tools/bulk-customize/server.ts
//   * Re-art deck's step                 — lib/tools/re-art/step.ts
//
// No unit test saw it (they mock the client) and each read swallowed its
// error: the tiles drew their default cover, the tools said "skipped" and
// "no longer in your deck". Migration 0210 took the table's link shape away;
// THIS test keeps the app's reads independent of the schema's shape: a read
// from `decks` that embeds `deck_cards`, or from `deck_cards` that embeds
// `decks`, says `!deck_cards_deck_id_fkey` — the one direct link.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const FKEY = "deck_cards_deck_id_fkey";
const PAIR: Record<string, string> = { decks: "deck_cards", deck_cards: "decks" };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

type Embed = { file: string; line: number; from: string; embed: string; hints: string };

/** Every embed of `decks` / `deck_cards` in a `.select(` that follows a
 *  `.from("decks" | "deck_cards")` of the OTHER table, comments left out. */
function embedsIn(file: string, text: string): Embed[] {
  // Comment lines say table names too ("deck_cards (the entries)…").
  const code = text
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line))
    .join("\n");
  const found: Embed[] = [];
  const from = /\.from\(\s*["'`](decks|deck_cards)["'`]\s*\)/g;
  for (let start = from.exec(code); start; start = from.exec(code)) {
    // The statement: up to the next `.from(` (or 1,500 characters).
    const rest = code.slice(start.index + start[0].length);
    const next = rest.search(/\.from\(/);
    const statement = rest.slice(0, Math.min(next === -1 ? rest.length : next, 1500));
    const other = PAIR[start[1]];
    // A hint is a constraint, a column or a join word: letters, digits, "_".
    const embed = new RegExp(`(?<![\\w.])${other}((?:![A-Za-z0-9_]+)*)\\s*\\(`, "g");
    for (let hit = embed.exec(statement); hit; hit = embed.exec(statement)) {
      const at = start.index + start[0].length + hit.index;
      found.push({
        file: relative(ROOT, file),
        line: code.slice(0, at).split("\n").length,
        from: start[1],
        embed: other,
        hints: hit[1],
      });
    }
  }
  return found;
}

const embeds = ["lib", "app", "components", "scripts"]
  .flatMap((dir) => sourceFiles(join(ROOT, dir)))
  .flatMap((file) => embedsIn(file, readFileSync(file, "utf8")));

describe("embedded reads between decks and deck_cards", () => {
  it("the scan finds the reads the incident broke", () => {
    const files = new Set(embeds.map((embed) => embed.file));
    for (const file of ["lib/decks/tile-art.ts", "lib/tools/bulk-customize/server.ts", "lib/tools/re-art/step.ts"]) {
      expect(files, `${file} embeds no deck entry any more — update this test's list`).toContain(file);
    }
  });

  it("each names the one direct foreign key", () => {
    const unnamed = embeds.filter((embed) => !embed.hints.split("!").includes(FKEY));
    expect(
      unnamed.map((embed) => `${embed.file}:${embed.line} — .from("${embed.from}") embeds ${embed.embed}${embed.hints}( without !${FKEY}`),
    ).toEqual([]);
  });

  it("the scan reads an embed as the API would", () => {
    const sample = (select: string, table = "deck_cards") => embedsIn("x.ts", `supabase.from("${table}").select(${select}).eq("id", id)`);
    // Unnamed, with a join hint only, aliased: all found, none passes.
    expect(sample('"id, decks(owner_id)"')).toMatchObject([{ embed: "decks", hints: "" }]);
    expect(sample('"id, decks!inner(owner_id)"')).toMatchObject([{ hints: "!inner" }]);
    expect(sample('"id, deck:decks!inner(owner_id)"')).toMatchObject([{ hints: "!inner" }]);
    // A hint with digits or capitals is still read whole — and still isn't the key.
    expect(sample('"id, decks!Deck_Cards_fk2!inner(owner_id)"')).toMatchObject([{ hints: "!Deck_Cards_fk2!inner" }]);
    expect(sample("`id, deck_cards(${columns})`", "decks")).toMatchObject([{ embed: "deck_cards", hints: "" }]);
    // Named: found, and it passes.
    expect(sample('"id, decks!deck_cards_deck_id_fkey!inner(owner_id)"')).toMatchObject([{ hints: `!${FKEY}!inner` }]);
    // Another table's embed, a column that ends in the name, a comment: not this test's.
    expect(sample('"id, card:cards(id)"')).toEqual([]);
    expect(sample('"id, my_decks(id)"')).toEqual([]);
    expect(embedsIn("x.ts", '// supabase.from("deck_cards").select("id, decks(owner_id)")')).toEqual([]);
    // A read from another table that embeds decks has ONE relationship: left alone.
    expect(embedsIn("x.ts", 'supabase.from("deck_theme_decks").select("deck_id, decks(title)")')).toEqual([]);
  });
});
