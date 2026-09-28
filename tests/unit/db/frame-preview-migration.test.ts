import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0121 (TODO 2.3 / 2.4). Pins its shape, since the local stack
// isn't run from unit tests (CI's e2e job applies it for real):
//   * cards.frame_preview — additive, default false (no existing row
//     changes, nothing re-baked or badged);
//   * a CHECK that a flagged card is private (so no public surface can show
//     one) and a trigger that lets only an admin's API session raise the
//     flag (the service role and the migration owner pass);
//   * frame_review_events accepts 'score' and 'signoff' and keeps every
//     earlier action;
//   * idempotent, grants stated, nothing else in the schema touched.
// ---------------------------------------------------------------------------

const FILE = "supabase/migrations/0121_frame_preview_cards.sql";
const sql = readFileSync(join(process.cwd(), FILE), "utf8");
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

describe("0121 — frame previews and the template sign-off", () => {
  it("adds the flag idempotently, not null default false", () => {
    expect(body).toMatch(
      /alter table public\.cards add column if not exists frame_preview boolean not null default false;/i,
    );
  });

  it("keeps a flagged card private with a CHECK, added only once", () => {
    expect(body).toMatch(/check \(not frame_preview or visibility = 'private'\)/i);
    expect(body).toMatch(/if not exists \( select 1 from pg_constraint where conname = 'cards_frame_preview_private'/i);
  });

  it("lets only an admin's API session raise the flag", () => {
    expect(body).toMatch(/create or replace function public\.guard_card_frame_preview\(\) returns trigger/i);
    // SECURITY INVOKER (no definer) so current_user is the caller's role.
    const fn = body.match(/create or replace function public\.guard_card_frame_preview[\s\S]*?end; \$\$;/i)?.[0];
    expect(fn).toBeTruthy();
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/i);
    expect(body).toMatch(/current_user in \('anon', 'authenticated'\)/i);
    expect(body).toMatch(/not public\.viewer_is_admin\(\)/i);
    expect(body).toMatch(/tg_op = 'INSERT' or not old\.frame_preview/i);
    expect(body).toMatch(
      /drop trigger if exists cards_guard_frame_preview on public\.cards; create trigger cards_guard_frame_preview before insert or update of frame_preview on public\.cards for each row execute function public\.guard_card_frame_preview\(\);/i,
    );
  });

  it("accepts the sign-off's event actions and keeps every earlier one", () => {
    const check = body.match(/add constraint frame_review_events_action_check check \( action in \(([^)]*)\) \)/i)?.[1];
    expect(check).toBeTruthy();
    const actions = check!.split(",").map((a) => a.trim().replace(/'/g, ""));
    expect(actions.sort()).toEqual(
      ["verify", "withdraw", "pin", "unpin", "override_saved", "override_reset", "score", "signoff"].sort(),
    );
    expect(body).toMatch(/drop constraint if exists frame_review_events_action_check/i);
  });

  it("states its grants: the trigger function is callable by no API role, nothing blanket", () => {
    expect(body).toMatch(
      /revoke all on function public\.guard_card_frame_preview\(\) from public, anon, authenticated;/i,
    );
    expect(body).not.toMatch(/grant all on all/i);
    expect(body).not.toMatch(/\bgrant\b[^;]*\bto (anon|authenticated)\b/i);
  });

  it("rewrites no rows and drops nothing but the constraint it replaces", () => {
    expect(body).not.toMatch(/\bupdate public\./i);
    expect(body).not.toMatch(/\bdelete from\b/i);
    const drops = body.match(/\bdrop (table|column|function|policy|index)\b/gi) ?? [];
    expect(drops).toEqual([]);
  });
});
