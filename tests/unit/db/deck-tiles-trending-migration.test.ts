import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// 0149 — trending decks, "In N decks" and the deck notifications (TODO
// DK8.2, DK8.4, DK8.6). What the SQL itself must keep (its behaviour —
// trending order, the rule matching 0144's list, no private / unlisted /
// admin / throwaway deck, grants, the triggers — is proved on the local
// stack in one rolled-back transaction, PR body):
//   * ONE rule: public_deck_card_pairs holds 0144's predicate word for word,
//     and the list, the count and the notification all read it — never a
//     copy of the predicate;
//   * the list keeps 0144's signature, order and cap;
//   * trending is public, non-empty, admin-free, the last 7 days' likes
//     without the owner's own, SECURITY INVOKER, capped at 24;
//   * the notification CHECK is 0140's kinds plus the two; each kind once
//     (unique partial indexes, ON CONFLICT DO NOTHING); the card-added
//     trigger is DEFERRED (judged at commit, after 0143's statement
//     trigger stores card_count); no trigger can fail its write;
//   * grants: the readers to anon / authenticated / service_role, the
//     trigger helpers to no API role.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const SQL = strip(readFileSync(join(dir, "0149_deck_tiles_trending.sql"), "utf8"));
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The body of `create or replace function public.<name>(` … `$$;`. */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

