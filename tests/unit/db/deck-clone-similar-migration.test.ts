import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIMILAR_DECKS_MIN_SHARED,
  SIMILAR_DECKS_STAPLE_MIN_DECKS,
  SIMILAR_DECKS_STAPLE_SHARE,
} from "@/lib/decks/similar-decks";
import { SCRYFALL_LIMITS } from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// Migration 0164 (TODO DK5.16): clone a deck with "remixed from" credit, and
// similar decks. The rules live in SQL; this holds the file to them (the
// functions were also run against a scratch Postgres 16 while building —
// see the PR). Comments are stripped before any check.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_deck_clone_and_similar\.sql$/.test(f));

function strip(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const RAW = FILE ? readFileSync(join(dir, FILE), "utf8") : "";
const SQL = strip(RAW);
const flat = SQL.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const match = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(SQL);
  return (match?.[1] ?? "").replace(/\s+/g, " ");
}

describe("0164 — the file", () => {
  it("exists, numbered after 0163 (#722's, on main)", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(163);
  });
});

describe("lineage: a table of its own, no API role's", () => {
  it("is a separate table (a deck's id is its link: never a column on decks.*)", () => {
    expect(flat).toContain("create table if not exists public.deck_remix_sources");
    expect(SQL).not.toMatch(/alter table public\.decks\b/i);
  });
  it("has RLS on and its grants revoked from public, anon and authenticated first", () => {
    expect(flat).toContain("alter table public.deck_remix_sources enable row level security;");
    const revoke = flat.indexOf("revoke all on table public.deck_remix_sources from public, anon, authenticated;");
    const grant = flat.indexOf("grant select, insert, update, delete on table public.deck_remix_sources to service_role;");
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
    expect(flat).not.toMatch(/grant [a-z, ]+ on table public\.deck_remix_sources to (anon|authenticated)/);
    expect(flat).not.toMatch(/create policy/i);
  });
});

describe("clone_deck — the deck rules", () => {
  const body = functionBody("clone_deck");

  it("is signed-in only and reads a deck the caller may open: public, unlisted (its id), or their own", () => {
    expect(body).toContain("v_caller uuid := auth.uid();");
    expect(body).toContain("if v_caller is null then");
    expect(body).toContain("d.visibility in ('public', 'unlisted') or d.owner_id = v_caller");
    expect(flat).toContain("revoke all on function public.clone_deck(uuid, text, text, uuid[]) from public, anon;");
    expect(flat).toContain("grant execute on function public.clone_deck(uuid, text, text, uuid[]) to authenticated, service_role;");
    // The draft's three-argument function never survives beside it.
    expect(flat).toContain("drop function if exists public.clone_deck(uuid, text, text);");
  });

  it("links a card only where the copy may: the caller's own or a public card", () => {
    expect(body).toContain("(c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller)) as keep_card");
    expect(body).toContain("case when s.keep_card then s.card_id end");
  });

  it("skips an entry with no printing whose card can't come along, or whose card is gone (its source says it brought one)", () => {
    // The same rule counts and copies.
    const rule =
      "s.scryfall_id is not null or s.keep_card or (s.card_id is null and coalesce(s.source not in ('creator', 'link', 'ai_generate', 'ai_remix'), true))";
    expect(body).toContain(rule);
    expect(body).toContain(
      "e.scryfall_id is not null or (c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller)) or (e.card_id is null and coalesce(e.source not in ('creator', 'link', 'ai_generate', 'ai_remix'), true))",
    );
  });

  it("copies a kept printing the app masks for the caller as the page shows it — only where its card can't come along", () => {
    expect(body).toContain("v_masked uuid[] := coalesce(p_masked_entry_ids, '{}'::uuid[]);");
    expect(body).toContain(
      "(e.card_id is not null and not (c.id is not null and (c.visibility = 'public' or c.owner_id = v_caller)) and e.id = any(v_masked)) as masked",
    );
    expect(body).toContain("case when s.masked then 'Private card' else s.name end");
    expect(body).toContain("case when s.masked then null else s.type_line end");
  });

  it("holds the 500-entry cap before writing anything", () => {
    expect(body).toContain("if v_to_copy > 500 then raise exception 'deck_entry_limit");
    expect(body.indexOf("deck_entry_limit")).toBeLessThan(body.indexOf("insert into public.decks"));
  });

  it("makes a PRIVATE deck with the source's format, type and bracket — never its description or cover — and no card", () => {
    expect(body).toContain("insert into public.decks (owner_id, title, slug, format, visibility, deck_type, bracket)");
    expect(body).toContain("v_source.format, 'private'");
    expect(body).not.toMatch(/description|cover_url/);
    expect(body).not.toMatch(/insert into public\.cards/);
  });

  it("suffixes a taken slug as createDeckAction does, at most 50 tries", () => {
    expect(body).toContain("exception when unique_violation then");
    expect(body).toContain("if v_attempt > 50 then");
  });

  it("writes the lineage and notifies the source's owner once per cloner and deck, never themselves, never failing the clone", () => {
    expect(body).toContain("insert into public.deck_remix_sources (deck_id, source_deck_id, source_owner_id)");
    expect(body).toContain("if v_source.owner_id <> v_caller then");
    // A duplicate of the caller's own deck is credited to nobody: the
    // lineage row sits inside the other-owner branch.
    const branch = body.indexOf("if v_source.owner_id <> v_caller then");
    expect(body.indexOf("insert into public.deck_remix_sources")).toBeGreaterThan(branch);
    expect(body.match(/insert into public\.deck_remix_sources/g)).toHaveLength(1);
    expect(body).toContain("on conflict (actor_id, (payload ->> 'deckId')) where type = 'deck_cloned' do nothing;");
    expect(body).toContain("exception when others then raise warning");
    expect(flat).toContain(
      "create unique index if not exists notifications_deck_cloned_once_idx on public.notifications (actor_id, (payload ->> 'deckId')) where type = 'deck_cloned';",
    );
  });
});

