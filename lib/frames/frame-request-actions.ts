"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { frameRequestSchema } from "@/lib/frames/frame-requests";

// ---------------------------------------------------------------------------
// Write one frame_requests row (TODO 1.6, migration 0123) — the creator calls
// this, fire-and-forget, after an import whose printing PipGlyph can't
// reproduce exactly. The row goes through record_frame_request() with the
// USER's own session (it stamps auth.uid() and caps a user at 30 rows an
// hour); never the admin client.
//
// Never throws, and returns a small result only for tests: a failed log must
// never disturb an import (on a database without migration 0123 — the shared
// dev DB until merge — the RPC simply doesn't exist).
//
// Only async functions are exported ("use server"); the input type and its
// schema live in lib/frames/frame-requests.ts.
// ---------------------------------------------------------------------------

export async function recordFrameRequestAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const parsed = frameRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid" };

    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "signed-out" };

    const row = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("record_frame_request", {
      p_signature: row.signature,
      p_label: row.label,
      p_set: row.setCode,
      p_collector: row.collectorNumber,
      p_scryfall_id: row.scryfallId,
      p_status: row.status,
      p_template: row.template,
      p_art_flag: row.artFlag,
      p_source: row.source,
    });
    if (error) {
      console.warn("recordFrameRequestAction: rpc error", error.message);
      return { ok: false, error: "rpc" };
    }
    return { ok: true };
  } catch (error) {
    console.warn(
      "recordFrameRequestAction: failed",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "failed" };
  }
}
