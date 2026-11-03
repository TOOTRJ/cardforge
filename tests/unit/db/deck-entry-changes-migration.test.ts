import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DECK_HISTORY_MAX_ROWS, DECK_HISTORY_PRO_GRACE_DAYS } from "@/lib/decks/deck-history";

// ---------------------------------------------------------------------------
// 0165 — the deck change history (TODO DK5.13). ONE row trigger on
// deck_cards writes it (every write path, once); the table is append-only
// for every API role and the deck owner's to read (RLS); retention by plan
// is a service-role function, with a 30-day grace once an owner's Pro ends
// (owner 2026-11-02) and a per-deck cap; a restore claims its deck. The
// behaviour was proved on the local Supabase stack (PR body: BEGIN …
// ROLLBACK — past_due today keeps the rows, Pro ended 31 days ago prunes
// them, the cap, the claim's stale / busy / not_found, the refused writes).
// ---------------------------------------------------------------------------

const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const SQL = squash(strip(readFileSync(join(process.cwd(), "supabase/migrations/0165_deck_entry_changes.sql"), "utf8")));

describe("0165: deck_entry_changes", () => {
  it("logs every insert, update and delete of deck_cards from ONE row trigger", () => {
    expect(SQL).toContain(
      "create trigger deck_cards_log_change after insert or update or delete on public.deck_cards for each row execute function public.log_deck_entry_change();",
    );
    expect(SQL).toMatch(/create or replace function public\.log_deck_entry_change\(\) returns trigger language plpgsql security definer set search_path = ''/);
    // An update counts only when it changes the list.
    expect(SQL).toContain("(new.quantity, new.board, new.card_id, new.scryfall_id, new.name) is not distinct from (old.quantity, old.board, old.card_id, old.scryfall_id, old.name)");
    expect(SQL).toContain("auth.uid()");
  });

  it("keeps a deck's delete working: no foreign key on the log, and a gone deck is skipped", () => {
    const log = SQL.slice(SQL.indexOf("create table if not exists public.deck_entry_changes"), SQL.indexOf("comment on table public.deck_entry_changes"));
    expect(log).toContain("deck_id uuid not null,");
    expect(log).not.toMatch(/references/);
    expect(SQL).toContain("if not exists (select 1 from public.decks d where d.id = v_deck) then return null;");
    // The restore lease goes with its deck (a cascade, nothing logged).
    expect(SQL).toContain("deck_id uuid primary key references public.decks (id) on delete cascade,");
  });

  it("is the deck OWNER's to read, through RLS", () => {
    expect(SQL).toContain("alter table public.deck_entry_changes enable row level security;");
    expect(SQL).toMatch(/for select to authenticated using \( exists \( select 1 from public\.decks d where d\.id = deck_entry_changes\.deck_id and d\.owner_id = \(select auth\.uid\(\)\) \) \)/);
    expect(SQL).not.toMatch(/for (insert|update|delete|all)/);
  });

  it("states its grants, revoke first: append-only for every API role — service_role's default privileges too", () => {
    // A new project's default privileges hand service_role everything on a
    // new table: revoked from it as well, then SELECT + DELETE back.
    const revoke = SQL.indexOf("revoke all on table public.deck_entry_changes from public, anon, authenticated, service_role;");
    const grant = SQL.indexOf("grant select on table public.deck_entry_changes to authenticated;");
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(SQL.indexOf("grant select, delete on table public.deck_entry_changes to service_role;")).toBeGreaterThan(revoke);
    for (const table of ["deck_entry_changes", "deck_history_pro_ends", "deck_restore_leases"]) {
      expect(SQL).toContain(`revoke all on table public.${table} from public, anon, authenticated, service_role;`);
      expect(SQL).not.toMatch(new RegExp(`grant [^;]*(insert|update|truncate)[^;]* on table public\\.${table}`));
    }
    expect(SQL).toContain("grant select on table public.deck_history_pro_ends to service_role;");
    expect(SQL).toContain("grant select on table public.deck_restore_leases to service_role;");
    expect(SQL).not.toMatch(/grant [^;]* to anon/);
    for (const trigger of ["log_deck_entry_change()", "stamp_deck_history_pro_end()"]) {
      expect(SQL).toContain(`revoke all on function public.${trigger} from public, anon, authenticated;`);
      expect(SQL).not.toContain(`grant execute on function public.${trigger}`);
    }
    expect(SQL).toContain("revoke all on function public.prune_deck_entry_changes(integer, boolean, integer, integer) from public, anon, authenticated;");
    expect(SQL).toContain("grant execute on function public.prune_deck_entry_changes(integer, boolean, integer, integer) to service_role;");
    expect(SQL).toContain("grant execute on function public.claim_deck_restore(uuid, bigint) to authenticated, service_role;");
    expect(SQL).toContain("grant execute on function public.release_deck_restore(uuid, uuid) to authenticated, service_role;");
  });

  it("prunes by the owner's plan with viewer_is_pro's rule — Pro keeps everything", () => {
    expect(SQL).toContain("p_is_admin or (p_tier = 'pro' and p_status in ('active', 'trialing')) or (p_comp_tier = 'pro' and (p_comp_expires_at is null or p_comp_expires_at > now()))");
    expect(SQL).toContain("and not public.deck_history_owner_is_pro(p.is_admin, p.subscription_tier, p.subscription_status, p.comp_tier, p.comp_expires_at)");
    expect(SQL).toContain("if p_by_plan then");
  });

  it("keeps a lapsed Pro's older rows 30 days from when Pro ENDED — recorded at the write, never 'now'", () => {
    // The stamp: the profile write that takes the owner from Pro to not-Pro.
    expect(SQL).toContain(
      "create trigger profiles_stamp_deck_history_pro_end after update of is_admin, subscription_tier, subscription_status, comp_tier, comp_expires_at on public.profiles for each row execute function public.stamp_deck_history_pro_end();",
    );
    expect(SQL).toMatch(/if public\.deck_history_owner_is_pro\(new\.[^)]*\) then delete from public\.deck_history_pro_ends e where e\.owner_id = new\.id; elsif public\.deck_history_owner_is_pro\(old\.[^)]*\) then insert into public\.deck_history_pro_ends/);
    // The prune: the stamp or a Pro comp run out by the clock, inside the grace.
    expect(SQL).toContain("left join public.deck_history_pro_ends e on e.owner_id = d.owner_id");
    expect(SQL).toContain("greatest( e.ended_at, case when p.comp_tier = 'pro' and p.comp_expires_at <= now() then p.comp_expires_at end )");
    expect(SQL).toContain("< now() - make_interval(days => greatest(coalesce(p_grace_days, 30), 0));");
    expect(SQL).toContain("p_grace_days integer default 30,");
    expect(DECK_HISTORY_PRO_GRACE_DAYS).toBe(30);
  });

  it("caps every deck at its newest DECK_HISTORY_MAX_ROWS changes — in the trigger (amortised) and the prune", () => {
    expect(DECK_HISTORY_MAX_ROWS).toBe(10_000);
    expect(SQL).toContain(`if v_id % 64 = 0 then perform public.cap_deck_entry_changes(v_deck, ${DECK_HISTORY_MAX_ROWS});`);
    expect(SQL).toContain(`p_max_rows integer default ${DECK_HISTORY_MAX_ROWS}`);
    expect(SQL).toContain("v_capped := v_capped + public.cap_deck_entry_changes(v_deck, p_max_rows);");
  });

  it("one restore per deck at a time, from the head it was planned on, under the entry lock", () => {
    const claim = SQL.slice(SQL.indexOf("create or replace function public.claim_deck_restore"), SQL.indexOf("create or replace function public.release_deck_restore"));
    expect(claim).toContain("d.owner_id = auth.uid()");
    const lock = claim.indexOf("perform pg_advisory_xact_lock(hashtextextended('deck_entries:' || p_deck_id::text, 0));");
    expect(lock).toBeGreaterThan(0);
    expect(claim.indexOf("'busy'")).toBeGreaterThan(lock);
    expect(claim.indexOf("if v_head is distinct from p_head then return jsonb_build_object('ok', false, 'reason', 'stale');")).toBeGreaterThan(lock);
    expect(claim).toContain("now() + interval '2 minutes'");
  });
});
