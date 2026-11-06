"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { storedReferralCode } from "@/lib/analytics/attribution-client";
import { REFERRAL_ACTIVATION_WINDOW_DAYS } from "@/lib/referrals/rules";
import { readReferralShareInfo } from "@/lib/sharing/referral-share-client";

// ---------------------------------------------------------------------------
// "You're joining through a friend's link" — on the sign-up page and the
// onboarding stepper (owner 2026-11-06): the tab's first touch holds a
// referral code (AttributionCapture), the program is on, so the person
// signing up is told what the link gets them and what it takes — a first
// saved card within the window. Nothing for anyone else. The referral
// itself is claimed at onboarding from the same code; this only says so.
// ---------------------------------------------------------------------------

export function ReferralJoinNote({ where }: { where: "signup" | "onboarding" }) {
  const [friendGets, setFriendGets] = useState<string | null>(null);
  useEffect(() => {
    if (!storedReferralCode()) return;
    let live = true;
    void readReferralShareInfo().then((info) => {
      if (live && info?.enabled && info.friendGets) setFriendGets(info.friendGets);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!friendGets) return null;
  return (
    <p
      data-testid="referral-join-note"
      className="flex items-start gap-2 rounded-md border border-primary-bright/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
    >
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
      <span>
        {where === "signup" ? "You're joining through a friend's link. " : "You joined through a friend's link. "}
        Save your first card within {REFERRAL_ACTIVATION_WINDOW_DAYS} days of signing up and you get {friendGets} — your
        friend gets a reward too.
      </span>
    </p>
  );
}
