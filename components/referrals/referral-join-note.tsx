"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { storedReferralCode } from "@/lib/analytics/attribution-client";
import { REFERRAL_ACTIVATION_CARDS, REFERRAL_ACTIVATION_WINDOW_DAYS } from "@/lib/referrals/rules";
import { readReferralShareInfo } from "@/lib/sharing/referral-share-client";

// ---------------------------------------------------------------------------
// "You're joining through a friend's link" — on the sign-up page and the
// onboarding stepper (owner 2026-11-06): the tab's first touch holds a
// referral code (AttributionCapture), the program is on, so the person
// signing up is told what the link gets them and what it takes (0180): the
// settings' cards saved within the window, and a plan started with a card
// on file — free with their banked days, cancel any time. Nothing for
// anyone else. The referral itself is claimed at onboarding from the same
// code; this only says so.
// ---------------------------------------------------------------------------

export function ReferralJoinNote({ where }: { where: "signup" | "onboarding" }) {
  const [info, setInfo] = useState<{ friendGets: string; cards: number; windowDays: number } | null>(null);
  useEffect(() => {
    if (!storedReferralCode()) return;
    let live = true;
    void readReferralShareInfo().then((next) => {
      if (live && next?.enabled && next.friendGets) {
        setInfo({
          friendGets: next.friendGets,
          cards: next.cardsRequired ?? REFERRAL_ACTIVATION_CARDS,
          windowDays: next.windowDays ?? REFERRAL_ACTIVATION_WINDOW_DAYS,
        });
      }
    });
    return () => {
      live = false;
    };
  }, []);
  if (!info) return null;
  const { friendGets, cards, windowDays } = info;
  return (
    <p
      data-testid="referral-join-note"
      className="flex items-start gap-2 rounded-md border border-primary-bright/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
    >
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
      <span>
        {where === "signup" ? "You're joining through a friend's link. " : "You joined through a friend's link. "}
        Save {cards} cards within {windowDays} days of signing up and start a plan with a card on file (your banked days
        make it free — cancel any time), and {friendGets} are added to your bank. Your friend gets a reward too.
      </span>
    </p>
  );
}
