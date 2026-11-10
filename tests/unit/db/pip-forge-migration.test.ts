import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_ACTION_COST } from "@/lib/ai/rate-limit";
import { LEDGER_REASON_LABELS } from "@/lib/billing/ledger-reasons";
import { PIP_FORGE_SLUG } from "@/lib/tools/pip-forge/model";
import { toolBySlug } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// Pip Forge's migration (0192): the AI label added to the LATEST list (never
// one dropped), forged_pips read / renamed / deleted by its owner only while
// the tool is open to them and written by the server alone, grants stated
// revoke-first, and the seed guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_pip_forge\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/49_pip_forge.sql"), "utf8");

function previousList(constraint: string): string[] {
  const before = files.filter((f) => f < file).reverse();
  for (const name of before) {
    const text = readFileSync(join(dir, name), "utf8");
    const at = text.lastIndexOf(`add constraint ${constraint}`);
    if (at < 0) continue;
    const body = text.slice(at, text.indexOf(";", at));
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error(`no earlier ${constraint}`);
}

function listIn(text: string, constraint: string): string[] {
  const at = text.lastIndexOf(`add constraint ${constraint}`);
  return [...text.slice(at, text.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("0192 pip forge", () => {
  it("exists, and the tool is built", () => {
    expect(file).not.toBe("");
    expect(toolBySlug(PIP_FORGE_SLUG)?.built).toBe(true);
  });

  it("adds forge_pip to the latest AI label list, dropping none", () => {
    expect(listIn(sql, "card_ai_calls_action_check")).toEqual([...previousList("card_ai_calls_action_check"), "forge_pip"]);
  });

  it("the newest migration's AI label list still holds forge_pip (a later rewrite kept it)", () => {
    const latest = [...files].reverse().find((f) => readFileSync(join(dir, f), "utf8").includes("add constraint card_ai_calls_action_check"))!;
    expect(listIn(readFileSync(join(dir, latest), "utf8"), "card_ai_calls_action_check")).toContain("forge_pip");
  });

  it("charges one credit and names the spend on the usage page", () => {
    expect(AI_ACTION_COST.forge_pip).toBe(1);
    expect(LEDGER_REASON_LABELS.forge_pip).toBeTruthy();
  });

  it("every policy is the owner's AND the tool's", () => {
    const policies = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.forged_pips([\s\S]*?);/g)];
    expect(policies.map((m) => m[1]).sort()).toEqual([
      "Forged pips: owner deletes",
      "Forged pips: owner reads",
      "Forged pips: owner renames",
    ]);
    for (const [, name, body] of policies) {
      expect(body, name).toContain("to authenticated");
      for (const clause of body.match(/(using|with check) \(([^;]*?)\)\s*(?=with check|$)/g) ?? []) {
        expect(clause, name).toContain("owner_id = (select auth.uid())");
        expect(clause, name).toContain(`public.has_tool_access('${PIP_FORGE_SLUG}')`);
      }
    }
    expect(sql).not.toMatch(/for insert/);
  });

  it("states its grants revoke-first: the API roles read, delete and rename only", () => {
    const revoke = sql.indexOf("revoke all on public.forged_pips from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select, delete on public.forged_pips to authenticated;")).toBeGreaterThan(revoke);
    expect(sql.indexOf("grant update (name) on public.forged_pips to authenticated;")).toBeGreaterThan(revoke);
    expect(sql).toContain("grant select, insert, update, delete on public.forged_pips to service_role;");
    expect(sql).not.toMatch(/grant [^;]*\binsert\b[^;]*on public\.forged_pips to authenticated/);
    expect(sql).not.toMatch(/to [a-z_, ]*\banon\b/);
    expect(sql).not.toMatch(/grant all on all/i);
    expect(sql).toContain("revoke all on function public.forged_pips_touch() from public, anon, authenticated;");
  });

  it("the seed is guarded, grants the tool and holds no credentials", () => {
    expect(seed).toMatch(/raise exception/);
    expect(seed).toContain(`'${PIP_FORGE_SLUG}'`);
    expect(seed).not.toMatch(/password\s*[:=]/i);
  });
});
