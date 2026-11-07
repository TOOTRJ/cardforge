import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The Token Kit's saved kits (0184): RLS on, grants stated revoke-first, every
// policy the OWNER's rows only and only while the tool is open to them
// (has_tool_access('token-kit')), a kit's deck one of the owner's own, the
// sizes held, and the seed guarded. Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_token_kits\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const seed = readFileSync(join(process.cwd(), "supabase/seeds/46_token_kits.sql"), "utf8");

describe("0184 token kits", () => {
  it("exists after the beta tools migration it reads", () => {
    expect(file).not.toBe("");
    const beta = readdirSync(dir).find((f) => /^\d{4}_beta_tools\.sql$/.test(f)) ?? "";
    expect(file > beta).toBe(true);
  });

  it("turns RLS on and states its grants revoke-first", () => {
    expect(sql).toContain("alter table public.token_kits enable row level security;");
    const revoke = sql.indexOf("revoke all on public.token_kits from public, anon, authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(sql.indexOf("grant select, insert, update, delete on public.token_kits to authenticated;")).toBeGreaterThan(revoke);
    expect(sql.indexOf("grant select, insert, update, delete on public.token_kits to service_role;")).toBeGreaterThan(revoke);
    expect(sql).not.toMatch(/on public\.token_kits to [a-z, ]*anon/);
  });

  it("every policy is the owner's, gated by the tool, and a kit's deck is the owner's own", () => {
    const policies = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.token_kits for (\w+)([\s\S]*?);/g)];
    expect(policies.map((p) => p[2]).sort()).toEqual(["delete", "insert", "select", "update"]);
    for (const [, name, , body] of policies) {
      expect(body, name).toContain("to authenticated");
      expect(body, name).toContain("owner_id = (select auth.uid())");
      expect(body, name).toContain("public.has_tool_access('token-kit')");
    }
    for (const [, name, kind, body] of policies) {
      if (kind === "insert" || kind === "update") {
        expect(body, name).toMatch(/deck_id is null or exists \([\s\S]*d\.owner_id = \(select auth\.uid\(\)\)/);
      }
    }
  });

  it("holds the sizes and one kit per owner and source", () => {
    expect(sql).toContain("unique (owner_id, source_key)");
    expect(sql).toContain("octet_length(items::text) <= 200000");
    expect(sql).toContain("octet_length(settings::text) <= 4000");
    expect(sql).toContain("char_length(source_text) <= 100000");
  });

  it("the seed refuses a database with real users and holds no credential", () => {
    expect(seed).toContain("Refusing to seed dev data");
    expect(seed).not.toMatch(/password|secret|api[_-]?key/i);
  });
});
