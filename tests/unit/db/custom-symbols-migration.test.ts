import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_SYMBOLS_SLUG } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// New mana symbols' migration (0193): everyone reads (a card that uses a
// symbol draws for every viewer), the owner writes only while the tool is
// open to them, no API role ever writes another owner's row, the grants are
// stated revoke-first and column by column, the tool ships with NO
// tool_releases row (admin-only until released), and the seed grants one
// tester. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_custom_symbols\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/53_custom_symbols.sql"), "utf8");

function policy(name: string): string {
  const m = new RegExp(`create policy "${name}"([\\s\\S]*?);`).exec(sql);
  return m?.[1] ?? "";
}

describe("0193 custom symbols", () => {
  it("exists", () => {
    expect(file).not.toBe("");
  });

  it("lets everyone read every row (tombstones too), and only read", () => {
    const read = policy("Custom symbols: everyone reads");
    expect(read).toContain("for select");
    expect(read).toContain("to anon, authenticated");
    expect(read).toContain("using (true)");
  });

  it("gates every write on the owner AND the tool", () => {
    for (const name of ["Custom symbols: owner adds", "Custom symbols: owner edits", "Custom symbols: owner deletes"]) {
      const body = policy(name);
      expect(body, name).toContain("to authenticated");
      expect(body, name).toContain("owner_id = (select auth.uid())");
      expect(body, name).toContain(`public.has_tool_access('${CUSTOM_SYMBOLS_SLUG}')`);
    }
    // A new row is never born removed.
    expect(policy("Custom symbols: owner adds")).toContain("deleted_at is null");
    // The update's with-check holds the owner too (no row moved away).
    expect(policy("Custom symbols: owner edits")).toMatch(/with check \(owner_id = \(select auth\.uid\(\)\)/);
  });

  it("states its grants revoke-first, column by column — never the code after insert", () => {
    const revoke = sql.indexOf("revoke all on public.custom_symbols from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    const after = sql.slice(revoke);
    expect(after).toContain("grant select on public.custom_symbols to anon, authenticated;");
    expect(after).toMatch(/grant update \(name, mana_value, base_color, image_url, deleted_at\)\s+on public\.custom_symbols to authenticated;/);
    expect(after).toMatch(/grant insert \(owner_id, code, name, mana_value, base_color, image_url, source\)/);
    expect(after).toContain("grant select, insert, update, delete on public.custom_symbols to service_role;");
    expect(sql).not.toMatch(/grant (all|insert|update|delete)[^;]*to anon/);
  });

  it("keeps a code fixed and unique per owner across every row", () => {
    expect(sql).toContain("constraint custom_symbols_owner_code_key unique (owner_id, code)");
    expect(sql).toContain("custom_symbol_code_locked");
  });

  it("guards the picture with 0127's 'pip' kind", () => {
    expect(sql).toContain("media_url_change_allowed('pip', v_old_image, new.image_url)");
    expect(sql).toMatch(/before insert or update of image_url\s+on public\.custom_symbols/);
  });

  it("refuses an API role's delete of a symbol a card names", () => {
    expect(sql).toContain("custom_symbol_in_use");
    expect(sql).toMatch(/before delete on public\.custom_symbols/);
    // Invoker: the deleting owner's own RLS decides what it sees; no
    // security definer anywhere (it would hide the caller's role from the
    // trigger's current_user check).
    expect(sql).not.toMatch(/security definer/i);
  });

  it("revokes the trigger functions from the API roles", () => {
    for (const fn of ["custom_symbols_guard", "guard_custom_symbol_media_columns", "custom_symbols_guard_delete"]) {
      expect(sql, fn).toContain(`revoke all on function public.${fn}() from public, anon, authenticated;`);
    }
  });

  it("ships admin-only: no tool_releases row, anywhere", () => {
    expect(sql).not.toMatch(/insert into public\.tool_releases/i);
    expect(seed).not.toMatch(/tool_releases/);
  });

  it("the seed grants one tester, guarded and idempotent", () => {
    expect(seed).toContain("Refusing to seed dev data");
    expect(seed).toContain(`'${CUSTOM_SYMBOLS_SLUG}', 'd0000000-0000-4000-a000-000000000002'`);
    expect(seed).toContain("on conflict do nothing");
    expect(seed).not.toMatch(/insert into public\.custom_symbols/);
  });
});
