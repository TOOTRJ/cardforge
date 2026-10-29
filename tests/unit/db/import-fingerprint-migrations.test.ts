import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_FINGERPRINT_FIELDS } from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// A platform migration must not turn untouched imports "Edited" (TODO DK2.5,
// the review of #664, F4). The import fingerprint
// (lib/cards/import-fingerprint.ts) covers every field a maker can set, so a
// SQL data fix that rewrites one of them on stored cards — 0128 (a token's
// supertype), 0129 (a token's frame), 0142 (`frame_style.selfName`) were
// exactly that — would flip every untouched import it touches to Edited.
// SQL can't compute the hash, so the rule (CLAUDE.md "Decks") is: a SQL
// migration rewrites only rows `where import_fingerprint is null`, and the
// fingerprinted ones are left to a service-role script that calls
// fingerprintAfterRewrite.
//
// This guard reads every migration numbered ABOVE 0144 (the one that added
// the fingerprint) and fails on an `UPDATE public.cards` whose SET names a
// fingerprinted column unless the statement says `import_fingerprint is
// null`, or a comment `-- import-fingerprint: exempt — <why>` sits in the 5
// lines above it (a column the fingerprint skips for that write, a table of
// cards that holds no fingerprinted rows yet…).
//
// A HEURISTIC — its limits:
//   * it reads text, not SQL: an UPDATE built with `execute format(...)`, a
//     function or trigger defined here and run later, `INSERT … ON CONFLICT
//     DO UPDATE`, a multi-column `set (a, b) = (…)` or a column quoted with
//     odd casing is not seen;
//   * `import_fingerprint is null` anywhere in the statement counts, even in
//     a branch that doesn't guard the write;
//   * jsonb writes are judged by the column (`frame_style = …`), never by
//     the key inside it.
// It catches the plain data fix, which is what the three migrations above
// were; anything cleverer is the reviewer's to check.
// ---------------------------------------------------------------------------

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FIRST_GUARDED = 145;
const FINGERPRINTED = new Set<string>(IMPORT_FINGERPRINT_FIELDS);

type Finding = { line: number; columns: string[] };

/** The statement starting at `from`, up to its `;` (quotes and parens aware). */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === ";" && depth <= 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/** The SET clause's assigned columns (top-level commas only). */
function setColumns(statement: string): string[] {
  const set = /\bset\b/i.exec(statement);
  if (!set) return [];
  const body = statement.slice(set.index + 3);
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && (ch === "," || ch === ";")) {
      parts.push(body.slice(start, i));
      start = i + 1;
      if (ch === ";") break;
    } else if (depth === 0 && /^\s(where|from|returning)\b/i.test(body.slice(i))) {
      parts.push(body.slice(start, i));
      break;
    }
  }
  return parts
    .map((part) => /^\s*"?([a-z_][a-z0-9_]*)"?\s*=(?!=)/i.exec(part)?.[1]?.toLowerCase() ?? null)
    .filter((column): column is string => column !== null);
}

/** Every unguarded UPDATE of a fingerprinted cards column in `sql`. */
function unguardedCardRewrites(sql: string): Finding[] {
  const lines = sql.split("\n");
  const out: Finding[] = [];
  const pattern = /\bupdate\s+(?:only\s+)?(?:public\.)?cards\b/gi;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    const line = sql.slice(0, match.index).split("\n").length;
    // Inside a comment line: not SQL.
    if (/^\s*--/.test(lines[line - 1] ?? "")) continue;
    const statement = statementAt(sql, match.index);
    const columns = setColumns(statement).filter((column) => FINGERPRINTED.has(column));
    if (columns.length === 0) continue;
    if (/import_fingerprint\s+is\s+null/i.test(statement)) continue;
    const above = lines.slice(Math.max(0, line - 6), line - 1).join("\n");
    if (/--\s*import-fingerprint:\s*exempt\b/i.test(above) || /--\s*import-fingerprint:\s*exempt\b/i.test(statement)) continue;
    out.push({ line, columns });
  }
  return out;
}

const numbered = readdirSync(MIGRATIONS)
  .map((file) => ({ file, n: Number(/^(\d{4})_/.exec(file)?.[1] ?? NaN) }))
  .filter((entry) => Number.isFinite(entry.n));

describe("migrations after 0144 never flip untouched imports to Edited", () => {
  it("no UPDATE of a fingerprinted cards column without `import_fingerprint is null` (or a stated exemption)", () => {
    const offenders = numbered
      .filter((entry) => entry.n >= FIRST_GUARDED)
      .flatMap((entry) =>
        unguardedCardRewrites(readFileSync(join(MIGRATIONS, entry.file), "utf8")).map(
          (finding) => `${entry.file}:${finding.line} sets ${finding.columns.join(", ")}`,
        ),
      );
    expect(offenders, "rewrite only `where import_fingerprint is null` rows; the rest go through fingerprintAfterRewrite (CLAUDE.md \"Decks\")").toEqual([]);
  });
});

describe("the heuristic itself", () => {
  const file = (prefix: string) => {
    const found = numbered.find((entry) => entry.file.startsWith(prefix));
    if (!found) throw new Error(`no migration ${prefix}`);
    return readFileSync(join(MIGRATIONS, found.file), "utf8");
  };

  it("catches the three data fixes that predate the rule (0128, 0129, 0142)", () => {
    expect(unguardedCardRewrites(file("0128_")).flatMap((f) => f.columns)).toContain("supertype");
    expect(unguardedCardRewrites(file("0129_")).flatMap((f) => f.columns)).toContain("frame_style");
    expect(unguardedCardRewrites(file("0142_")).flatMap((f) => f.columns)).toContain("frame_style");
  });

  it("passes a guarded rewrite, an exempted one, and a rewrite of columns the fingerprint skips", () => {
    expect(
      unguardedCardRewrites(
        "update public.cards\nset frame_style = frame_style || '{\"x\": 1}'::jsonb, layout_version = null\nwhere card_type = 'token' and import_fingerprint is null;",
      ),
    ).toEqual([]);
    expect(
      unguardedCardRewrites(
        "-- import-fingerprint: exempt — no card holds a fingerprint yet on this path\nupdate public.cards set rarity = 'common' where id = '0';",
      ),
    ).toEqual([]);
    expect(unguardedCardRewrites("update public.cards set layout_version = null, rendered_image_url = null where true;")).toEqual([]);
    expect(unguardedCardRewrites("update public.cards_guard set title = 'x';")).toEqual([]);
  });

  it("reads the SET clause past nested calls and commas", () => {
    expect(
      unguardedCardRewrites(
        "update cards c set\n  layout_version = null,\n  frame_style = jsonb_set(frame_style, '{template}', to_jsonb('m15'::text), true),\n  rarity = coalesce(rarity, 'common')\nwhere c.card_type = 'land';",
      ).flatMap((f) => f.columns),
    ).toEqual(["frame_style", "rarity"]);
  });
});
