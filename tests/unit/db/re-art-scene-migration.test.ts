import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ACTION_COST } from "@/lib/ai/rate-limit";
import { LEDGER_REASON_LABELS } from "@/lib/billing/ledger-reasons";
import { CREDIT_REASON_TOOLS } from "@/lib/admin/analytics/credits";
import { TOOL_USE_EVENTS } from "@/lib/tools/catalog";
import { REART_SCENE_CREDITS } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck's AI-written scene (migration 0217; owner 2026-11-18: one
// credit each): the AI label added to the LATEST card_ai_calls list (never
// one dropped), and nothing else — no table, no column, no grant, no tool
// release (the scene is stored where a card's own words always were).
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_scene\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

function listIn(text: string): string[] {
  const at = text.lastIndexOf("add constraint card_ai_calls_action_check");
  return [...text.slice(at, text.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function previousList(): string[] {
  for (const name of files.filter((f) => f < file).reverse()) {
    const text = readFileSync(join(dir, name), "utf8");
    if (text.includes("add constraint card_ai_calls_action_check")) return listIn(text);
  }
  throw new Error("no earlier card_ai_calls_action_check");
}

describe("the Re-art scene migration", () => {
  it("exists", () => {
    expect(file).not.toBe("");
  });

  it("adds deck_reart_scene to the latest AI label list, dropping none", () => {
    expect(listIn(sql)).toEqual([...previousList(), "deck_reart_scene"]);
  });

  it("the newest migration's list still holds it (a later rewrite kept it)", () => {
    const latest = [...files].reverse().find((f) => readFileSync(join(dir, f), "utf8").includes("add constraint card_ai_calls_action_check"))!;
    expect(listIn(readFileSync(join(dir, latest), "utf8"))).toContain("deck_reart_scene");
  });

  it("changes nothing else: no table, no column, no grant, no tool release", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\bcreate\b|\bgrant\b|\brevoke\b|tool_releases|\binsert\b|\badd column\b/i);
    // Drop, then add: the one constraint, so it can be applied twice.
    expect(statements.match(/drop constraint if exists card_ai_calls_action_check/g)).toHaveLength(1);
    expect(statements.match(/add constraint card_ai_calls_action_check/g)).toHaveLength(1);
  });

  it("charges one credit, names the spend on the usage page, and counts as Re-art deck's cost and use", () => {
    expect(AI_ACTION_COST.deck_reart_scene).toBe(1);
    expect(REART_SCENE_CREDITS).toBe(AI_ACTION_COST.deck_reart_scene);
    expect(LEDGER_REASON_LABELS.deck_reart_scene).toBe("Re-art deck AI scene");
    expect(CREDIT_REASON_TOOLS.deck_reart_scene).toBe("re-art-deck");
    expect(TOOL_USE_EVENTS["re-art-deck"]).toContain("write_scene");
  });
});
