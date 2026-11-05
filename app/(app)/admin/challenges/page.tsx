import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ChallengeAdmin, type ChallengeWinnersPick } from "@/components/admin/challenge-admin";
import { listChallenges, type Challenge } from "@/lib/challenges/queries";
import { isActive, isUpcoming } from "@/lib/challenges/shared";
import { listPublicCardsRich } from "@/lib/cards/queries";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { isWinnerPlace } from "@/lib/challenges/winners-shared";

export const metadata: Metadata = {
  title: "Challenges admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ChallengesAdminPage() {
  // Non-admins get a 404 (don't reveal the route exists) — same posture as
  // /admin/moderation. RLS independently blocks non-admin writes.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();

  const challenges = await listChallenges();
  const winners = await readWinnerPicks(challenges);

  return (
    <DashboardShell readable>
      <PageHeader
        eyebrow="Admin"
        title="Design challenges"
        description="Author the briefs the community designs against. Entries are public cards wearing the challenge tag; the featured challenge also gets the gallery banner."
      />
      <ChallengeAdmin challenges={challenges} winners={winners} />
    </DashboardShell>
  );
}

/** The closed challenges' winners pickers (TODO NV12): the 20 most recently
 *  closed, each with its public entries (most liked first) and its places
 *  today, read with the admin's own session (0172's select policy shows an
 *  admin every row). */
async function readWinnerPicks(
  challenges: Challenge[],
): Promise<Record<string, ChallengeWinnersPick>> {
  const closed = challenges.filter((c) => !isActive(c) && !isUpcoming(c)).slice(0, 20);
  if (closed.length === 0) return {};
  const supabase = await createClient();
  const picks = await Promise.all(
    closed.map(async (challenge) => {
      const [entries, { data: rows }] = await Promise.all([
        listPublicCardsRich({ tag: challenge.tag, sort: "popular", limit: 60 }),
        supabase.from("challenge_winners").select("place, card_id").eq("challenge_id", challenge.id),
      ]);
      const initial: ChallengeWinnersPick["initial"] = [null, null, null];
      for (const row of rows ?? []) {
        if (isWinnerPlace(row.place)) initial[row.place - 1] = row.card_id;
      }
      const pick: ChallengeWinnersPick = {
        entries: entries.map((card) => ({
          id: card.id,
          title: card.title,
          ownerUsername: card.owner?.username ?? null,
          likes: card.likes_count,
        })),
        initial,
      };
      return [challenge.id, pick] as const;
    }),
  );
  return Object.fromEntries(picks);
}
