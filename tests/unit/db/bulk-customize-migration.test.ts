import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BULK_CUSTOMIZE_TOOL_SLUG } from "@/lib/tools/bulk-customize/model";

// ---------------------------------------------------------------------------
// Bulk Customize's migration (0186): the job kind and the AI label are added
// to the LATEST lists (never one dropped), a collection row's customised card
// is the server's to write and held to the row's owner, the grants restated
// revoke-first with no write of the new columns for an API role, and the
// seed guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_bulk_customize\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/48_bulk_customize.sql"), "utf8");

/** The values a CHECK lists in the newest migration BEFORE this one. */
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

function listIn(constraint: string): string[] {
  const at = sql.lastIndexOf(`add constraint ${constraint}`);
  return [...sql.slice(at, sql.indexOf(";", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("0186 bulk customize", () => {
  it("exists after the collection builder it extends", () => {
    expect(file).not.toBe("");
    const collection = files.find((f) => /^\d{4}_collection_builder\.sql$/.test(f)) ?? "";
    expect(file > collection).toBe(true);
  });

  it("adds the job kind to the latest list, dropping none", () => {
    const now = listIn("ai_generation_jobs_kind_check");
    expect(now).toEqual([...previousList("ai_generation_jobs_kind_check"), "bulk_customize"]);
  });

  it("adds the AI label to the latest list, dropping none", () => {
    const now = listIn("card_ai_calls_action_check");
    expect(now).toEqual([...previousList("card_ai_calls_action_check"), "bulk_customize_art"]);
  });

  it("a collection row's customised card is its owner's own, written by the server", () => {
    expect(sql).toContain("references public.cards (id) on delete set null");
    const fn = sql.slice(sql.indexOf("create or replace function public.collection_cards_check_customized()"));
    const body = fn.slice(0, fn.indexOf("$$;"));
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("c.owner_id = new.owner_id");
    expect(body).toContain("errcode = '42501'");
    expect(sql).toContain("revoke all on function public.collection_cards_check_customized() from public, anon, authenticated;");
  });

  it("restates the grants revoke-first: the API roles never write the new columns", () => {
    const revoke = sql.indexOf("revoke all on public.collection_cards from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant update (quantity) on public.collection_cards to authenticated;")).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/grant update \([^)]*customized[^)]*\)/);
    expect(sql).not.toMatch(/grant [^;]*\binsert\b[^;]*on public\.collection_cards to authenticated/);
    expect(sql).not.toMatch(/to [a-z_, ]*\banon\b/);
    expect(sql).not.toMatch(/grant all on all/i);
  });

  it("the seed is guarded, grants the tool and holds no credentials", () => {
    expect(seed).toMatch(/dev_seed_guard|raise exception|current_database|dev\.pipglyph\.test/i);
    expect(seed).toContain(`'${BULK_CUSTOMIZE_TOOL_SLUG}'`);
    expect(seed).not.toMatch(/password\s*[:=]/i);
  });
});
