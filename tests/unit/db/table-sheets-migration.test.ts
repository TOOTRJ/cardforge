import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RULE0_TOOL_SLUG } from "@/lib/tools/rule0/model";
import { TABLE_SHEET_LIMITS } from "@/lib/validation/table-sheet";
import { AI_ACTION_COST } from "@/lib/ai/rate-limit";
import { LEDGER_REASON_LABELS } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// The Rule 0 table sheet's migration (0190): the access rule for another
// user is has_tool_access's own body (0182) with auth.uid() swapped for the
// user — never a second rule; it is internal; a visitor reads only a shared
// sheet of a deck that reads for them while the tool is open to its owner;
// the owner's writes are column grants; the AI label is added to the LATEST
// list, dropping none; the stored limits match the app's; the seed is
// guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_table_sheets\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/51_table_sheets.sql"), "utf8");

function functionBody(text: string, signature: string): string {
  const at = text.indexOf(`create or replace function ${signature}`);
  expect(at).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("as $$", at);
  return text.slice(open + 5, text.indexOf("$$;", open)).trim();
}

/** The values a CHECK lists in the newest migration BEFORE this one. */
function previousList(constraint: string): string[] {
  for (const name of files.filter((f) => f < file).reverse()) {
    const text = readFileSync(join(dir, name), "utf8");
    const at = text.lastIndexOf(`add constraint ${constraint}`);
    if (at < 0) continue;
    return [...text.slice(at, text.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  throw new Error(`no earlier ${constraint}`);
}

describe("0190 table sheets", () => {
  it("exists", () => {
    expect(file).not.toBe("");
  });

  it("tool_access_for is has_tool_access's body for a given user", () => {
    const latest = files
      .filter((f) => f < file)
      .reverse()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .find((text) => text.includes("create or replace function public.has_tool_access(p_slug text)"))!;
    const original = functionBody(latest, "public.has_tool_access(p_slug text)");
    const mirror = functionBody(sql, "public.tool_access_for(p_slug text, p_user uuid)");
    expect(mirror).toBe(original.replace("where p.id = auth.uid()", "where p.id = p_user"));
    expect(sql).toContain("revoke all on function public.tool_access_for(text, uuid) from public, anon, authenticated;");
    expect(sql).not.toMatch(/grant execute on function public\.tool_access_for\(text, uuid\) to [^;]*(anon|authenticated)/);
  });

  it("a visitor reads a shared sheet only: the deck reads for them, never private, the tool open to the owner", () => {
    const live = functionBody(sql, "public.deck_table_sheet_live(p_deck uuid)");
    expect(live).toContain("s.shared");
    expect(live).toContain("d.visibility in ('public', 'unlisted')");
    expect(live).toContain(`public.tool_access_for('${RULE0_TOOL_SLUG}', s.owner_id)`);
    const policy = sql.slice(sql.indexOf('create policy "Table sheets: shared reads"'));
    const using = policy.slice(0, policy.indexOf(";"));
    expect(using).toContain("exists (select 1 from public.decks d where d.id = deck_id)");
    expect(using).toContain("public.deck_table_sheet_live(deck_id)");
  });

  it("the owner writes only while the tool is theirs and the deck is theirs", () => {
    for (const name of ["owner inserts", "owner updates"]) {
      const policy = sql.slice(sql.indexOf(`create policy "Table sheets: ${name}"`));
      const body = policy.slice(0, policy.indexOf(";"));
      expect(body).toContain(`public.has_tool_access('${RULE0_TOOL_SLUG}')`);
      expect(body).toContain("d.owner_id = (select auth.uid())");
    }
  });

  it("grants revoke-first: visitors select, the owner's writes by column, no blanket grant", () => {
    const revoke = sql.indexOf("revoke all on public.deck_table_sheets from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select on public.deck_table_sheets to anon, authenticated;")).toBeGreaterThan(revoke);
    expect(sql).toMatch(/grant insert \([^)]*\)\s+on public\.deck_table_sheets to authenticated;/);
    expect(sql).toMatch(/grant update \([^)]*\)\s+on public\.deck_table_sheets to authenticated;/);
    expect(sql).not.toMatch(/grant (all|insert|update|delete)[^;(]*on public\.deck_table_sheets to [^;]*anon/);
    expect(sql).not.toMatch(/grant all on all/i);
    // The touch trigger pins the row's deck and owner (an upsert sends them).
    const touch = functionBody(sql, "public.deck_table_sheets_touch()");
    expect(touch).toContain("new.deck_id := old.deck_id;");
    expect(touch).toContain("new.owner_id := old.owner_id;");
  });

  it("stores the limits the editor holds", () => {
    expect(sql).toContain(`char_length(game_plan) between 1 and ${TABLE_SHEET_LIMITS.gamePlan}`);
    expect(sql).toContain(`char_length(win_conditions) between 1 and ${TABLE_SHEET_LIMITS.winConditions}`);
    expect(sql).toContain(`char_length(table_notes) between 1 and ${TABLE_SHEET_LIMITS.tableNotes}`);
  });

  it("adds the AI label to the latest list, dropping none, priced and labelled", () => {
    const at = sql.lastIndexOf("add constraint card_ai_calls_action_check");
    const now = [...sql.slice(at, sql.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const before = previousList("card_ai_calls_action_check");
    expect(now.slice(0, before.length)).toEqual(before);
    expect(now).toContain("draft_table_sheet");
    expect(AI_ACTION_COST.draft_table_sheet).toBe(1);
    expect(LEDGER_REASON_LABELS.draft_table_sheet).toBeTruthy();
  });

  it("the seed is guarded, grants the tool and holds no credentials", () => {
    expect(seed).toMatch(/raise exception/);
    expect(seed).toContain(`'${RULE0_TOOL_SLUG}'`);
    expect(seed).not.toMatch(/password\s*[:=]/i);
  });
});
