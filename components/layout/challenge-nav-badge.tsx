import { getNavChallenge } from "@/lib/challenges/queries";
import { ChallengeEndsBadge } from "./challenge-ends-badge";

// Server half of the Community panel's challenge pill: AppShell renders it
// inside a Suspense boundary and hands it to the header as a node, the way
// the what's-new ribbon is read — a cookie-free cached read, so a static
// page stays static and a dynamic one never waits on it.
export async function ChallengeNavBadge() {
  const challenge = await getNavChallenge();
  if (!challenge) return null;
  return <ChallengeEndsBadge startsAt={challenge.starts_at} endsAt={challenge.ends_at} />;
}
