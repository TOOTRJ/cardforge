"use client";

import { useSyncExternalStore } from "react";
import { daysLeft, isActive, type Challenge } from "@/lib/challenges/shared";

// The "Ends in N days" pill on the Community panel's Design challenges link
// (TODO NV1). The window comes from the server (challenge-nav-badge.tsx,
// cached); the days are counted HERE, in the browser, so a static page
// built days ago still counts from today. Nothing on the server render or
// the first client render (no hydration mismatch); none once it has closed.

const noSubscribe = () => () => {};

export function ChallengeEndsBadge({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const days = useSyncExternalStore(
    noSubscribe,
    () => {
      const span: Pick<Challenge, "starts_at" | "ends_at"> = { starts_at: startsAt, ends_at: endsAt };
      return isActive(span) ? daysLeft(span) : 0;
    },
    () => 0,
  );
  if (days <= 0) return null;
  return (
    <span className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-gold-strong">
      {days === 1 ? "Last day" : `Ends in ${days} days`}
    </span>
  );
}
