import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isPlaceholderStepLabel } from "@/lib/ai/job-privacy";

// ---------------------------------------------------------------------------
// The titles of the AI cards a user received lately — the "do not reuse"
// half of lib/ai/design-variety.ts. Read through the caller's OWN session
// (RLS: owners read only their jobs and idea batches), best effort: a read
// hiccup gives [] and the design still gets its fresh spark.
// ---------------------------------------------------------------------------

/** Recent single-card jobs looked at. */
const RECENT_JOBS = 12;
/** Recent "Get ideas" batches looked at (three ideas each). */
const RECENT_IDEA_BATCHES = 3;

type StepLike = { label?: unknown };
type IdeaLike = { title?: unknown };

export async function recentAiTitles(userId: string): Promise<string[]> {
  try {
    const supabase = await createClient();
    // RLS already scopes both tables to the caller; the owner filter is
    // defence in depth (a policy change must never hand one user's titles
    // to another's prompt).
    const [jobs, ideas] = await Promise.all([
      supabase
        .from("ai_generation_jobs")
        .select("steps")
        .eq("owner_id", userId)
        .in("kind", ["card", "card_fill"])
        .order("created_at", { ascending: false })
        .limit(RECENT_JOBS),
      supabase
        .from("card_idea_batches")
        .select("ideas")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_IDEA_BATCHES),
    ]);
    const titles: string[] = [];
    for (const row of (jobs.data ?? []) as Array<{ steps: unknown }>) {
      const steps = Array.isArray(row.steps) ? (row.steps as StepLike[]) : [];
      for (const step of steps) {
        const label = typeof step?.label === "string" ? step.label.trim() : "";
        // A placeholder names no card: a fill that wrote no title, or a step
        // not done yet (its title waits in the plan, lib/ai/job-privacy.ts).
        if (!label || isPlaceholderStepLabel(label)) continue;
        // A card of two named parts is labelled "Front // Back" (a split, a
        // double-faced fill): each name is a title of its own — the next
        // design must not reuse the front's either.
        for (const part of label.split(" // ")) {
          const title = part.trim();
          if (title && !isPlaceholderStepLabel(title)) titles.push(title);
        }
      }
    }
    for (const row of (ideas.data ?? []) as Array<{ ideas: unknown }>) {
      const list = Array.isArray(row.ideas) ? (row.ideas as IdeaLike[]) : [];
      for (const idea of list) {
        if (typeof idea?.title === "string" && idea.title.trim()) titles.push(idea.title.trim());
      }
    }
    return titles;
  } catch {
    return [];
  }
}
