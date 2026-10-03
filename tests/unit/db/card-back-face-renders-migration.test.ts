import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLEARED_RENDER_POINTERS, renderObjectNames } from "@/lib/cards/bake-core";

// ---------------------------------------------------------------------------
// TODO 5.0a — migration *_card_back_face_renders.sql (found by name, so a
// renumber at rebase doesn't break this): the back face's two render
// pointers. What it must hold to:
//   • the two columns, nullable text, commented, added idempotently;
//   • 0126's cards_guard_render_columns re-created with BOTH columns in the
//     trigger's `update of` list AND in the function body (an update of a
//     column not listed never fires the trigger — a column in the body alone
//     is not guarded) — insert: none may be set; update: only to NULL;
//   • 0108's set_cards_updated_at re-created subtracting both (a back bake
//     is not an edit);
//   • the guarded list and the subtraction name every pointer column the
//     code clears (CLEARED_RENDER_POINTERS) plus layout_version, and the
//     comments name the object names the code writes (renderObjectNames);
//   • 0126's revoke restated; no other grant / revoke; no data statement.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const file = readdirSync(dir).find((f) => /^\d{4}_card_back_face_renders\.sql$/.test(f));
const raw = file ? readFileSync(join(dir, file), "utf8") : "";
const body = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const guardFn = /create or replace function public\.guard_card_render_columns\(\)([\s\S]*?)\$\$;/i.exec(body)?.[0] ?? "";
const updatedAtFn = /create or replace function public\.set_cards_updated_at\(\)([\s\S]*?)\$\$;/i.exec(body)?.[0] ?? "";
const statements = body
  .replace(guardFn, "")
  .replace(updatedAtFn, "")
  .split(";")
  .map(flat)
  .filter(Boolean);

/** Every pointer column the code clears, plus the renderer stamp the bake
 *  paths clear: exactly what 0126 (+ this migration) guards. */
const POINTER_COLUMNS = [...Object.keys(CLEARED_RENDER_POINTERS), "layout_version"];
const BACK_COLUMNS = ["rendered_back_image_url", "rendered_back_thumb_url"];

