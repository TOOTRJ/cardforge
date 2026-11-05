import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WINNER_PLACES } from "@/lib/challenges/winners-shared";

// ---------------------------------------------------------------------------
// Migration 0172 (TODO NV12): a closed challenge names its 1st / 2nd / 3rd.
// The rules live in SQL; this holds the file to them (the functions were
// also run against the local stack's Postgres in a rolled-back transaction
// while building — see the PR). Comments are stripped before any check.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_challenge_winners\.sql$/.test(f));

function strip(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const SQL = strip(FILE ? readFileSync(join(dir, FILE), "utf8") : "");
const flat = SQL.replace(/\s+/g, " ");

function functionBody(name: string): string {
  const match = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(SQL);
  return (match?.[1] ?? "").replace(/\s+/g, " ");
}

describe("0172 — the table", () => {
  it("exists, numbered after 0171", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(171);
  });

  it("holds the places the app knows: 1–3, one card per place and one place per card", () => {
    expect(WINNER_PLACES).toEqual([1, 2, 3]);
    expect(flat).toContain("place smallint not null check (place between 1 and 3)");
    expect(flat).toContain("primary key (challenge_id, place) deferrable initially immediate");
    expect(flat).toContain("unique (challenge_id, card_id) deferrable initially immediate");
  });

  it("goes with its challenge and its card", () => {
    expect(flat).toContain("references public.challenges (id) on delete cascade");
    expect(flat).toContain("references public.cards (id) on delete cascade");
  });

  it("states its grants (0097) and lets only an admin write", () => {
    expect(flat).toContain("revoke all on table public.challenge_winners from public, anon, authenticated;");
    expect(flat).toContain(
      "grant select (challenge_id, place, card_id, named_at) on table public.challenge_winners to anon, authenticated;",
    );
    // named_by would tell the anon key who the admins are (0074).
    expect(flat).not.toMatch(/grant select on table public\.challenge_winners to anon/);
    expect(flat).not.toMatch(/grant select \([^)]*named_by[^)]*\) on table public\.challenge_winners to (anon|authenticated)/);
    expect(flat).toContain("grant insert, update, delete on table public.challenge_winners to authenticated;");
    for (const op of ["insert", "update", "delete"]) {
      const policy = new RegExp(`create policy "[^"]+" on public\\.challenge_winners for ${op} [^;]*viewer_is_admin\\(\\)`);
      expect(flat).toMatch(policy);
    }
    expect(flat).not.toMatch(/profiles\.is_admin/);
  });

  it("is read by a visitor only while its card is public", () => {
    expect(flat).toContain(
      "for select using ( public.viewer_is_admin() or exists ( select 1 from public.cards c where c.id = challenge_winners.card_id and c.visibility = 'public' ) );",
    );
  });
});

describe("0172 — the guard", () => {
  const body = functionBody("challenge_winners_guard");
  it("refuses a challenge that hasn't closed", () => {
    expect(body).toContain("if v_challenge.ends_at > now() then raise exception 'challenge_not_closed'");
  });
  it("takes only an entry: a public card wearing the challenge's tag (NULL tags included)", () => {
    expect(body).toContain("v_card.visibility <> 'public'");
    expect(body).toContain("not coalesce(v_challenge.tag = any (v_card.tags), false)");
  });
  it("lets an update move a row's place only, keeping who named it and when", () => {
    expect(body).toContain(
      "if tg_op = 'UPDATE' then if new.card_id is distinct from old.card_id or new.challenge_id is distinct from old.challenge_id then raise exception 'winner_row_fixed'",
    );
    expect(body).toContain("new.named_at := old.named_at; new.named_by := old.named_by; return new;");
    // The entry check is a NAMING check: it comes after the update's return.
    expect(body.indexOf("return new;")).toBeLessThan(body.indexOf("v_card.visibility <> 'public'"));
  });
  it("runs before every insert and update", () => {
    expect(flat).toContain(
      "create trigger challenge_winners_guard before insert or update on public.challenge_winners for each row execute function public.challenge_winners_guard();",
    );
  });
});

describe("0172 — the notification", () => {
  const body = functionBody("challenge_winners_notify");
  it("is ONE row per challenge and card, never failing the write", () => {
    expect(flat).toContain(
      "create unique index if not exists notifications_challenge_winner_once_idx on public.notifications (card_id, (payload ->> 'challengeId')) where type = 'challenge_winner';",
    );
    expect(body).toContain("on conflict (card_id, (payload ->> 'challengeId')) where type = 'challenge_winner' do update set payload = excluded.payload;");
    expect(body).toContain("exception when others then raise warning");
  });
  it("names no actor, and goes when the card is un-named", () => {
    expect(body).toContain("v_owner, null, 'challenge_winner', new.card_id");
    expect(body).toContain("if tg_op = 'DELETE' then delete from public.notifications");
  });
  it("only rewrites the place when only the place moved (no second toast)", () => {
    expect(body).toContain("set payload = payload || jsonb_build_object('place', new.place)");
  });
  it("is 0164's kinds plus challenge_winner — nothing dropped", () => {
    const kinds = (sql: string) => {
      const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
      return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    const before = kinds(strip(readFileSync(join(dir, "0164_deck_clone_and_similar.sql"), "utf8")));
    expect(before.length).toBeGreaterThan(20);
    expect(kinds(SQL)).toEqual([...before, "challenge_winner"]);
  });
  it("no migration between 0164 and this one redefined the kinds", () => {
    const self = Number(FILE!.slice(0, 4));
    for (const f of readdirSync(dir).filter((name) => /^\d{4}_/.test(name))) {
      const n = Number(f.slice(0, 4));
      if (n > 164 && n < self) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain("notifications_type_check");
    }
  });
  it("has its copy and its icon", () => {
    expect(readFileSync(join(process.cwd(), "lib/notifications/describe.ts"), "utf8")).toContain('case "challenge_winner":');
    expect(readFileSync(join(process.cwd(), "components/notifications/notification-row.tsx"), "utf8")).toContain(
      "challenge_winner: Trophy,",
    );
  });
});

describe("0172 — set_challenge_winners", () => {
  const body = functionBody("set_challenge_winners");
  it("is the admin's alone, run with the caller's rights", () => {
    expect(flat).toMatch(/function public\.set_challenge_winners\([^)]*\) returns void language plpgsql security invoker/);
    expect(body).toContain("if not public.viewer_is_admin() then raise exception 'admin_required'");
    expect(flat).toContain("revoke all on function public.set_challenge_winners(uuid, uuid, uuid, uuid) from public, anon;");
    expect(flat).toContain("grant execute on function public.set_challenge_winners(uuid, uuid, uuid, uuid) to authenticated, service_role;");
  });
  it("refuses one card in two places", () => {
    expect(body).toContain("raise exception 'duplicate_winner'");
  });
  it("keeps a winner's row when only its place moves, so its maker isn't told twice", () => {
    expect(body).toContain("set constraints public.challenge_winners_pkey, public.challenge_winners_card_once deferred;");
    expect(body).toContain("update public.challenge_winners w set place = v_place");
    expect(body).toContain("set constraints public.challenge_winners_pkey, public.challenge_winners_card_once immediate;");
  });
  it("revokes the trigger functions from the API roles", () => {
    expect(flat).toContain("revoke all on function public.challenge_winners_guard() from public, anon, authenticated;");
    expect(flat).toContain("revoke all on function public.challenge_winners_notify() from public, anon, authenticated;");
  });
});
