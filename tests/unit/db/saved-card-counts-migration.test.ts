import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0207_saved_card_counts.sql, as text: the home page's two totals count
// EVERY saved card (no visibility filter — the owner's ask), hand out
// numbers and nothing else, run with a fixed empty search_path, and are
// callable by the roles the static home page reads with. Its results are
// checked on a real database by the PR's Supabase preview.
// ---------------------------------------------------------------------------

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0207_saved_card_counts.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");
/** The function's own SQL, between its dollar quotes. */
const body = /as \$\$([\s\S]*?)\$\$;/.exec(code)?.[1] ?? "";

describe("0207 saved_card_counts", () => {
  it("returns the two numbers types/supabase.ts declares, and takes nothing", () => {
    expect(code).toMatch(/create or replace function public\.saved_card_counts\(\)\s+returns table \(\s*cards bigint,\s*cards_this_week bigint\s*\)/);
    expect(types).toMatch(/saved_card_counts: \{\s*Args: Record<string, never>;\s*Returns: \{ cards: number; cards_this_week: number \}\[\];/);
  });

  it("counts every saved card: no visibility, owner or admin filter", () => {
    expect(body).toContain("from public.cards c");
    expect(body).not.toMatch(/visibility/i);
    expect(body).not.toMatch(/owner_id|is_admin|profiles/i);
  });

  it("leaves out only the frame-verification tool's preview rows, and counts the week from the same cards", () => {
    expect(body).toContain("where c.frame_preview is not true");
    expect(body).toContain("count(*) filter (where c.created_at >= now() - interval '7 days')");
    expect(body.match(/\bwhere\b/g)).toHaveLength(2);
  });

  it("hands out totals only: one aggregate select, no row or column of a card", () => {
    expect(body.match(/\bselect\b/g)).toHaveLength(1);
    expect(body).not.toMatch(/c\.(id|title|slug|owner_id|rules_text|art_url)\b/);
    expect(body).not.toMatch(/group by/i);
  });

  it("is a stable SQL function with a fixed empty search_path", () => {
    expect(code).toMatch(/language sql\s+stable\s+security definer\s+set search_path = ''/);
  });

  it("states its grants: the page's roles and the service role, nothing through PUBLIC", () => {
    expect(code).toMatch(/revoke all on function public\.saved_card_counts\(\) from public;/);
    expect(code).toMatch(/grant execute on function public\.saved_card_counts\(\) to anon, authenticated, service_role;/);
  });

  it("runs as the migration runner sends it: no transaction or lock statements, nothing written", () => {
    expect(code).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(code).not.toMatch(/\block table\b/i);
    expect(code).not.toMatch(/\b(insert into|update public\.|delete from)\b/i);
  });

  it("says in its header how it ships", () => {
    expect(sql).toContain("Ships through a PR; never");
    expect(sql).toContain("Grants are explicit (0097)");
  });
});
