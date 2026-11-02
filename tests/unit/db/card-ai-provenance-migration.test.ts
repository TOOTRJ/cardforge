import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0161 (TODO CP1): AI provenance is the SERVER's. Read as text —
// the guard's behaviour was proved on Postgres 16 when it was written (the
// PR body has the scenarios); this holds the shape that makes it hold.
// ---------------------------------------------------------------------------

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0161_card_ai_provenance.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const fn = (name: string) => new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(code)?.[1] ?? "";

describe("0161 — the column", () => {
  it("adds ai_fields as a NOT NULL text[] defaulting to none, kept to the known parts", () => {
    expect(code).toMatch(/add column if not exists ai_fields text\[\] not null default '\{\}'/);
    expect(code).toMatch(/constraint cards_ai_fields_known\s+check \(\s*ai_fields <@ array\[/);
  });

  it("a provenance write is not an edit: set_cards_updated_at ignores ai_fields on both sides", () => {
    const body = fn("set_cards_updated_at");
    expect(body.match(/- 'ai_fields'/g)).toHaveLength(2);
    // …and still ignores everything 0156 did.
    expect(body.match(/- 'moderation_hidden_at' - 'moderation_hidden_reason'/g)).toHaveLength(2);
    expect(body.match(/- 'rendered_back_image_url'/g)).toHaveLength(2);
  });
});

describe("0161 — the guard (cards_track_ai_fields)", () => {
  const body = fn("track_card_ai_fields");

  it("fires before every insert and update, on every row", () => {
    expect(code).toMatch(/create trigger cards_track_ai_fields\s+before insert or update\s+on public\.cards\s+for each row execute function public\.track_card_ai_fields\(\)/);
  });

  it("is SECURITY INVOKER — current_user is the caller's role", () => {
    const head = /create or replace function public\.track_card_ai_fields\(\)[\s\S]*?as \$\$/.exec(code)?.[0] ?? "";
    expect(head).not.toMatch(/security definer/i);
    expect(body).toContain("current_user in ('anon', 'authenticated')");
  });

  it("refuses an API role's insert naming a part and its update changing the list", () => {
    expect(body).toMatch(/tg_op = 'INSERT'[\s\S]*?cardinality\(coalesce\(new\.ai_fields[\s\S]*?raise exception 'ai_fields_server_only/);
    expect(body).toMatch(/elsif new\.ai_fields is distinct from old\.ai_fields then\s+raise exception 'ai_fields_server_only/);
    expect(body.match(/errcode = 'insufficient_privilege'/g)).toHaveLength(2);
  });

  it("drops, on an API role's update, every text part whose columns changed", () => {
    expect(body).toMatch(/if v_api and tg_op = 'UPDATE'/);
    expect(body).toContain("public.card_ai_norm(v_new #> p.path) is distinct from public.card_ai_norm(v_old #> p.path)");
  });

  it("derives the art parts from the picture's address on every write", () => {
    expect(body).toContain("where part not in ('art', 'back.art')");
    expect(body).toContain("public.card_ai_art_url(new.art_url)");
    expect(body).toContain("public.card_ai_art_url(new.back_face ->> 'art_url')");
  });
});

describe("0161 — grants (revoke first)", () => {
  it("the receipts are the service role's alone, behind RLS with no policy", () => {
    expect(code).toMatch(/create table if not exists public\.card_ai_receipts/);
    expect(code).toMatch(/alter table public\.card_ai_receipts enable row level security;/);
    expect(code).not.toMatch(/create policy[\s\S]*?on public\.card_ai_receipts/);
    expect(code).toMatch(/revoke all on table public\.card_ai_receipts from public, anon, authenticated;\s+grant select, insert, delete on table public\.card_ai_receipts to service_role;/);
  });

  it("add_card_ai_fields is the service role's alone", () => {
    expect(code).toMatch(/revoke all on function public\.add_card_ai_fields\(uuid, uuid, text\[\]\) from public, anon, authenticated;\s+grant execute on function public\.add_card_ai_fields\(uuid, uuid, text\[\]\) to service_role;/);
    // It adds, and only on the owner's card.
    const body = fn("add_card_ai_fields");
    expect(body).toContain("ai_fields || coalesce(p_fields, '{}'::text[])");
    expect(body).toMatch(/where id = p_card_id\s+and owner_id = p_owner_id/);
  });

  it("the trigger's helpers stay callable by every role that writes a card (a trigger's calls run as the caller)", () => {
    for (const helper of ["card_ai_art_url(text)", "card_ai_field_paths()", "card_ai_norm(jsonb)"]) {
      const escaped = helper.replace(/[()[\]]/g, "\\$&");
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${escaped} from public;`));
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${escaped} to anon, authenticated, service_role;`));
    }
    expect(code).toMatch(/revoke all on function public\.track_card_ai_fields\(\) from public, anon, authenticated;/);
  });
});

describe("0161 — the backfill proves what it marks", () => {
  it("the art: a no-op write of the rows whose picture is in the AI art store", () => {
    expect(code).toMatch(/update public\.cards\s+set ai_fields = ai_fields\s+where public\.card_ai_art_url\(art_url\)\s+or public\.card_ai_art_url\(back_face ->> 'art_url'\);/);
  });

  it("the text: a done AI-job step naming the owner's card, and a server-written trace of it", () => {
    expect(code).toMatch(/j\.kind in \('card', 'deck', 'deck_remix'\)/);
    expect(code).toContain("s.step ->> 'status' = 'done'");
    expect(code).toContain("c.id = js.card_id and c.owner_id = js.owner_id");
    // A job row is owner-insertable (0059): the spend that completed the
    // step, or the AI art store's picture, is what proves it.
    expect(code).toMatch(/l\.idempotency_key = js\.step ->> 'spend_ref'/);
    expect(code).toMatch(/where public\.card_ai_art_url\(c\.art_url\)\s+or exists \(/);
  });

  it("only adds parts, and leaves no helper of its own behind", () => {
    expect(code).toMatch(/set ai_fields = array\(\s+select distinct part from unnest\(c\.ai_fields \|\| pc\.found\)/);
    expect(code).toContain("drop function public.card_ai_backfill_fold(text);");
  });
});
