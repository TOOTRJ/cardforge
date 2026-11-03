import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TODO DK8.4 — migration *_commander_row.sql (found by name, so a renumber
// at rebase doesn't break this): list_commander_cards() orders by
// -ln(u) / weight (the Discover draw, lib/cards/discover.ts), which needs u
// uniform in (0, 1). `bit(32)::bigint` is UNSIGNED (0 … 2³²−1), so 0086's
// `(bits + 2147483648.0) / 4294967296.0` put u in [0.5, 1.5): -ln(u) went
// negative for half the cards and a heavier weight sorted those LATER — in
// a 100-card pool with 10 cards at weight 5, a popular card took 0 % of the
// first 8 slots instead of about a third. This pins the draw's form.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_commander_row\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const TWO_32 = 2 ** 32;

describe("the commander row migration", () => {
  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("draws u as (bits + 0.5) / 2³², never the signed-offset form", () => {
    expect(body).not.toContain("2147483648");
    const draws = [...body.matchAll(/::bit\(32\)::bigint \+ ([0-9.]+)\) \/ ([0-9.]+)/g)];
    expect(draws).toHaveLength(1);
    expect(draws[0][0]).toBe("::bit(32)::bigint + 0.5) / 4294967296.0");
  });

  it("keeps u inside (0, 1) at both ends of the unsigned 32-bit range", () => {
    const [, add, div] = /::bit\(32\)::bigint \+ ([0-9.]+)\) \/ ([0-9.]+)/.exec(body) ?? [];
    expect((0 + Number(add)) / Number(div)).toBeGreaterThan(0);
    expect((TWO_32 - 1 + Number(add)) / Number(div)).toBeLessThan(1);
  });

  it("orders by -ln(u) / weight ascending, so a heavier card sorts EARLIER", () => {
    expect(body).toMatch(/order by -ln\(b\.discover_u\) \/ b\.discover_weight asc/);
  });

  it("states its grants", () => {
    expect(body).toMatch(/revoke all on function public\.list_commander_cards\(text, integer\) from public;/);
    expect(body).toMatch(
      /grant execute on function public\.list_commander_cards\(text, integer\) to anon, authenticated, service_role;/,
    );
  });
});
