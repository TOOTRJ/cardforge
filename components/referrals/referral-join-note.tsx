"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { storedReferralCode } from "@/lib/analytics/attribution-client";
import { readReferralShareInfo } from "@/lib/sharing/referral-share-client";

// ---------------------------------------------------------------------------
// "You're joining through a friend's link" — on the sign-up page and the
// onboarding stepper (owner 2026-11-06): the tab's first touch holds a
// referral code (AttributionCapture), the program is on, so the person
// signing up is told, in one line, that their account starts with the
// signup days and that the referral adds the friend's days (owner
// 2026-11-06: nothing more before sign-up). Nothing for anyone else. The
// referral itself is claimed at onboarding from the same code; this only
// says so.
// ---------------------------------------------------------------------------

export function ReferralJoinNote({ where }: { where: "signup" | "onboarding" }) {
  const [info, setInfo] = useState<{ friendGets: string; signupDays: number } | null>(null);
  useEffect(() => {
    if (!storedReferralCode()) return;
    let live = true;
    void readReferralShareInfo().then((next) => {
      if (live && next?.enabled && next.friendGets) setInfo({ friendGets: next.friendGets, signupDays: next.signupDays ?? 7 });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!info) return null;
  const { friendGets, signupDays } = info;
  // Short on purpose (owner 2026-11-06): the signup days and the referral's
  // extra; what earns the extra (the first cards, each with its own
  // artwork) is explained after sign-up, on the Refer-a-friend page.
  return (
    <p
      data-testid="referral-join-note"
      className="flex items-start gap-2 rounded-md border border-primary-bright/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
    >
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
      <span>
        {where === "signup" ? "You're joining through a friend's link: " : "You joined through a friend's link: "}
        {`your account starts with ${signupDays} free days, and the referral adds ${friendGets.replace(/ free days?$/, "")} more. Your friend gets a reward too.`}
      </span>
    </p>
  );
}