describe("the back-face renders migration", () => {
  it("has its migration, numbered after 0133", () => {
    expect(file).toBeDefined();
    expect(Number(file!.slice(0, 4))).toBeGreaterThan(133);
  });

  it("adds the two nullable columns idempotently and comments them with the object names the code writes", () => {
    for (const column of BACK_COLUMNS) {
      expect(body).toMatch(new RegExp(`add column if not exists ${column} text`));
      expect(body).toMatch(new RegExp(`comment on column public\\.cards\\.${column} is`));
    }
    const names = renderObjectNames("{id}");
    expect(raw).toContain(`{owner}/${names.backPng}`);
    expect(raw).toContain(`{owner}/${names.backThumb}`);
    const alter = statements.find((s) => s.startsWith("alter table public.cards"));
    expect(alter).toBe(
      `alter table public.cards add column if not exists ${BACK_COLUMNS[0]} text, add column if not exists ${BACK_COLUMNS[1]} text`,
    );
  });

  it("the code clears exactly the six columns the trigger guards: the front pair, the back pair, rendered_at, layout_version", () => {
    expect(Object.keys(CLEARED_RENDER_POINTERS)).toEqual([
      "rendered_image_url",
      "rendered_thumb_url",
      "rendered_back_image_url",
      "rendered_back_thumb_url",
      "rendered_at",
    ]);
    expect(Object.values(CLEARED_RENDER_POINTERS).every((v) => v === null)).toBe(true);
  });

  it("re-creates the trigger with every pointer column in its `update of` list", () => {
    expect(statements).toContain("drop trigger if exists cards_guard_render_columns on public.cards");
    const trigger = statements.find((s) => s.startsWith("create trigger cards_guard_render_columns"));
    expect(trigger).toBeDefined();
    const listed = /before insert or update of (.*?) on public\.cards/.exec(trigger!)?.[1].split(",").map((c) => c.trim());
    expect(listed).toEqual(POINTER_COLUMNS);
    expect(trigger).toMatch(/for each row execute function public\.guard_card_render_columns\(\)$/);
  });

  it("the guard's body names every pointer column: none on INSERT, only to NULL on UPDATE; a refusal is 42501", () => {
    const fn = flat(guardFn);
    expect(fn).toMatch(/returns trigger language plpgsql set search_path = ''/);
    expect(fn).not.toMatch(/security definer/i);
    expect(fn).toMatch(/if current_user not in \('anon', 'authenticated'\) then return new; end if;/);
    const insertBranch = /if tg_op = 'INSERT' then(.*?)elsif/.exec(fn)?.[1] ?? "";
    const updateBranch = /elsif(.*?)then raise/.exec(fn)?.[1] ?? "";
    for (const col of POINTER_COLUMNS) {
      expect(insertBranch, col).toContain(`new.${col} is not null`);
      expect(updateBranch, col).toContain(`(new.${col} is not null and new.${col} is distinct from old.${col})`);
    }
    // No column beyond the six: every `new.<col>` the body names is a pointer column.
    const named = new Set([...fn.matchAll(/new\.([a-z_]+)/g)].map((m) => m[1]));
    expect([...named].sort()).toEqual([...POINTER_COLUMNS].sort());
    expect(fn.match(/using errcode = 'insufficient_privilege'/g)).toHaveLength(2);
  });

  it("re-creates the updated_at guard subtracting every pointer column (and only the 0100 / 0108 keys beside them), on both sides", () => {
    const fn = flat(updatedAtFn);
    expect(fn).toMatch(/returns trigger language plpgsql set search_path = ''/);
    const sides = [...fn.matchAll(/to_jsonb\((new|old)\)((?:\s*- '[a-z_]+')+)/g)];
    expect(sides.map((m) => m[1])).toEqual(["new", "old"]);
    for (const [, , subtracted] of sides) {
      const keys = [...subtracted.matchAll(/- '([a-z_]+)'/g)].map((m) => m[1]);
      expect(keys).toEqual([
        "view_count",
        "likes_count",
        "share_count",
        "updated_at",
        "color_count",
        ...POINTER_COLUMNS,
      ]);
    }
    expect(fn).toContain("is distinct from");
    expect(fn).toContain("new.updated_at = now();");
    expect(fn).toContain("new.updated_at = old.updated_at;");
  });

  it("the 0108 guard it replaces subtracted exactly the four front columns — this one adds the back pair after them", () => {
    const m0108 = readFileSync(join(dir, "0108_hub_counts_and_render_updated_at.sql"), "utf8");
    const line = m0108.split("\n").find((l) => l.includes("- 'rendered_image_url'")) ?? "";
    expect([...line.matchAll(/- '([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      "rendered_image_url",
      "rendered_thumb_url",
      "rendered_at",
      "layout_version",
    ]);
    const mine = flat(updatedAtFn);
    expect(mine.indexOf("'rendered_back_image_url'")).toBeGreaterThan(mine.indexOf("'rendered_thumb_url'"));
    expect(mine.indexOf("'rendered_back_thumb_url'")).toBeLessThan(mine.indexOf("'rendered_at'"));
  });

  it("restates 0126's revoke and nothing else; no data, no policy, no new grant", () => {
    const privileges = statements.filter((s) => /^(grant|revoke)\b/i.test(s));
    expect(privileges).toEqual(["revoke all on function public.guard_card_render_columns() from public, anon, authenticated"]);
    // Outside the two function bodies: only the alter, the comments, the
    // trigger drop / create and the revoke.
    expect(statements.map((s) => s.split(" ").slice(0, 2).join(" ")).sort()).toEqual(
      ["alter table", "comment on", "comment on", "create trigger", "drop trigger", "revoke all"].sort(),
    );
    expect(raw).toMatch(/^-- Grants: none new\./m);
    expect(raw).toMatch(/Ships through a PR; never applied ad-hoc/);
  });
});
