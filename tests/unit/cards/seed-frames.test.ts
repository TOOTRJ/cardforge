import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// supabase/seed.sql seeds the verified frame combos for preview branches and
// local resets. frame_reviews.template is free text in the DB, so a renamed or
// removed FrameTemplate would leave an orphan row that verifies nothing — and
// the creator on that branch would quietly lose the frame. Pin the names.

const COLOR_KEYS = new Set(["w", "u", "b", "r", "g", "c", "m"]);

function seededFrameBlock(): string {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const match = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/.exec(sql);
  if (!match) throw new Error("frame_reviews block markers missing from seed.sql");
  // Drop SQL comments so prose can't be mistaken for a literal.
  return match[1].replace(/--.*$/gm, "");
}

describe("supabase/seed.sql verified frames", () => {
  const literals = [...seededFrameBlock().matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const templates = [...new Set(literals.filter((l) => !COLOR_KEYS.has(l)))];

  it("seeds at least the standard M15 frame — the creator's default", () => {
    expect(templates).toContain("m15");
  });

  it("only names real frame templates", () => {
    const known = new Set<string>(FRAME_TEMPLATE_VALUES);
    expect(templates.filter((t) => !known.has(t))).toEqual([]);
  });

  it("only uses the color keys the frame_reviews CHECK allows", () => {
    // Every single-letter literal must be one of the seven keys.
    const stray = literals.filter((l) => l.length === 1 && !COLOR_KEYS.has(l));
    expect(stray).toEqual([]);
  });
});
