import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCRYFALL_LIMITS } from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// Migration 0213 — scryfall_calls takes the restyle's own action.
//
// A real card's art read for a model to repaint (Re-art deck's restyle) is
// counted apart from the art a maker imports and keeps: `import_art` is 100
// a day, and a run restyles up to 150 cards. Counted there, a big deck's run
// stopped near its hundredth card with nothing said first, and spent the
// creator's own art import for the day (the independent check of #819).
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_scryfall_restyle_art_action\.sql$/.test(f)) ?? "";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const code = file ? strip(readFileSync(join(dir, file), "utf8")) : "";
const actionsOf = (sql: string) => {
  const all = [...sql.matchAll(/add constraint scryfall_calls_action_check\s+check \(action in \(([^)]*)\)\)/g)];
  return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("0213 scryfall_calls: the restyle's own action", () => {
  it("exists after the migration that records how a picture was made", () => {
    expect(file).not.toBe("");
    const method = files.find((f) => /^\d{4}_re_art_method\.sql$/.test(f)) ?? "";
    expect(method).not.toBe("");
    expect(file > method).toBe(true);
  });

  it("is the list before it plus restyle_art — exactly the app's labels", () => {
    const earlier = files.filter((f) => f < file && readFileSync(join(dir, f), "utf8").includes("add constraint scryfall_calls_action_check")).at(-1) ?? "";
    expect(earlier).not.toBe("");
    const before = actionsOf(strip(readFileSync(join(dir, earlier), "utf8")));
    expect(actionsOf(code)).toEqual([...before, "restyle_art"]);
    expect(actionsOf(code).sort()).toEqual(Object.keys(SCRYFALL_LIMITS).sort());
  });

  it("is idempotent, and touches nothing else: no row, grant, policy, function, trigger or key", () => {
    expect(code.indexOf("drop constraint if exists scryfall_calls_action_check")).toBeGreaterThanOrEqual(0);
    expect(code.indexOf("drop constraint if exists scryfall_calls_action_check")).toBeLessThan(code.indexOf("add constraint scryfall_calls_action_check"));
    expect(code).not.toMatch(/\b(insert into|update\s+public\.|delete from|truncate)\b/i);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(policy|function|trigger|index)\b/i);
    expect(code).not.toMatch(/primary\s+key/i);
  });

  it("the restyle's allowance holds a whole run — 150 cards, two pictures for a two-faced one — where the art import's would not", () => {
    expect(SCRYFALL_LIMITS.restyle_art.perDay).toBeGreaterThanOrEqual(300);
    expect(SCRYFALL_LIMITS.restyle_art.perDay).toBeGreaterThan(SCRYFALL_LIMITS.import_art.perDay);
    // The art a maker keeps is counted as it always was.
    expect(SCRYFALL_LIMITS.import_art).toEqual({ perMinute: 10, perDay: 100 });
  });
});
