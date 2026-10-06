import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// The verified frame combos a spec depends on (frame_reviews), on the LOCAL
// stack only — never a remote database.
//
// supabase/seed.sql mirrors production's ticks and only grows: a combo a
// spec was written against as "not verified yet" gets verified there one
// day (the double-faced bodies did on 2026-10-06). So a spec that needs a
// combo UNpublished withdraws it for its own run and puts it back, instead
// of leaning on the seed. The suite runs one worker, in file order
// (playwright.config.ts), so a withdrawal never overlaps another spec.
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";

/** The suite is pointed at the local Supabase stack with its service key
 *  (.env.e2e). Specs that set the verified frames skip without it. */
export const hasLocalStack =
  Boolean(supabaseUrl && serviceKey) && /127\.0\.0\.1|localhost/.test(supabaseUrl);

export type FrameCombo = { template: string; color_key: string };

const COLOUR_KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;

/** Every colour key of the templates named. */
export function everyColourOf(...templates: string[]): FrameCombo[] {
  return templates.flatMap((template) => COLOUR_KEYS.map((color_key) => ({ template, color_key })));
}

/** The nine double-faced bodies (TODO 5.1a / 5.1b), in every colour. */
export const DOUBLE_FACED_BODIES: readonly FrameCombo[] = everyColourOf(
  "m15dfcfront",
  "m15dfcback",
  "m15dfcbackleft",
  "m15dfclandfront",
  "m15dfclandback",
  "m15mdfcfront",
  "m15mdfcback",
  "m15mdfclandfront",
  "m15mdfclandback",
);

/** Runs `run` with the combos withdrawn (verified → false), then restores
 *  exactly the rows it withdrew. Local stack only: the caller skips without
 *  it, and this refuses to run against anything else. */
export async function withFramesUnverified(
  combos: ReadonlyArray<FrameCombo>,
  run: () => Promise<void>,
): Promise<void> {
  if (!hasLocalStack) throw new Error("withFramesUnverified writes to the LOCAL stack only");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const withdrawn: FrameCombo[] = [];
  try {
    // Inside the try: a withdrawal that fails part-way still restores the
    // combos already withdrawn.
    for (const combo of combos) {
      const { data, error } = await admin
        .from("frame_reviews")
        .update({ verified: false })
        .eq("template", combo.template)
        .eq("color_key", combo.color_key)
        .eq("verified", true)
        .select("template, color_key");
      if (error) throw new Error(`frame_reviews: ${error.message}`);
      withdrawn.push(...(data ?? []));
    }
    await run();
  } finally {
    // A failed restore would leave the combo withdrawn for every later
    // spec: say so rather than let it pass silently.
    const failed: string[] = [];
    for (const combo of withdrawn) {
      const { error } = await admin
        .from("frame_reviews")
        .update({ verified: true })
        .eq("template", combo.template)
        .eq("color_key", combo.color_key);
      if (error) failed.push(`${combo.template}/${combo.color_key}: ${error.message}`);
    }
    if (failed.length > 0) {
      throw new Error(`frame_reviews: couldn't restore ${failed.join("; ")}`);
    }
  }
}
