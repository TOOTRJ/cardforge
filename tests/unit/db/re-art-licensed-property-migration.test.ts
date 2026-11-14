import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REART_IP_NAME_MAX, reartIpStatement, reartStyleSchema } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// Re-art deck — a deck that names a LICENSED PROPERTY, and a deck's
// REFERENCE PICTURE (migration 0214; owner 2026-11-13: the maker
// self-attests).
//
//   * deck_art_styles gains `ip_name` ('' = none) and `reference_url` (NULL
//     = none): no stored style changes, no card is touched. The reference
//     picture is the OWNER's own stored picture — the table's trigger asks
//     media_url_allowed, so no address the server would fetch for someone
//     else's deck can be stored, whoever writes the row.
//   * deck_ip_attestations is what a maker confirmed: APPEND-ONLY — no role
//     updates or deletes a row, the API roles can't write one at all — read
//     by its owner (while the tool is open to them) and by admins.
//   * It makes no table the API could read as a second link between decks
//     and deck_cards (the 0209 incident). Found by NAME, never by number.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const file = files.find((f) => /^\d{4}_re_art_licensed_property\.sql$/.test(f)) ?? "";
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
/** The statements, without the comments (a word in a comment proves nothing). */
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const types = readFileSync(join(process.cwd(), "types/supabase.ts"), "utf8");

describe("0214 re-art deck: a licensed property and a reference picture", () => {
  it("exists after the migration that records how a picture was made", () => {
    expect(file).not.toBe("");
    const method = files.find((f) => /^\d{4}_re_art_method\.sql$/.test(f)) ?? "";
    expect(method).not.toBe("");
    expect(file > method).toBe(true);
  });

  it("adds the two columns with no stored style changed: '' and NULL mean none", () => {
    expect(code).toMatch(/alter table public\.deck_art_styles\s+add column if not exists ip_name text not null default '',\s+add column if not exists reference_url text;/);
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/public\.cards\b/);
    expect(code).not.toMatch(/\b(drop table|drop column|truncate|delete from)\b/i);
  });

  it("holds the name to the model's limit and the address to the request's", () => {
    expect(code).toContain(`check (char_length(ip_name) <= ${REART_IP_NAME_MAX});`);
    expect(code).toContain("check (reference_url is null or char_length(reference_url) between 1 and 600);");
    // The request's own limit for the address is the column's.
    const style = { preset: "anime", theme: "" };
    expect(reartStyleSchema.safeParse({ ...style, referenceUrl: "x".repeat(600) }).success).toBe(true);
    expect(reartStyleSchema.safeParse({ ...style, referenceUrl: "x".repeat(601) }).success).toBe(false);
    for (const name of ["deck_art_styles_ip_name_check", "deck_art_styles_reference_url_check"]) {
      expect(code.indexOf(`drop constraint if exists ${name}`)).toBeGreaterThan(0);
      expect(code.indexOf(`drop constraint if exists ${name}`)).toBeLessThan(code.indexOf(`add constraint ${name}`));
    }
  });

  it("the reference picture is the deck owner's own stored picture — asked by the table's trigger, whoever writes", () => {
    const fn = code.slice(code.indexOf("create or replace function public.deck_art_styles_check_owner()"), code.indexOf("revoke all on function public.deck_art_styles_check_owner()"));
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/set search_path = ''/);
    // Still the deck owner's row (0191's rule, kept)…
    expect(fn).toMatch(/d\.id = new\.deck_id and d\.owner_id = new\.owner_id/);
    expect(fn).toMatch(/raise exception 'deck_art_style_not_owner'/);
    // …and the picture held to that owner's folder on a registered origin.
    expect(fn).toMatch(/new\.reference_url is not null\s+and not public\.media_url_allowed\('set-icon', new\.reference_url, new\.owner_id\)/);
    expect(fn).toMatch(/raise exception 'deck_art_style_reference_not_allowed'/);
    // The trigger itself is 0191's: the function is replaced, the trigger not re-made.
    expect(code).not.toMatch(/create trigger/i);
    expect(code).toContain("revoke all on function public.deck_art_styles_check_owner() from public, anon, authenticated;");
  });

  describe("what the maker confirmed", () => {
    const table = code.slice(code.indexOf("create table if not exists public.deck_ip_attestations"));

    it("keeps who, which deck, which property and the sentence word for word — and outlives its deck", () => {
      expect(table).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
      expect(table).toMatch(/owner_id uuid not null references public\.profiles \(id\) on delete cascade/);
      expect(table).toMatch(/deck_id uuid references public\.decks \(id\) on delete set null/);
      expect(table).toContain(`ip_name text not null check (char_length(ip_name) between 1 and ${REART_IP_NAME_MAX})`);
      expect(table).toContain("statement text not null check (char_length(statement) between 1 and 1000)");
      expect(table).toMatch(/created_at timestamptz not null default now\(\)/);
      // The sentence fits the column at the longest name the server keeps.
      expect(reartIpStatement("x".repeat(REART_IP_NAME_MAX)).length).toBeLessThanOrEqual(1000);
    });

    it("is keyed on ONE column: never a table the API reads as a link between two others (the 0209 incident)", () => {
      expect(code.match(/primary\s+key/gi)).toHaveLength(1);
      expect(code).not.toMatch(/primary key \(/i);
      // It links profiles and decks only: nothing here references deck_cards.
      expect(code).not.toMatch(/references public\.deck_cards/);
    });

    it("is append-only: the API roles read (their own, or as an admin) and never write; the server inserts and reads, never updates or deletes", () => {
      expect(code).toContain("alter table public.deck_ip_attestations enable row level security;");
      expect(code).toContain("revoke all on public.deck_ip_attestations from public, anon, authenticated;");
      expect(code).toContain("grant select on public.deck_ip_attestations to authenticated;");
      expect(code).toContain("revoke all on public.deck_ip_attestations from service_role;");
      expect(code).toContain("grant select, insert on public.deck_ip_attestations to service_role;");
      const grants = code.match(/grant [^;]+ on public\.deck_ip_attestations to [^;]+;/g) ?? [];
      expect(grants).toHaveLength(2);
      for (const grant of grants) expect(grant).not.toMatch(/\b(update|delete|truncate|all)\b/i);
      expect(code).not.toMatch(/to anon/);
    });

    it("its two policies are SELECT only: the owner while the tool is open to them, and admins", () => {
      const policies = code.match(/create policy [\s\S]*?;/g) ?? [];
      expect(policies).toHaveLength(2);
      for (const policy of policies) {
        expect(policy).toMatch(/on public\.deck_ip_attestations for select\s+to authenticated/);
        expect(policy).not.toMatch(/with check/);
      }
      expect(policies[0]).toMatch(/owner_id = \(select auth\.uid\(\)\) and public\.has_tool_access\('re-art-deck'\)/);
      expect(policies[1]).toMatch(/public\.viewer_is_admin\(\)/);
      // Idempotent: each is dropped before it is made.
      expect(code.match(/drop policy if exists/g)).toHaveLength(2);
    });
  });

  it("the generated types know the columns and the table", () => {
    const styles = types.slice(types.indexOf("deck_art_styles: {"));
    const block = styles.slice(0, styles.indexOf("Relationships:"));
    expect(block.match(/\bip_name: string\b/g)).toHaveLength(1);
    expect(block.match(/\bip_name\?: string\b/g)).toHaveLength(2);
    expect(block.match(/\breference_url: string \| null/g)).toHaveLength(1);
    expect(block.match(/\breference_url\?: string \| null/g)).toHaveLength(2);
    expect(types).toContain("deck_ip_attestations: {");
  });
});
