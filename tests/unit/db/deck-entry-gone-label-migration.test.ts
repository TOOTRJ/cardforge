import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GONE_CARD_NAME, PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import { NO_LONGER_AVAILABLE } from "@/lib/decks/deck-view";

// ---------------------------------------------------------------------------
// 0153 — a deleted card's deck entry reads "No longer available" to
// visitors. deck_entries_for_viewer is 0152's but for the mask's NAME: the
// same deck rule, the same hidden rows, the same cleared columns, the same
// grants (behaviour proved on the local stack, PR body).
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const read = (file: string) => strip(readFileSync(join(dir, file), "utf8"));

function body(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = sql.indexOf("$$", start);
  return squash(sql.slice(open + 2, sql.indexOf("$$", open + 2)));
}

const SQL = read("0153_deck_entry_gone_label.sql");
const NEW = body(SQL, "deck_entries_for_viewer");
const OLD = body(read("0152_deck_entry_private_text.sql"), "deck_entries_for_viewer");

describe("0153: the gone-card label", () => {
  it("is the app's words: the status badge's and GONE_CARD_NAME; a private card keeps PRIVATE_CARD_NAME", () => {
    expect(GONE_CARD_NAME).toBe(NO_LONGER_AVAILABLE);
    expect(NEW).toContain(
      `v_entry.name := case when v_entry.card_id is null then '${GONE_CARD_NAME}' else '${PRIVATE_CARD_NAME}' end;`,
    );
  });

  it("changes nothing else of 0152's function: deck rule, hidden rows, every cleared column", () => {
    const withoutName = (b: string) => b.replace(/v_entry\.name := [^;]*;/, "");
    expect(withoutName(NEW)).toBe(withoutName(OLD));
  });

  it("keeps its grants, restated", () => {
    const flat = squash(SQL);
    expect(flat).toContain("revoke all on function public.deck_entries_for_viewer(uuid) from public;");
    expect(flat).toContain("grant execute on function public.deck_entries_for_viewer(uuid) to anon, authenticated, service_role;");
    expect(flat).toContain("returns setof public.deck_cards language plpgsql stable security definer set search_path = ''");
  });
});
