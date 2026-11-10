import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0195: the symbol delete guard's in-use check reads the card's name and
// nickname too — a `~` in rules text draws them (layout v76), so a code a
// card reaches only through its name keeps the symbol (a tombstone, never a
// delete for good). The same columns as the layout scope and the re-bake.
// Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_custom_symbol_in_use_names\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

describe("custom_symbol_in_use reads the name", () => {
  it("exists, after 0193", () => {
    expect(file).not.toBe("");
    expect(Number(file.slice(0, 4))).toBeGreaterThan(193);
  });

  it("reads the title and nickname beside every column 0193 read", () => {
    expect(sql).toContain(
      "concat_ws(' ', c.title, c.nickname, c.cost, c.rules_text, c.face_content::text, c.back_face::text)",
    );
  });

  it("keeps 0193's shape: invoker, a real code only, the same grants", () => {
    expect(sql).toContain("create or replace function public.custom_symbol_in_use(p_owner uuid, p_code text)");
    expect(sql).toContain("select p_code ~* '^[A-Z][A-Z0-9]{0,5}$'");
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("revoke all on function public.custom_symbol_in_use(uuid, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.custom_symbol_in_use(uuid, text) to authenticated, service_role;");
  });
});
