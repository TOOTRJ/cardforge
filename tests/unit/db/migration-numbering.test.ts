import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Supabase takes a migration's version from its file-name prefix. Two open
// PRs that each pick "the next number" merge without a git conflict (the
// names differ) and leave two files with ONE version — the second one then
// fails to apply on production. (0121 was claimed twice on 2026-09-28: the
// admin stepper's frame_preview_cards and the automatic re-bake, which moved
// to 0123.) This fails the moment both land in one tree.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");

describe("migration numbering", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

  it("names every migration NNNN_name.sql", () => {
    expect(files.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
  });

  it("never gives two migrations the same version", () => {
    const byVersion = new Map<string, string[]>();
    for (const f of files) byVersion.set(f.slice(0, 4), [...(byVersion.get(f.slice(0, 4)) ?? []), f]);
    const clashes = [...byVersion.values()].filter((names) => names.length > 1);
    expect(clashes).toEqual([]);
  });
});
