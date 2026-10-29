import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canLinkIntoDeck } from "@/lib/decks/entry-status";
import { PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import { DECK_ENTRIES_FUNCTION } from "@/lib/decks/queries";

// ---------------------------------------------------------------------------
// 0152 — a private card's text never leaves its deck entry. What the SQL
// itself must keep, held to the app (its behaviour — anon, another signed-in
// user, the unlisted deck's link header, the owner, privatise / publish, the
// forced-private save, a printing, the counts, 0151's guide redaction and
// the seeds — is proved on the local stack in ONE rolled-back transaction,
// PR body):
//   * ONE rule for "does the deck show this card to a visitor":
//     deck_shows_card — the cards' RLS (public / unlisted readable by
//     anyone) AND canLinkIntoDeck (another creator's card only while public);
//   * the read policy: the deck's owner reads every row; anyone else who may
//     read the deck reads every row but a HIDDEN one (a linked card the deck
//     doesn't show them, no printing behind it);
//   * the page's read (deck_entries_for_viewer): every row, a hidden one
//     masked as the page draws it ("Private card") with EVERY column it holds
//     from the card cleared — a new deck_cards column must be classified
//     here before this test passes.
// ---------------------------------------------------------------------------

const root = process.cwd();
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const SQL = strip(readFileSync(join(root, "supabase/migrations/0152_deck_entry_private_text.sql"), "utf8"));
const FLAT = squash(SQL);

function fnBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = SQL.indexOf("$$", start);
  const close = SQL.indexOf("$$", open + 2);
  return squash(SQL.slice(open + 2, close));
}

function fnHead(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  return squash(SQL.slice(start, SQL.indexOf("$$", start)));
}

function policyUsing(name: string): string {
  const start = SQL.indexOf(`create policy "${name}"`);
  if (start < 0) throw new Error(`no policy ${name}`);
  return squash(SQL.slice(start, SQL.indexOf(";", start)));
}

/** deck_cards' columns as types/supabase.ts states its Row. */
function deckCardColumns(): string[] {
  const types = readFileSync(join(root, "types/supabase.ts"), "utf8");
  const start = types.indexOf("      deck_cards: {");
  const row = types.slice(types.indexOf("Row: {", start), types.indexOf("Insert: {", start));
  return [...row.matchAll(/^\s{10}([a-z_]+)\??:/gm)].map((m) => m[1]!);
}

const POLICY = "Deck cards: the owner's, and a visitor's where the card shows";

describe("0152: the one rule — does a deck show this card to a visitor?", () => {
  it("is a public card, or the deck owner's own unlisted one", () => {
    expect(fnBody("deck_shows_card")).toContain(
      "p_card_visibility = 'public' or (p_card_visibility = 'unlisted' and p_card_owner = p_deck_owner)",
    );
    expect(fnHead("deck_shows_card")).toContain("immutable set search_path = ''");
  });

  it("is the cards' RLS (public / unlisted readable by anyone) AND canLinkIntoDeck, for every case", () => {
    // The SQL predicate, word for word above.
    const sql = (visibility: string, cardOwner: string, deckOwner: string) =>
      visibility === "public" || (visibility === "unlisted" && cardOwner === deckOwner);
    for (const visibility of ["public", "unlisted", "private"]) {
      for (const cardOwner of ["deck-owner", "someone-else"]) {
        const visitorReadsCard = visibility === "public" || visibility === "unlisted";
        const app = visitorReadsCard && canLinkIntoDeck({ owner_id: cardOwner, visibility }, "deck-owner");
        expect(sql(visibility, cardOwner, "deck-owner"), `${visibility} card of ${cardOwner}`).toBe(app);
      }
    }
  });
});

describe("0152: the entries' read policy", () => {
  it("replaces 0055 / 0151's one SELECT policy (same name) — never left beside it", () => {
    expect(FLAT).toContain(`drop policy if exists "Deck cards: visible when parent deck is readable" on public.deck_cards;`);
    expect(FLAT).toContain(`drop policy if exists "${POLICY}" on public.deck_cards;`);
    expect(SQL.match(/create policy[^;]*on public\.deck_cards/g)).toHaveLength(1);
  });

  it("reads the deck under the caller's rules (0151's link header included), then: the owner, or a row that isn't hidden", () => {
    const using = policyUsing(POLICY);
    expect(using).toContain("for select");
    expect(using).toContain("exists ( select 1 from public.decks d where d.id = deck_cards.deck_id and (");
    expect(using).toContain("d.owner_id = (select auth.uid())");
    expect(using).toContain("or deck_cards.card_id is null");
    expect(using).toContain("or deck_cards.scryfall_id is not null");
    expect(using).toContain(
      "or exists ( select 1 from public.cards c where c.id = deck_cards.card_id and public.deck_shows_card(c.visibility, c.owner_id, d.owner_id) )",
    );
    // No deck visibility list of its own: the decks policy decides who may
    // read the deck at all.
    expect(using).not.toMatch(/d\.visibility/);
  });
});

describe("0152: the deck page's read, deck_entries_for_viewer", () => {
  const body = fnBody("deck_entries_for_viewer");

  it("is the app's read (lib/decks/queries.ts), a definer with an empty search path, every API role's", () => {
    expect(DECK_ENTRIES_FUNCTION).toBe("deck_entries_for_viewer");
    expect(fnHead("deck_entries_for_viewer")).toContain(
      "returns setof public.deck_cards language plpgsql stable security definer set search_path = ''",
    );
    expect(FLAT).toContain("revoke all on function public.deck_entries_for_viewer(uuid) from public;");
    expect(FLAT).toContain("grant execute on function public.deck_entries_for_viewer(uuid) to anon, authenticated, service_role;");
    expect(FLAT).toContain("revoke all on function public.deck_shows_card(text, uuid, uuid) from public;");
    expect(FLAT).toContain("grant execute on function public.deck_shows_card(text, uuid, uuid) to anon, authenticated, service_role;");
  });

  it("opens the decks the page opens (0151's guide function's rule): public, unlisted by its id, or the caller's own", () => {
    expect(body).toContain("where d.id = p_deck_id and (d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid());");
    expect(body).toContain("if not found then return; end if;");
    expect(body).toContain("v_is_owner := coalesce(v_owner = auth.uid(), false);");
  });

  it("hides what the policy hides — a linked card the deck doesn't show, no printing — from anyone but the owner", () => {
    expect(body).toContain(
      "e.card_id is not null and e.scryfall_id is null and not coalesce(public.deck_shows_card(c.visibility, c.owner_id, v_owner), false) as hidden",
    );
    expect(body).toContain("if v_row.hidden and not v_is_owner then");
  });

  it("names a hidden entry as the page does, and clears EVERY column it holds from the card", () => {
    expect(body).toContain(`v_entry.name := '${PRIVATE_CARD_NAME}';`);
    const masked = [...body.matchAll(/v_entry\.([a-z_]+) :=/g)].map((m) => m[1]!).sort();
    // The entry itself — what the visitor's list counts and lays out.
    const kept = ["board", "card_id", "created_at", "deck_id", "featured_rank", "id", "position", "quantity", "scryfall_id", "source", "updated_at"];
    expect([...masked, ...kept].sort()).toEqual([...deckCardColumns()].sort());
    for (const column of masked.filter((c) => c !== "name")) {
      expect(body).toMatch(new RegExp(`v_entry\\.${column} := (null|'\\{\\}'::text\\[\\]);`));
    }
  });
});
