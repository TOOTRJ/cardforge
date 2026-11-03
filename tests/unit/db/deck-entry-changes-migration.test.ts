import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0164 — the deck change history (TODO DK5.13). ONE row trigger on
// deck_cards writes it (every write path, once); the table is append-only
// for every API role and the deck owner's to read (RLS); retention by plan
// is a service-role function. Behaviour proved on a local Postgres 16 (PR
// body): logging, the skipped no-op updates, the refused writes, another
// user reading nothing, the prune, and a deck delete that still cascades.
// ---------------------------------------------------------------------------

const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const SQL = squash(strip(readFileSync(join(process.cwd(), "supabase/migrations/0164_deck_entry_changes.sql"), "utf8")));

describe("0164: deck_entry_changes", () => {
  it("logs every insert, update and delete of deck_cards from ONE row trigger", () => {
    expect(SQL).toContain(
      "create trigger deck_cards_log_change after insert or update or delete on public.deck_cards for each row execute function public.log_deck_entry_change();",
    );
    expect(SQL).toMatch(/create or replace function public\.log_deck_entry_change\(\) returns trigger language plpgsql security definer set search_path = ''/);
    // An update counts only when it changes the list.
    expect(SQL).toContain("(new.quantity, new.board, new.card_id, new.scryfall_id, new.name) is not distinct from (old.quantity, old.board, old.card_id, old.scryfall_id, old.name)");
    expect(SQL).toContain("auth.uid()");
  });

  it("keeps a deck's delete working: no foreign key, and a gone deck is skipped", () => {
    expect(SQL).not.toMatch(/references public\.decks/);
    expect(SQL).toContain("if not exists (select 1 from public.decks d where d.id = v_deck) then return null;");
  });

  it("is the deck OWNER's to read, through RLS", () => {
    expect(SQL).toContain("alter table public.deck_entry_changes enable row level security;");
    expect(SQL).toMatch(/for select to authenticated using \( exists \( select 1 from public\.decks d where d\.id = deck_entry_changes\.deck_id and d\.owner_id = \(select auth\.uid\(\)\) \) \)/);
    expect(SQL).not.toMatch(/for (insert|update|delete|all)/);
  });

  it("states its grants, revoke first: append-only for every API role", () => {
    const revoke = SQL.indexOf("revoke all on table public.deck_entry_changes from public, anon, authenticated;");
    const grant = SQL.indexOf("grant select on table public.deck_entry_changes to authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(SQL).toContain("grant select, delete on table public.deck_entry_changes to service_role;");
    expect(SQL).not.toMatch(/grant [^;]*(insert|update)[^;]* on table public\.deck_entry_changes/);
    expect(SQL).not.toMatch(/grant [^;]* to anon/);
    expect(SQL).toContain("revoke all on function public.log_deck_entry_change() from public, anon, authenticated;");
    expect(SQL).not.toMatch(/grant execute on function public\.log_deck_entry_change/);
    expect(SQL).toContain("revoke all on function public.prune_deck_entry_changes(integer, boolean) from public, anon, authenticated;");
    expect(SQL).toContain("grant execute on function public.prune_deck_entry_changes(integer, boolean) to service_role;");
  });

  it("prunes by the owner's plan with viewer_is_pro's rule — Pro keeps everything", () => {
    expect(SQL).toContain("p.is_admin or (p.subscription_tier = 'pro' and p.subscription_status in ('active', 'trialing')) or (p.comp_tier = 'pro' and (p.comp_expires_at is null or p.comp_expires_at > now()))");
    expect(SQL).toContain("if p_by_plan then");
  });
});
