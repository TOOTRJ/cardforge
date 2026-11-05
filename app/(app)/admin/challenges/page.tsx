import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import {
  ChallengeAdmin,
  type ChallengeWinnersPick,
} from "@/components/admin/challenge-admin";
import type { WinnerEntryOption } from "@/components/admin/challenge-winners-editor";
import { listChallenges, type Challenge } from "@/lib/challenges/queries";
import { isActive, isUpcoming } from "@/lib/challenges/shared";
import { listPublicCardsRich } from "@/lib/cards/queries";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
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

/** How many entries each picker lists, most liked first. */
const PICKER_ENTRIES = 100;

/** The closed challenges' winners pickers (TODO NV12): the 20 most recently
 *  closed, each with its public entries (most liked first) and its places
 *  today, read with the admin's own session (0172's select policy shows an
 *  admin every row). A winner whose card is not in that list (gone private,
 *  lost the tag, past the list's length) is added as a STALE option, read
 *  with the service role on this admin-only page, so the picker shows it and
 *  can clear it instead of keeping it out of sight. */
async function readWinnerPicks(
  challenges: Challenge[],
): Promise<Record<string, ChallengeWinnersPick>> {
  const closed = challenges
    .filter((c) => !isActive(c) && !isUpcoming(c))
    .slice(0, 20);
  if (closed.length === 0) return {};
  const supabase = await createClient();
  const picks = await Promise.all(
    closed.map(async (challenge) => {
      const [entries, { data: rows }] = await Promise.all([
        listPublicCardsRich({
          tag: challenge.tag,
          sort: "popular",
          limit: PICKER_ENTRIES,
        }),
        supabase
          .from("challenge_winners")
          .select("place, card_id")
          .eq("challenge_id", challenge.id),
      ]);
      const initial: ChallengeWinnersPick["initial"] = [null, null, null];
      for (const row of rows ?? []) {
        if (isWinnerPlace(row.place)) initial[row.place - 1] = row.card_id;
      }
      const listed = new Set(entries.map((card) => card.id));
      const pick: ChallengeWinnersPick = {
        entries: [
          ...entries.map((card) => ({
            id: card.id,
            title: card.title,
            ownerUsername: card.owner?.username ?? null,
            likes: card.likes_count,
          })),
          ...(await staleWinnerOptions(
            initial.filter((id): id is string => !!id && !listed.has(id)),
          )),
        ],
        initial,
      };
      return [challenge.id, pick] as const;
    }),
  );
  return Object.fromEntries(picks);
}

/** The picker's option for each winner it has no entry for. */
async function staleWinnerOptions(
  ids: readonly string[],
): Promise<WinnerEntryOption[]> {
  if (ids.length === 0) return [];
  const fallback = ids.map((id) => ({
    id,
    title: "A removed card",
    ownerUsername: null,
    likes: 0,
    stale: true,
  }));
  if (!isAdminConfigured()) return fallback;
  const admin = createAdminClient();
  const { data: cards } = await admin
    .from("cards")
    .select("id, title, owner_id")
    .in("id", [...ids]);
  const ownerIds = [...new Set((cards ?? []).map((card) => card.owner_id))];
  const { data: owners } = ownerIds.length
    ? await admin.from("profiles").select("id, username").in("id", ownerIds)
    : { data: [] };
  const handles = new Map(
    (owners ?? []).map((owner) => [owner.id, owner.username]),
  );
  const byId = new Map((cards ?? []).map((card) => [card.id, card]));
  return fallback.map((option) => {
    const card = byId.get(option.id);
    return card
      ? {
          ...option,
          title: card.title,
          ownerUsername: handles.get(card.owner_id) ?? null,
        }
      : option;
  });
}
