import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECK_ENTRY_SOURCE_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// 0144 — card provenance, deck entry origin and other creators' public cards
// in decks (TODO DK2.5, DK2.6, DK2.9; owner decision D3). The SQL is proved
// on the local stack (the PR body has the run); this holds the file to what
// the app relies on:
//   * cards.import_scryfall_id / import_fingerprint: insert-only for API
//     roles (0126's trusted-path test), the fingerprint's format CHECKed;
//   * deck_cards.source: the app's value list, NULL allowed, backfilled with
//     the update triggers off (no updated_at / count moves);
//   * D3: the insert policy takes the caller's own card or a PUBLIC one, and
//     the card rule of an update lives in a guard that sees OLD;
//   * import_deck_entries is 0143's, every new row 'import' — nothing else
//     changed; add_custom_deck_entry gains p_source / p_scryfall_id with
//     defaults, the 3-argument one dropped, grants restated.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = strip(readFileSync(join(dir, "0144_deck_card_origin.sql"), "utf8"));
const FLAT = squash(SQL);
const SQL_0143 = strip(readFileSync(join(dir, "0143_deck_counts_and_counter_guards.sql"), "utf8"));

function fn(sql: string, name: string): string {
  const m = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i").exec(sql);
  if (!m) throw new Error(`no function ${name}`);
  return squash(m[0]);
}

describe("0144 — card provenance (DK2.5)", () => {
  it("adds the two columns and their CHECKs", () => {
    expect(FLAT).toContain("add column if not exists import_scryfall_id uuid");
    expect(FLAT).toContain("add column if not exists import_fingerprint text");
    expect(FLAT).toContain(
      "add constraint cards_import_fingerprint_format check (import_fingerprint is null or import_fingerprint ~ '^v[1-9][0-9]*:[0-9a-f]{64}$')",
    );
    expect(FLAT).toContain(
      "add constraint cards_import_fingerprint_needs_source check (import_fingerprint is null or import_scryfall_id is not null)",
    );
  });

  it("an API role can never change them after insert; a trusted path can", () => {
    const body = fn(SQL, "guard_card_provenance");
    expect(body).toContain("returns trigger");
    expect(body).not.toContain("security definer");
    expect(body).toContain("if current_user not in ('anon', 'authenticated') then return new; end if;");
    expect(body).toContain(
      "if new.import_scryfall_id is distinct from old.import_scryfall_id or new.import_fingerprint is distinct from old.import_fingerprint then raise exception 'card_provenance_locked",
    );
    expect(body).toContain("errcode = 'insufficient_privilege'");
    expect(FLAT).toContain(
      "create trigger cards_guard_provenance before update of import_scryfall_id, import_fingerprint on public.cards for each row execute function public.guard_card_provenance();",
    );
    expect(FLAT).toContain("revoke all on function public.guard_card_provenance() from public, anon, authenticated;");
  });

  it("is written by nothing in the database (no trigger fills it)", () => {
    expect(FLAT).not.toMatch(/new\.import_(scryfall_id|fingerprint)\s*:?=/);
  });
});

describe("0144 — deck entry origin (DK2.6)", () => {
  it("source takes exactly the app's values, or NULL", () => {
    const check = /add constraint deck_cards_source_valid check \(source is null or source in \(([^)]*)\)\)/.exec(FLAT);
    expect(check).not.toBeNull();
    const values = check![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(values).toEqual([...DECK_ENTRY_SOURCE_VALUES]);
  });

  it("backfills only where certain, with the update triggers off and back on", () => {
    const off = FLAT.indexOf("alter table public.deck_cards disable trigger deck_cards_set_updated_at;");
    const offSync = FLAT.indexOf("alter table public.deck_cards disable trigger deck_cards_sync_deck_update;");
    const on = FLAT.indexOf("alter table public.deck_cards enable trigger deck_cards_set_updated_at;");
    const onSync = FLAT.indexOf("alter table public.deck_cards enable trigger deck_cards_sync_deck_update;");
    const importFill = FLAT.indexOf("set source = 'import' where source is null and scryfall_id is not null;");
    const aiFill = FLAT.indexOf("case when j.kind = 'deck_remix' then 'ai_remix' else 'ai_generate' end as source");
    for (const at of [off, offSync, on, onSync, importFill, aiFill]) expect(at).toBeGreaterThan(-1);
    expect(Math.max(off, offSync)).toBeLessThan(Math.min(importFill, aiFill));
    expect(Math.min(on, onSync)).toBeGreaterThan(Math.max(importFill, aiFill));
    // Every disabled trigger is enabled again.
    const disabled = [...FLAT.matchAll(/disable trigger (\w+);/g)].map((m) => m[1]).sort();
    const enabled = [...FLAT.matchAll(/enable trigger (\w+);/g)].map((m) => m[1]).sort();
    expect(enabled).toEqual(disabled);
    // The AI rows: a job's own card in that job's deck, never a row with a
    // printing or a source already.
    expect(FLAT).toContain("and dc.source is null and dc.scryfall_id is null;");
    expect(FLAT).toContain("jsonb_typeof(job.steps) = 'array'");
  });
});

