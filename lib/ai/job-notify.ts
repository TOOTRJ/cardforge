import "server-only";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { GenerationJobRow } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// One "deck_generated" notification per finished deck job (bell, page and
// realtime toast — see lib/notifications/describe.ts). Called by the step
// route after every step; it only acts when the job has just reached a
// terminal status, and the payload.jobId index (migration 0084) makes the
// insert idempotent across parallel workers and retries.
// ---------------------------------------------------------------------------

export async function notifyDeckJobFinished(job: GenerationJobRow): Promise<void> {
  if (job.kind !== "deck" && job.kind !== "deck_remix") return;
  if (job.status !== "done" && job.status !== "done_with_errors") return;
  if (!job.deck_id || !isAdminConfigured()) return;
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("type", "deck_generated")
    .filter("payload->>jobId", "eq", job.id)
    .limit(1)
    .maybeSingle();
  if (existing) return;
  const { data: deck } = await admin
    .from("decks")
    .select("slug, title")
    .eq("id", job.deck_id)
    .maybeSingle();
  // Cards only: the free cover and guide steps are neither "cards ready"
  // nor "cards needing a retry".
  const isCard = (s: { key: string }) => s.key !== "cover" && s.key !== "guide";
  const done = job.steps.filter((s) => s.status === "done" && isCard(s)).length;
  const failed = job.steps.filter((s) => s.status === "failed" && isCard(s)).length;
  const { error } = await admin.from("notifications").insert({
    recipient_id: job.owner_id,
    actor_id: job.owner_id,
    type: "deck_generated",
    payload: {
      jobId: job.id,
      deckId: job.deck_id,
      slug: deck?.slug ?? null,
      title: deck?.title ?? null,
      done,
      failed,
    },
  });
  if (error) console.warn(`notifyDeckJobFinished(${job.id}): insert error`, error.message);
}
