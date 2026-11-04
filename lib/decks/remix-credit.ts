import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// A cloned deck's "Remixed from <deck> by <owner>" (TODO DK5.16), read
// through migration 0164's deck_remix_credit() — the lineage table is no API
// role's. The source is NAMED only while it is public (or the viewer's own);
// otherwise the credit says "another deck" — never an unlisted or private
// deck's name or link. Null: the deck is not a clone (or the database hasn't
// reached 0164).
// ---------------------------------------------------------------------------

export type DeckRemixCredit =
  | { shown: true; slug: string; title: string; ownerUsername: string | null }
  | { shown: false };

/** The credit row as the function hands it, read safely. */
export function remixCreditOf(row: unknown): DeckRemixCredit | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.source_slug === "string" && r.source_slug && typeof r.source_title === "string") {
    return {
      shown: true,
      slug: r.source_slug,
      title: r.source_title,
      ownerUsername: typeof r.source_owner_username === "string" ? r.source_owner_username : null,
    };
  }
  return { shown: false };
}

export async function getDeckRemixCredit(deckId: string): Promise<DeckRemixCredit | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("deck_remix_credit", { p_deck_id: deckId });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return remixCreditOf(data[0]);
  } catch {
    return null;
  }
}
