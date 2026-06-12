// Pure challenge helpers + the row type — safe for client AND server
// imports (lib/challenges/queries.ts is server-only and re-exports these).

export type Challenge = {
  id: string;
  slug: string;
  title: string;
  description: string;
  tag: string;
  hero_image_url: string | null;
  starts_at: string;
  ends_at: string;
  featured: boolean;
  created_at: string;
};

/** Whole-day count until the challenge closes; 0 when closed. */
export function daysLeft(challenge: Pick<Challenge, "ends_at">): number {
  const ms = new Date(challenge.ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function isActive(
  challenge: Pick<Challenge, "starts_at" | "ends_at">,
): boolean {
  const now = Date.now();
  return (
    new Date(challenge.starts_at).getTime() <= now &&
    new Date(challenge.ends_at).getTime() > now
  );
}

export function isUpcoming(
  challenge: Pick<Challenge, "starts_at">,
): boolean {
  return new Date(challenge.starts_at).getTime() > Date.now();
}
