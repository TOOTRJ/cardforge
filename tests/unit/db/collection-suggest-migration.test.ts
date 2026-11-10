import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ACTION_COST } from "@/lib/ai/rate-limit";
import { LEDGER_REASON_LABELS } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// "Suggest a commander"'s migration (owner decision 2026-11-09): the AI
// label added to the LATEST card_ai_calls list (never one dropped), and
// nothing else — no table, no grant, no tool release. Found by NAME, never
// by number (it may be renumbered past another PR's migration).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_collection_suggest\.sql$/.test(f)) ?? "";
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

describe("the collection suggest migration", () => {
  it("exists", () => {
    expect(file).not.toBe("");
  });

  it("adds suggest_collection_commander to the latest AI label list, dropping none", () => {
    expect(listIn(sql)).toEqual([...previousList(), "suggest_collection_commander"]);
  });

  it("the newest migration's list still holds it (a later rewrite kept it)", () => {
    const latest = [...files].reverse().find((f) => readFileSync(join(dir, f), "utf8").includes("add constraint card_ai_calls_action_check"))!;
    expect(listIn(readFileSync(join(dir, latest), "utf8"))).toContain("suggest_collection_commander");
  });

  it("changes nothing else: no table, no grant, no tool release", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\bcreate\b|\bgrant\b|\brevoke\b|tool_releases|\binsert\b/i);
  });

  it("charges one credit and names the spend on the usage page", () => {
    expect(AI_ACTION_COST.suggest_collection_commander).toBe(1);
    expect(LEDGER_REASON_LABELS.suggest_collection_commander).toBe("Commander suggestions");
  });
});
