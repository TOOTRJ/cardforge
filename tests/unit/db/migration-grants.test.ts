import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// CLAUDE.md: "Every migration states its grants." Production is an old
// Supabase project that auto-grants new public objects to the API roles;
// every NEW project (each preview branch, the dev branch, a local reset) does
// not — a forgotten grant is `permission denied` on a branch whose Supabase
// check is green. 0097 made the existing schema explicit; from 0098 on this
// test refuses a migration that creates a table or a non-trigger function
// without a grant/revoke statement in the same file. (Trigger functions are
// invoked by the trigger owner, never by an API role, so a trigger-only
// migration is exempt.)
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const FIRST_CHECKED = 98;

function analyse(sql: string) {
  const body = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const tables = (body.match(/create table(?: if not exists)?\s+/gi) ?? []).length;
  const functions = [...body.matchAll(/create (?:or replace )?function[\s\S]*?\$\$/gi)].map((m) => m[0]);
  const nonTrigger = functions.filter((f) => !/returns\s+trigger/i.test(f)).length;
  const grants = (body.match(/^\s*(grant|revoke)\s+/gim) ?? []).length;
  return { tables, functions: functions.length, nonTrigger, grants };
}

describe("migrations since 0097 state their grants", () => {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= FIRST_CHECKED)
    .sort();

  it("covers the migrations that exist", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(file, () => {
      const { tables, nonTrigger, grants } = analyse(readFileSync(join(dir, file), "utf8"));
      if (tables + nonTrigger === 0) return; // nothing an API role could touch
      expect(
        grants,
        `${file} creates ${tables} table(s) and ${nonTrigger} non-trigger function(s) but states no grant/revoke`,
      ).toBeGreaterThan(0);
    });
  }
});