function typeCheckKinds(sql: string): string[] {
  const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
  const last = all.at(-1);
  if (!last) throw new Error("no notifications_type_check");
  return [...last[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** 0144's rule: the WHERE of public_decks_containing_card past the card id. */
function rule0144(): string {
  const body = fnBody(strip(readFileSync(join(dir, "0144_deck_card_origin.sql"), "utf8")), "public_decks_containing_card");
  const from = body.indexOf("and d.visibility = 'public'");
  const to = body.indexOf("group by");
  return squash(body.slice(from, to));
}

describe("0149 — one rule for a card's public decks", () => {
  it("public_deck_card_pairs carries 0144's predicate word for word", () => {
    expect(squash(fnBody(SQL, "public_deck_card_pairs"))).toContain(rule0144());
  });

  it("the list, the count and the card-added notification read the pairs — and nothing restates the rule", () => {
    expect(squash(fnBody(SQL, "public_decks_containing_card"))).toContain("from public.public_deck_card_pairs(array[p_card_id]) p");
    expect(squash(fnBody(SQL, "public_deck_counts_for_cards"))).toContain("from public.public_deck_card_pairs((p_card_ids)[1:200]) p");
    expect(squash(fnBody(SQL, "notify_deck_cards_added"))).toContain("from public.public_deck_card_pairs(p_card_ids, p_deck_id) p");
    // The predicate appears ONCE in the file (in the pairs function).
    expect(SQL.match(/owner_is_admin\(d\.owner_id\)/g)?.length).toBe(2); // pairs + trending
    expect(SQL.match(/own\.visibility = 'public'/g)?.length).toBe(1);
  });

  it("the list keeps 0144's signature, order and cap (create or replace keeps its ACL)", () => {
    expect(SQL).toContain("create or replace function public.public_decks_containing_card(p_card_id uuid, p_limit integer default 5)");
    expect(SQL).toContain("returns table (slug text, title text)");
    const body = squash(fnBody(SQL, "public_decks_containing_card"));
    expect(body).toContain("order by d.updated_at desc, d.id");
    expect(body).toContain("limit least(greatest(coalesce(p_limit, 5), 1), 24)");
  });

  it("every reader is SECURITY INVOKER with an empty search_path", () => {
    for (const name of ["public_deck_card_pairs", "public_decks_containing_card", "public_deck_counts_for_cards", "list_trending_decks"]) {
      const head = SQL.slice(SQL.indexOf(`create or replace function public.${name}(`));
      const decl = head.slice(0, head.indexOf("$$"));
      expect(decl, name).toContain("security invoker");
      expect(decl, name).toContain("set search_path = ''");
    }
  });
});

describe("0149 — trending decks", () => {
  const body = squash(fnBody(SQL, "list_trending_decks"));
  it("ranks public, non-empty, non-admin decks by the last 7 days' likes, the owner's own left out", () => {
    expect(body).toContain("l.created_at >= now() - interval '7 days'");
    expect(body).toContain("l.user_id <> d.owner_id");
    expect(body).toContain("d.visibility = 'public'");
    expect(body).toContain("d.card_count > 0");
    expect(body).toContain("likes.recent > 0");
    expect(body).toContain("not public.owner_is_admin(d.owner_id)");
    expect(body).toContain("order by likes.recent desc, d.likes_count desc, d.updated_at desc, d.id");
    expect(body).toContain("limit least(greatest(coalesce(p_limit, 8), 1), 24)");
  });

  it("reads the likes per deck through (deck_id, created_at), which replaces the (deck_id) index", () => {
    expect(squash(SQL)).toContain("create index if not exists deck_likes_deck_id_created_at_idx on public.deck_likes (deck_id, created_at);");
    expect(SQL).toContain("drop index if exists public.deck_likes_deck_id_idx;");
  });
});

describe("0149 — notifications", () => {
  it("the CHECK is 0140's kinds plus deck_like and deck_card_added", () => {
    const before = typeCheckKinds(strip(readFileSync(join(dir, "0140_credit_refill_failed_notifications.sql"), "utf8")));
    expect(typeCheckKinds(SQL)).toEqual([...before, "deck_like", "deck_card_added"]);
  });

  it("each kind is written once ever: a unique partial index and ON CONFLICT DO NOTHING on it", () => {
    const flat = squash(SQL);
    expect(flat).toContain(
      "create unique index if not exists notifications_deck_like_once_idx on public.notifications (actor_id, (payload ->> 'deckId')) where type = 'deck_like';",
    );
    expect(flat).toContain(
      "create unique index if not exists notifications_deck_card_added_once_idx on public.notifications (card_id, (payload ->> 'deckId')) where type = 'deck_card_added';",
    );
    expect(squash(fnBody(SQL, "notify_on_deck_like"))).toContain("on conflict (actor_id, (payload ->> 'deckId')) where type = 'deck_like' do nothing");
    expect(squash(fnBody(SQL, "notify_deck_cards_added"))).toContain(
      "on conflict (card_id, (payload ->> 'deckId')) where type = 'deck_card_added' do nothing",
    );
  });

  it("a like notifies only a public deck's owner, never for their own like", () => {
    const body = squash(fnBody(SQL, "notify_on_deck_like"));
    expect(body).toContain("if v_owner is null or v_owner = new.user_id or v_visibility <> 'public' then return new;");
  });

  it("a card is announced only to another user, at commit (deferred), and when a deck turns public", () => {
    expect(squash(fnBody(SQL, "notify_deck_cards_added"))).toContain("where c.owner_id <> d.owner_id");
    const flat = squash(SQL);
    expect(flat).toContain(
      "create constraint trigger deck_cards_notify_card_added after insert or update of card_id on public.deck_cards deferrable initially deferred for each row when (new.card_id is not null)",
    );
    expect(flat).toContain(
      "create trigger decks_notify_published after update of visibility on public.decks for each row when (new.visibility = 'public' and old.visibility is distinct from 'public')",
    );
  });

  it("no trigger fails the write that fired it", () => {
    for (const name of ["notify_on_deck_like", "notify_on_deck_card_link", "notify_on_deck_published"]) {
      expect(squash(fnBody(SQL, name)), name).toContain("exception when others then raise warning");
    }
  });
});

describe("0149 — grants", () => {
  it("the readers are public reads; the trigger helpers belong to no API role", () => {
    const flat = squash(SQL);
    for (const sig of [
      "public_deck_card_pairs(uuid[], uuid)",
      "public_decks_containing_card(uuid, integer)",
      "public_deck_counts_for_cards(uuid[])",
      "list_trending_decks(integer)",
    ]) {
      expect(flat).toContain(`revoke all on function public.${sig} from public;`);
      expect(flat).toContain(`grant execute on function public.${sig} to anon, authenticated, service_role;`);
    }
    for (const sig of [
      "notify_deck_cards_added(uuid, uuid[])",
      "notify_on_deck_like()",
      "notify_on_deck_card_link()",
      "notify_on_deck_published()",
    ]) {
      expect(flat).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(flat).not.toContain(`grant execute on function public.${sig}`);
    }
  });
});

describe("0149 — the preview seed", () => {
  const seed = readFileSync(join(process.cwd(), "supabase/seeds/27_deck_tiles_trending.sql"), "utf8");
  it("dates its likes inside and outside the week, gives an admin a liked public deck, links another creator's public card", () => {
    expect(seed).toContain("on conflict (user_id, deck_id) do nothing");
    expect(seed).toContain("interval '12 days'");
    expect(seed).toMatch(/'b0000000-0000-4000-a000-000000000005'::uuid, 'd0000000-0000-4000-a000-000000000001'::uuid/);
    expect(seed).toContain("'c0000000-0000-4000-a000-000000000016'::uuid, 'link'");
    // Public decks only: what trending, the counts and the notifications read.
    expect(seed).toContain("'casual', 'public'");
    expect(seed).not.toMatch(/'(private|unlisted)'/);
  });
});
