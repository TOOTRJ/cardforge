import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DECK_FEEDBACK_KINDS,
  FEEDBACK_AREA_KEYS,
  FEEDBACK_CATEGORY_KEYS,
  VIEWPORT_PATTERN,
} from "@/lib/feedback/schemas";

// ---------------------------------------------------------------------------
// TODO DK10.1 — migration *_feedback_area.sql (found by name, so a renumber
// at rebase doesn't break this): its CHECKs mirrored by the app's lists, the
// deck that must be one the sender can read, and nothing looser than 0051.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_feedback_area\.sql$/.test(f));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";
const body = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const sql0051 = readFileSync(join(dir, "0051_feedback_admin_notifications.sql"), "utf8");

const quoted = (list: string) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe("the feedback area migration", () => {
  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("every value of feedback_area_check is an app area, and back", () => {
    const check = body.match(/check \(area is null or area in \(([^)]*)\)\)/);
    expect(check, "feedback_area_check").not.toBeNull();
    expect(quoted(check![1]).sort()).toEqual([...FEEDBACK_AREA_KEYS].sort());
    expect(FEEDBACK_AREA_KEYS).toContain("decks");
  });

  it("the dialog's kinds file under categories 0051 allows", () => {
    const categories = quoted(sql0051.match(/check \(category in \(([^)]*)\)\)/)![1]);
    for (const kind of DECK_FEEDBACK_KINDS) {
      expect(FEEDBACK_CATEGORY_KEYS).toContain(kind.category);
      expect(categories).toContain(kind.category);
    }
  });

  it("the viewport CHECK is the app's pattern", () => {
    const check = body.match(/viewport ~ '([^']+)'/);
    expect(check?.[1]).toBe(VIEWPORT_PATTERN.source);
  });

  it("a deck rides a decks row only — never `area = 'decks'`, which a NULL area passes", () => {
    expect(body).toMatch(/check \(deck_id is null or area is not distinct from 'decks'\)/);
    expect(body).not.toMatch(/deck_id is null or area = 'decks'/);
    expect(body).toMatch(/references public\.decks \(id\) on delete set null/);
  });

  it("keeps 0051's insert rule and adds: a deck the sender can read", () => {
    const policy = body.slice(body.indexOf('create policy "Users insert own feedback"'));
    expect(policy).toMatch(/for insert/);
    expect(policy).toMatch(/auth\.uid\(\) = user_id/);
    expect(policy).toMatch(/exists \(select 1 from public\.decks d where d\.id = feedback\.deck_id\)/);
  });

  it("opens nothing: no select / update / delete policy, no grant, no table or function", () => {
    expect(body).not.toMatch(/create policy[^;]*for (select|update|delete)/i);
    expect(body).not.toMatch(/drop policy if exists "Users read own feedback"/);
    expect(body).not.toMatch(/^\s*grant\s/im);
    expect(body).not.toMatch(/create (table|(or replace )?function)/i);
  });
});