describe("0144 — other creators' public cards (DK2.9, D3)", () => {
  it("the insert policy: the deck's owner, and their own card or a public one", () => {
    expect(FLAT).toContain('drop policy if exists "Deck cards: owners can insert" on public.deck_cards;');
    const insert = /create policy "Deck cards: owners can insert"[\s\S]*?\);/.exec(SQL)?.[0];
    expect(insert).toBeDefined();
    expect(squash(insert!)).toContain("d.owner_id = (select auth.uid())");
    expect(squash(insert!)).toContain(
      "card_id is null or exists ( select 1 from public.cards c where c.id = card_id and (c.owner_id = (select auth.uid()) or c.visibility = 'public') )",
    );
  });

  it("the update policy checks the deck only; its card rule is the guard's", () => {
    const update = squash(/create policy "Deck cards: owners can update"[\s\S]*?\);\n/.exec(SQL)?.[0] ?? "");
    expect(update).toContain("for update using");
    expect(update).toContain("with check");
    expect(update).not.toContain("public.cards");
    const body = fn(SQL, "guard_deck_card_link");
    expect(body).toContain("if current_user not in ('anon', 'authenticated') then return new; end if;");
    expect(body).toContain("if new.card_id is null then return new; end if;");
    expect(body).toContain("if tg_op = 'UPDATE' and new.card_id is not distinct from old.card_id then return new; end if;");
    expect(body).toContain("(c.owner_id = (select auth.uid()) or c.visibility = 'public')");
    expect(body).toContain("raise exception 'deck_card_not_linkable");
    expect(body).not.toContain("security definer");
    expect(FLAT).toContain(
      "create trigger deck_cards_guard_card_link before insert or update of card_id on public.deck_cards for each row execute function public.guard_deck_card_link();",
    );
    expect(FLAT).toContain("revoke all on function public.guard_deck_card_link() from public, anon, authenticated;");
  });
});

describe("0144 — the entry RPCs", () => {
  it("import_deck_entries is 0143's word for word, but for the new rows' source", () => {
    const now = fn(SQL, "import_deck_entries");
    const before = fn(SQL_0143, "import_deck_entries");
    const undone = now
      .replace("rarity, image_url, source )", "rarity, image_url )")
      .replace("e.rarity, e.image_url, 'import' from", "e.rarity, e.image_url from");
    expect(undone).toBe(before);
    expect(now).not.toBe(before);
    expect(FLAT).toContain("revoke all on function public.import_deck_entries(uuid, jsonb) from public, anon;");
    expect(FLAT).toContain("grant execute on function public.import_deck_entries(uuid, jsonb) to authenticated, service_role;");
  });

  it("add_custom_deck_entry: two defaulted parameters, the 3-argument one dropped, grants restated", () => {
    expect(FLAT).toContain("drop function if exists public.add_custom_deck_entry(uuid, uuid, text);");
    const body = fn(SQL, "add_custom_deck_entry");
    expect(body).toContain("p_source text default 'creator', p_scryfall_id text default null");
    expect(body).toContain("security invoker");
    expect(body).toContain("if p_source is null or p_source not in ('creator', 'link', 'ai_generate', 'ai_remix') then");
    // A card is required (0143 let a NULL make a name-only row), refused
    // before the lock.
    expect(body).toContain("if p_card_id is null then raise exception 'deck_entry_card_missing");
    expect(body.indexOf("deck_entry_card_missing")).toBeLessThan(body.indexOf("pg_advisory_xact_lock"));
    // 0143's lock, ownership check and dedupe, unchanged.
    expect(body).toContain("perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));");
    expect(body).toContain("where d.id = p_deck_id and d.owner_id = (select auth.uid())");
    expect(body).toContain("where dc.deck_id = p_deck_id and dc.card_id = p_card_id");
    expect(body).toContain(
      "insert into public.deck_cards (deck_id, card_id, name, board, quantity, position, source, scryfall_id) values (p_deck_id, p_card_id, p_name, 'main', 1, v_position, p_source, nullif(btrim(p_scryfall_id), ''));",
    );
    expect(FLAT).toContain("revoke all on function public.add_custom_deck_entry(uuid, uuid, text, text, text) from public, anon;");
    expect(FLAT).toContain(
      "grant execute on function public.add_custom_deck_entry(uuid, uuid, text, text, text) to authenticated, service_role;",
    );
  });

  it("the card sources the RPC takes are the app's card-bringing sources", () => {
    const inRpc = /p_source not in \(([^)]*)\)/.exec(FLAT)![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(inRpc.every((source) => (DECK_ENTRY_SOURCE_VALUES as readonly string[]).includes(source))).toBe(true);
    expect(inRpc).not.toContain("import");
    expect(inRpc).not.toContain("manual");
  });
});
