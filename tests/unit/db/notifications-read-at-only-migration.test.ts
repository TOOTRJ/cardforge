import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Migration 0173 (billing audit 2026-11-05, P1-1): a user may change ONE
// column of a notification — read_at. Before it, `authenticated` held a
// table-wide UPDATE (0097) under a column-blind policy (0032), so a user
// could rewrite one of their own rows into a dated `trial_lapsed` row and buy
// a plan at the win-back discount, or forge a `trial_ending` row's payload.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FILE = readdirSync(dir).find((f) => /^\d{4}_notifications_read_at_only\.sql$/.test(f));

function strip(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const flat = strip(FILE ? readFileSync(join(dir, FILE), "utf8") : "").replace(/\s+/g, " ").trim();

describe("0173 — notifications: a user writes read_at alone", () => {
  it("exists, numbered after 0172", () => {
    expect(FILE).toBeDefined();
    expect(Number(FILE!.slice(0, 4))).toBeGreaterThan(172);
  });

  it("takes the table-wide UPDATE (and the never-usable INSERT / TRUNCATE) back from authenticated, and anon's writes", () => {
    expect(flat).toContain("revoke insert, truncate, update on table public.notifications from authenticated;");
    expect(flat).toContain("revoke insert, update, delete, truncate on table public.notifications from anon;");
  });

  it("grants UPDATE on read_at only", () => {
    expect(flat).toContain("grant update (read_at) on table public.notifications to authenticated;");
    // Never the table again, never another column.
    expect(flat).not.toMatch(/grant [^;]*update on table public\.notifications/);
    expect(flat).not.toMatch(/grant update \([^)]*(type|payload|created_at|recipient_id|actor_id)[^)]*\)/);
  });

  it("leaves SELECT alone (the bell, the page and the realtime stream read the rows)", () => {
    expect(flat).not.toMatch(/revoke [^;]*select[^;]* on table public\.notifications/);
  });
});

describe("the app's own user-side writes fit the grant", () => {
  it("every app update of notifications sets read_at and nothing else", () => {
    // The user-side writer ("mark read" / "Clear all") and the admin inbox's
    // (service role, so the grant never applies — held to the same shape).
    // Anything else goes through a SECURITY DEFINER trigger.
    for (const file of ["lib/notifications/queries.ts", "lib/messages/actions.ts"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      // The update that follows a `.from("notifications")` chain.
      const updates = Array.from(
        src.matchAll(/\.from\("notifications"\)[\s\S]{0,200}?\.update\(\{[^}]*\}\)/g),
        (m) => m[0].slice(m[0].lastIndexOf(".update(")),
      );
      expect(updates.length).toBeGreaterThan(0);
      for (const call of updates) {
        expect(call.replace(/\s+/g, " ")).toMatch(/^\.update\(\{ ?read_at: [^,}]+ ?\}\)$/);
      }
    }
  });
});
