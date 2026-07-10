// Opt-in LIVE harness — runs the "Generate set" plan step (concept + card
// batch + lint/judge) against the real AI gateway. Costs a few cents and
// needs real keys, so it's skipped unless LIVE_AI_DEBUG=1:
//
//   set -a; source .env.local; set +a; LIVE_AI_DEBUG=1 npx vitest run tests/unit/ai/live-debug.test.ts
//
// This caught the clampedText bug (models can't count characters — hard
// zod .max() on prose intermittently failed whole generations).
import { describe, expect, it } from "vitest";
import { generateSet } from "@/lib/ai/set-gen";

const live = process.env.LIVE_AI_DEBUG === "1" ? describe : describe.skip;

live("live set generation", () => {
  it(
    "plans a 3-card set",
    async () => {
      try {
        const out = await generateSet({
          theme: "haunted lighthouse keepers",
          style: "watercolor",
          size: 3,
        });
        console.log("TITLE:", out.set_title);
        console.log("CARDS:", out.cards.map((c) => c.title));
        console.log("REPORT:", JSON.stringify(out.report));
        expect(out.cards).toHaveLength(3);
      } catch (error) {
        const e = error as Error & { text?: string; cause?: unknown };
        console.log("ERROR MESSAGE:", e.message);
        console.log("ERROR NAME:", e.name);
        if (e.text) console.log("RAW MODEL TEXT:", e.text.slice(0, 2000));
        if (e.cause) console.log("CAUSE:", JSON.stringify(e.cause).slice(0, 2000));
        throw error;
      }
    },
    300_000,
  );
});
