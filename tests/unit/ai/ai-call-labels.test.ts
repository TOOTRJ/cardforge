import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Every AiActionLabel the app can log must be accepted by the card_ai_calls
// CHECK, or logAiCall() silently drops it (it swallows insert errors) and the
// action escapes both the rate limiter and /dashboard/usage — how 'fill_card'
// went uncounted from 0089 until 0107.
// ---------------------------------------------------------------------------

const root = process.cwd();

function appLabels(): string[] {
  const source = readFileSync(join(root, "lib/ai/rate-limit.ts"), "utf8");
  const union = /export type AiActionLabel =([\s\S]*?);/.exec(source);
  expect(union, "AiActionLabel union found").not.toBeNull();
  return [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

function latestCheckLabels(): { file: string; labels: string[] } {
  const dir = join(root, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const file of [...files].reverse()) {
    const sql = readFileSync(join(dir, file), "utf8");
    const block = /add constraint card_ai_calls_action_check check \(([\s\S]*?)\)\s*\);/.exec(sql);
    if (block) {
      return { file, labels: [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) };
    }
  }
  throw new Error("no migration defines card_ai_calls_action_check");
}

describe("card_ai_calls action CHECK", () => {
  it("accepts every label the app logs", () => {
    const labels = appLabels();
    const check = latestCheckLabels();
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) {
      expect(check.labels, `${label} is missing from ${check.file}`).toContain(label);
    }
  });
});
