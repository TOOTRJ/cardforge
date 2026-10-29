import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0143 — the deck data layer (TODO DK0.1, DK0.2, DK0.3, DK0.8). The SQL is
// proved on the local stack (the PR body has the run); this holds the file
// to what the app relies on:
//   * decks.card_count / linked_card_count are recounted by ONE statement-
//     level trigger function on deck_cards that also touches updated_at
//     (0103's per-row touch is gone), locked before it counts;
//   * API roles can't write the counters, created_at, or decks.updated_at;
//   * the 500-row cap and the import's merge rule are stated once and the
//     same everywhere (the app's side — MAX_DECK_ENTRIES, importMergeKey,
//     the entry fields — is held to this file by
//     tests/unit/decks/import-entries-sql.test.ts);
//   * the RPCs are SECURITY INVOKER (RLS applies), not callable by anon;
//   * no unique index on deck_cards (production may hold duplicates);
//   * scryfall_calls takes the commit's own action.
// Self-contained on purpose: this file ships with the migration, ahead of
// the code that uses it.
// ---------------------------------------------------------------------------

/** The entry cap (lib/decks/import-plan.ts MAX_DECK_ENTRIES). */
const ENTRY_CAP = 500;
/** deck_cards' quantity CHECK (0055) — lib/decks/parse-decklist.ts
 *  MAX_ENTRY_QUANTITY. */