describe("the notification CHECK", () => {
  const kinds = (sql: string) => {
    const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
    return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  it("is 0161's kinds (the last to redefine it) plus deck_cloned — nothing dropped", () => {
    const before = kinds(strip(readFileSync(join(dir, "0161_comp_ending_notifications.sql"), "utf8")));
    expect(before.length).toBeGreaterThan(20);
    expect(kinds(SQL)).toEqual([...before, "deck_cloned"]);
  });
  it("no migration between 0161 and this one redefined it", () => {
    for (const f of readdirSync(dir).filter((name) => /^\d{4}_/.test(name))) {
      const n = Number(f.slice(0, 4));
      if (n > 161 && f !== FILE) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("notifications_type_check");
    }
  });
  it("has its copy in lib/notifications/describe.ts", () => {
    expect(readFileSync(join(process.cwd(), "lib/notifications/describe.ts"), "utf8")).toContain('case "deck_cloned":');
  });
});

describe("deck_remix_credit — never an unlisted or private source's name", () => {
  const body = functionBody("deck_remix_credit");
  it("names the source only while it is public or the caller's own", () => {
    expect(body).toContain("coalesce(s.visibility = 'public' or s.owner_id = auth.uid(), false) as shown");
    expect(body).toContain("case when shown then s.slug end");
    expect(body).toContain("case when shown then s.title end");
    expect(body).toContain("case when shown then p.username end");
  });
  it("answers only for a clone the caller may open", () => {
    expect(body).toContain("d.visibility in ('public', 'unlisted') or d.owner_id = auth.uid()");
    expect(flat).toContain("revoke all on function public.deck_remix_credit(uuid) from public;");
    expect(flat).toContain("grant execute on function public.deck_remix_credit(uuid) to anon, authenticated, service_role;");
  });
});

describe("list_similar_decks — public decks only, by what every visitor reads", () => {
  const body = functionBody("list_similar_decks");
  it("reads nothing of a deck that isn't public and non-empty", () => {
    expect(body).toContain("where d.id = p_deck_id and d.visibility = 'public' and d.card_count > 0");
  });
  it("lists only other public, non-empty decks of real creators", () => {
    expect(body).toContain("join public.decks d on d.id = h.deck_id where d.visibility = 'public' and d.card_count > 0");
    expect(body).toContain("where h.deck_id <> p_deck_id");
    expect(body).toContain("and public.owner_is_creator(d.owner_id)");
    expect(body).toContain("from shortlist m join public.decks d on d.id = m.deck_id");
  });
  it("applies the commander / shared filter BEFORE any colour is read", () => {
    expect(body).toContain(`where (m.same_commander or m.shared >= ${SIMILAR_DECKS_MIN_SHARED})`);
    expect(body).toContain("where e.deck_id in (select deck_id from shortlist union all select id from source)");
    expect(body.indexOf("shortlist as (")).toBeLessThan(body.indexOf("colours as ("));
  });
  it("never counts a staple — more than SIMILAR_DECKS_STAPLE_SHARE and SIMILAR_DECKS_STAPLE_MIN_DECKS of the public decks", () => {
    expect(SIMILAR_DECKS_STAPLE_SHARE).toBe(0.1);
    expect(body).toContain(
      `having count(distinct ph.deck_id) > greatest(${SIMILAR_DECKS_STAPLE_MIN_DECKS}, t.n * ${SIMILAR_DECKS_STAPLE_SHARE.toFixed(2)})`,
    );
    expect(body).toContain("select count(*) as n from public.decks where visibility = 'public' and card_count > 0");
    expect(body).toContain("count(distinct h.card) filter (where h.card not in (select card from staples)) as shared");
    // A shared commander still counts, staple or not.
    expect(body).toContain("bool_or(h.same_commander) as same_commander");
  });
  it("an entry with no letters (a card added from the creator) takes its PUBLIC card's colours", () => {
    expect(body).toContain("when cardinality(coalesce(e.color_identity, '{}'::text[])) > 0 then e.color_identity");
    expect(body).toContain("when c.id is not null and c.visibility = 'public' then array(");
    expect(body).toContain("when 'white' then 'W' when 'blue' then 'U' when 'black' then 'B' when 'red' then 'R' when 'green' then 'G'");
  });
  it("matches a printing by its real card's name and a PipGlyph card only while public — never a hidden entry", () => {
    expect(body).toContain("(e.scryfall_id is not null or (c.id is not null and c.visibility = 'public'))");
    expect(body).toContain("and e.scryfall_id is not null and lower(btrim(e.name)) = k.name_key");
  });
  it("leaves out basic lands, the sideboard and the maybeboard", () => {
    expect(body).toContain("coalesce(e.type_line, '') not ilike 'basic %'");
    expect(body.match(/e\.board in \('main', 'commander'\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
  it("is the same commander, or the same colours and SIMILAR_DECKS_MIN_SHARED cards", () => {
    expect(body).toContain(
      `where m.same_commander or (m.shared >= ${SIMILAR_DECKS_MIN_SHARED} and coalesce(cc.letters, '{}') = coalesce(sc.letters, '{}'))`,
    );
    expect(body).toContain("order by m.same_commander desc, m.shared desc, d.likes_count desc, d.updated_at desc, d.id");
  });
  it("is cheap: an index for the name match, a bounded limit, revoke-first grants", () => {
    expect(flat).toContain("create index if not exists deck_cards_printing_name_idx on public.deck_cards (lower(btrim(name))) where scryfall_id is not null;");
    expect(body).toContain("limit least(greatest(coalesce(p_limit, 4), 1), 12)");
    expect(flat).toContain("revoke all on function public.list_similar_decks(uuid, integer) from public;");
    expect(flat).toContain("grant execute on function public.list_similar_decks(uuid, integer) to anon, authenticated, service_role;");
  });
});

describe("every function is SECURITY DEFINER with an empty search_path", () => {
  for (const name of ["clone_deck", "deck_remix_credit", "list_similar_decks"]) {
    it(name, () => {
      const head = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$\\$`).exec(SQL)?.[0] ?? "";
      expect(head).toMatch(/security definer/);
      expect(head).toMatch(/set search_path = ''/);
    });
  }
});

describe("scryfall_calls: the deck page's tokens lookup is logged", () => {
  const actions = (sql: string) => {
    const all = [...sql.matchAll(/add constraint scryfall_calls_action_check\s+check \(action in \(([^)]*)\)\)/g)];
    return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  it("is 0143's list (the last to redefine it) plus deck_tokens — nothing dropped", () => {
    const before = actions(strip(readFileSync(join(dir, "0143_deck_counts_and_counter_guards.sql"), "utf8")));
    expect(before).toContain("deck_import_commit");
    expect(actions(SQL)).toEqual([...before, "deck_tokens"]);
  });
  it("no migration between 0143 and this one redefined it", () => {
    for (const f of readdirSync(dir).filter((name) => /^\d{4}_/.test(name))) {
      const n = Number(f.slice(0, 4));
      if (n > 143 && f !== FILE) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("scryfall_calls_action_check");
    }
  });
  it("names exactly the app's actions (lib/scryfall/rate-limit.ts)", () => {
    expect(actions(SQL).sort()).toEqual(Object.keys(SCRYFALL_LIMITS).sort());
  });
});
