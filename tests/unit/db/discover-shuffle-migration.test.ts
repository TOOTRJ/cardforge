import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The weighted shuffle (Discover, lib/cards/discover.ts) orders by
// -ln(u) / weight, which needs u uniform in (0, 1). 0086 hashed u as
// (bits + 2147483648.0) / 4294967296.0, as if `bit(32)::bigint` were signed —
// it is UNSIGNED (0 … 2³²−1), so u fell in [0.5, 1.5), -ln(u) went negative
// for half the cards and a heavier weight sorted LATER. 0158 corrects
// list_gallery_cards() (found by name, so a renumber at rebase doesn't break
// this); the last block holds EVERY function's live definition to the
// (0, 1) range, so a copy of the old line in a later migration fails here.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const migrations = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const file = migrations.find((f) => /^\d{4}_gallery_discover_shuffle_fix\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

function withoutComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/** A function's definition in a migration, `create or replace` through `$$;`. */
function fnDefinition(text: string, name: string): string {
  const from = text.indexOf(`create or replace function public.${name}(`);
  return from < 0 ? "" : text.slice(from, text.indexOf("$$;", from) + 3);
}

/** Every function's LAST definition across the migrations, by name. */
function liveDefinitions(): Map<string, { file: string; body: string }> {
  const live = new Map<string, { file: string; body: string }>();
  for (const f of migrations) {
    const text = withoutComments(readFileSync(join(dir, f), "utf8"));
    for (const m of text.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)) {
      live.set(m[1], { file: f, body: fnDefinition(text, m[1]) });
    }
  }
  return live;
}

const TWO_32 = 2 ** 32;
const U_DRAW = /::bit\(32\)::bigint \+ ([0-9.]+)\) \/ ([0-9.]+)/g;

describe("the Discover shuffle fix", () => {
  it("exists, after 0141", () => {
    expect(file).toBeDefined();
    expect(Number(file?.slice(0, 4))).toBeGreaterThan(141);
  });

  it("is 0141's list_gallery_cards() byte for byte, but for the draw's u", () => {
    const ours = fnDefinition(sql, "list_gallery_cards");
    const before = fnDefinition(readFileSync(join(dir, "0141_card_nickname.sql"), "utf8"), "list_gallery_cards");
    expect(ours).not.toBe("");
    expect(before).toContain("::bit(32)::bigint + 2147483648.0) / 4294967296.0");
    expect(ours).toBe(
      before.replace("::bit(32)::bigint + 2147483648.0) / 4294967296.0", "::bit(32)::bigint + 0.5) / 4294967296.0"),
    );
  });

  it("restates the function's grants as 0141 left them", () => {
    const body = withoutComments(sql);
    expect(body).toMatch(/revoke all on function public\.list_gallery_cards\([^)]*\) from public;/);
    expect(body).toMatch(
      /grant execute on function public\.list_gallery_cards\([^)]*\) to anon, authenticated, service_role;/,
    );
  });
});

describe("every live weighted shuffle draws u in (0, 1)", () => {
  const shuffles = [...liveDefinitions()].filter(([, d]) => d.body.includes("::bit(32)::bigint"));

  it("finds the gallery's", () => {
    expect(shuffles.map(([name]) => name)).toContain("list_gallery_cards");
  });

  for (const [name, { file: where, body }] of shuffles) {
    it(`${name} (${where})`, () => {
      expect(body).not.toContain("2147483648");
      const draws = [...body.matchAll(U_DRAW)];
      expect(draws.length).toBe(body.split("::bit(32)::bigint").length - 1);
      for (const [, add, div] of draws) {
        // bit(32)::bigint is 0 … 2³²−1: both ends of u must stay inside (0, 1).
        const lo = (0 + Number(add)) / Number(div);
        const hi = (TWO_32 - 1 + Number(add)) / Number(div);
        expect(lo).toBeGreaterThan(0);
        expect(hi).toBeLessThan(1);
      }
    });
  }
});