const MAX_QUANTITY = 250;

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(readFileSync(join(dir, "0143_deck_counts_and_counter_guards.sql"), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const FLAT = squash(SQL);

/** The body of `create or replace function public.<name>(` … `$$;`. */
function fn(name: string): string {
  const m = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "i").exec(SQL);
  if (!m) throw new Error(`no function ${name}`);
  return squash(m[0]);
}

describe("0143 — stored deck counts", () => {
  it("adds the two counts as NOT NULL integers defaulting to 0", () => {
    expect(FLAT).toContain("add column if not exists card_count integer not null default 0");
    expect(FLAT).toContain("add column if not exists linked_card_count integer not null default 0");
  });

  it("recounts in ONE security-definer function, per statement, for insert / update / delete", () => {
    const body = fn("sync_deck_from_entries");
    expect(body).toContain("returns trigger");
    expect(body).toContain("security definer");
    // the app's `cards_count`: quantities summed, maybeboard excluded …
    expect(body).toContain("coalesce(sum(dc.quantity) filter (where dc.board <> 'maybe'), 0)");
    // … and `remixed_count`: the same, linked entries only.
    expect(body).toContain("filter (where dc.board <> 'maybe' and dc.card_id is not null)");
    expect(body).toContain("updated_at = now()");
    // locked (in id order) before it counts — NO KEY UPDATE, so a foreign-
    // key check on the deck (a like, a new entry) never waits for it
    expect(body).toMatch(/for no key update; update public\.decks d set card_count/);
    expect(body).toContain("order by d.id for no key update");
    expect(body).not.toMatch(/order by d\.id for update/);
    for (const [event, refs] of [
      ["insert", "referencing new table as new_entries"],
      ["update", "referencing old table as old_entries new table as new_entries"],
      ["delete", "referencing old table as old_entries"],
    ] as const) {
      expect(FLAT).toContain(
        `create trigger deck_cards_sync_deck_${event} after ${event} on public.deck_cards ${refs} for each statement execute function public.sync_deck_from_entries();`,
      );
    }
  });

  it("drops 0103's per-row touch, and backfills every deck", () => {
    expect(FLAT).toContain("drop trigger if exists deck_cards_touch_deck on public.deck_cards;");
    expect(FLAT).toContain("drop function if exists public.touch_deck_from_entry();");
    expect(FLAT).toMatch(/update public\.decks d set card_count = s\.card_count, linked_card_count = s\.linked_card_count from \( select dk\.id as deck_id/);
  });

  it("the stored counts never read as an edit; an explicit updated_at only from a trusted path", () => {
    const body = fn("set_decks_updated_at");
    expect(body).toContain(
      "(to_jsonb(new) - 'view_count' - 'likes_count' - 'card_count' - 'linked_card_count' - 'updated_at')",
    );
    expect(body).toContain(
      "elsif new.updated_at is distinct from old.updated_at and current_user not in ('anon', 'authenticated') then",
    );
  });

  it("the hub counts read non-empty as card_count > 0, like the lists", () => {
    const body = fn("public_deck_format_counts");
    expect(body).toContain("d.card_count > 0");
    expect(body).not.toContain("deck_cards");
    expect(FLAT).toContain(
      "grant execute on function public.public_deck_format_counts() to anon, authenticated, service_role;",
    );
  });
});

describe("0143 — counters are the server's", () => {
  it("decks: every counter and created_at, on insert and on update, for API roles only", () => {
    const body = fn("guard_deck_counters");
    expect(body).toContain("if current_user not in ('anon', 'authenticated') then return new;");
    for (const col of ["likes_count", "view_count", "card_count", "linked_card_count"]) {
      expect(body).toContain(`new.${col} := 0;`);
      expect(body).toContain(`new.${col} := old.${col};`);
    }
    expect(body).toContain("new.created_at := now();");
    expect(body).toContain("new.updated_at := now();");
    expect(body).toContain("new.created_at := old.created_at;");
    expect(FLAT).toContain(
      "create trigger decks_guard_counters before insert or update of likes_count, view_count, card_count, linked_card_count, created_at on public.decks",
    );
  });

  it("cards: likes, views, shares and created_at; a new card's updated_at is now() — an update's stays 0108's", () => {
    const body = fn("guard_card_counters");
    for (const col of ["likes_count", "view_count", "share_count"]) {
      expect(body).toContain(`new.${col} := 0;`);
      expect(body).toContain(`new.${col} := old.${col};`);
    }
    expect(body).toContain("new.created_at := now(); new.updated_at := now(); else");
    expect(body).toContain("new.created_at := old.created_at;");
    expect(body).not.toContain("new.updated_at := old.updated_at");
    expect(body).not.toContain("rendered");
    expect(FLAT).toContain(
      "create trigger cards_guard_counters before insert or update of likes_count, view_count, share_count, created_at on public.cards",
    );
  });

  it("each guard fires before its table's updated_at trigger (same timing = name order)", () => {
    expect("decks_guard_counters" < "decks_set_updated_at").toBe(true);
    expect("cards_guard_counters" < "cards_set_updated_at").toBe(true);
  });
});

describe("0143 — entries per deck and the import", () => {
  it("the cap is ONE number everywhere the SQL states it", () => {
    const caps = [
      ...SQL.matchAll(/at most (\d+) entries/g),
      ...SQL.matchAll(/v_count >= (\d+)/g),
      ...SQL.matchAll(/v_existing \+ v_new > (\d+)/g),
      ...SQL.matchAll(/jsonb_array_length\(p_entries\) > (\d+)/g),
    ].map((m) => Number(m[1]));
    expect(caps.length).toBeGreaterThanOrEqual(5);
    expect(new Set(caps)).toEqual(new Set([ENTRY_CAP]));
  });

  it("caps API roles only, on insert and on a move into another deck, under the shared lock", () => {
    const body = fn("guard_deck_entry_limit");
    expect(body).toContain("if current_user not in ('anon', 'authenticated') then return new;");
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('deck_entries:' || new.deck_id::text, 0))");
    expect(body).toContain("using errcode = 'check_violation'");
    expect(FLAT).toContain(
      "create trigger deck_cards_guard_entry_limit before insert or update of deck_id on public.deck_cards for each row",
    );
  });

  it("every entry writer takes the SAME per-deck lock", () => {
    const locks = [...SQL.matchAll(/pg_advisory_xact_lock\(hashtextextended\('([a-z_]+):'/g)].map((m) => m[1]);
    expect(locks).toEqual(["deck_entries", "deck_entries", "deck_entries"]);
  });

  it("import_deck_entries: invoker, owner-checked, merges on one key, clamps to the entry maximum", () => {
    const body = fn("import_deck_entries");
    expect(body).toContain("security invoker");
    expect(body).toContain("d.owner_id = (select auth.uid())");
    // The merge key: board + Scryfall id, else board + the trimmed,
    // lower-cased name — in the duplicate check and in the match alike.
    expect(body).toContain("group by e.board, coalesce(e.scryfall_id, 'name:' || lower(btrim(e.name)))");
    expect(body).toContain(
      "when e.scryfall_id is not null then dc.scryfall_id = e.scryfall_id else dc.scryfall_id is null and lower(btrim(dc.name)) = lower(btrim(e.name))",
    );
    // two lines on one row add up (never overwrite each other)
    expect(body).toContain("sum(hit.quantity)::integer as added");
    expect(body).toContain(`least(dc.quantity + m.added, ${MAX_QUANTITY})`);
    // a full deck still takes merges
    expect(body).toContain("if v_new > 0 and v_existing + v_new >");
  });

  it("inserts the Scryfall copy fields only — never a card_id from the payload", () => {
    const body = fn("import_deck_entries");
    const cols = /insert into public\.deck_cards \( ([^)]*) \)/.exec(body)?.[1].split(",").map((c) => c.trim());
    expect(cols).toBeDefined();
    expect(cols).not.toContain("card_id");
    expect(cols).not.toContain("id");
    expect(cols).toEqual(expect.arrayContaining(["deck_id", "position", "board", "quantity", "name", "scryfall_id"]));
  });

  it("add_custom_deck_entry: invoker, owner-checked, one copy on the main board unless already in the deck", () => {
    const body = fn("add_custom_deck_entry");
    expect(body).toContain("security invoker");
    expect(body).toContain("d.owner_id = (select auth.uid())");
    expect(body).toContain("where dc.deck_id = p_deck_id and dc.card_id = p_card_id");
    expect(body).toContain("values (p_deck_id, p_card_id, p_name, 'main', 1, v_position)");
  });

  it("states its grants: the RPCs for signed-in users, never anon; trigger functions for no API role", () => {
    expect(FLAT).toContain("revoke all on function public.import_deck_entries(uuid, jsonb) from public, anon;");
    expect(FLAT).toContain("grant execute on function public.import_deck_entries(uuid, jsonb) to authenticated, service_role;");
    expect(FLAT).toContain("revoke all on function public.add_custom_deck_entry(uuid, uuid, text) from public, anon;");
    expect(FLAT).toContain(
      "grant execute on function public.add_custom_deck_entry(uuid, uuid, text) to authenticated, service_role;",
    );
    for (const name of ["sync_deck_from_entries", "guard_deck_counters", "guard_card_counters", "guard_deck_entry_limit"]) {
      expect(FLAT).toContain(`revoke all on function public.${name}() from public, anon, authenticated;`);
    }
  });

  it("scryfall_calls takes the commit's own action: 0056's list plus deck_import_commit", () => {
    const actions = (sql: string) => {
      const all = [...sql.matchAll(/add constraint scryfall_calls_action_check\s+check \(action in \(([^)]*)\)\)/g)];
      const last = all.at(-1);
      if (!last) throw new Error("no scryfall_calls_action_check");
      return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    const before = actions(strip(readFileSync(join(dir, "0056_scryfall_deck_import_action.sql"), "utf8")));
    expect(actions(SQL)).toEqual([...before, "deck_import_commit"]);
  });

  it("adds no unique index on deck_cards (production may already hold duplicate rows)", () => {
    expect(SQL).not.toMatch(/create unique index/i);
    expect(SQL).not.toMatch(/add constraint [a-z_]+ unique/i);
  });
});
