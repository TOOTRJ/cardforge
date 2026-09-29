import "server-only";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { notifyIndexNow } from "@/lib/seo/indexnow";

// ---------------------------------------------------------------------------
// Cache invalidation for a deck mutation — shared by the owner's deck actions
// (lib/decks/actions.ts) and the flagged-file rescan clearing a deck cover
// (lib/moderation/flagged-file.ts). Plain module, not "use server": a helper,
// not an endpoint.
// ---------------------------------------------------------------------------

export function revalidateDeckPaths(slug: string, ownerUsername?: string | null) {
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks"); // public browse (live from PR 2 of the decks series)
  revalidatePath("/dashboard");
  revalidatePath(`/deck/${slug}`);
  revalidatePath(`/deck/${slug}/edit`);
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
  // Tell IndexNow engines the deck URL changed (or now 404s) — best-effort,
  // off the request path. A private deck 404s for them, which is the point.
  after(() =>
    notifyIndexNow([
      `/deck/${slug}`,
      ...(ownerUsername ? [`/profile/${ownerUsername}`] : []),
    ]),
  );
}
