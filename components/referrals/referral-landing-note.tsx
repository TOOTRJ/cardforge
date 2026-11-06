"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gift } from "lucide-react";
import { normalizeReferralCode } from "@/lib/referrals/rules";
import { readReferralShareInfo } from "@/lib/sharing/referral-share-client";

// ---------------------------------------------------------------------------
// One quiet line under a card opened through a friend's share link (TODO
// SG1): the address carries `?ref=<code>`, the visitor is signed out, the
// program is on → "Made on PipGlyph · your friend's link gets you 30 free
// days of Plus when you save your first card" with a Create button. The
// card page is static (ISR) and this is per-visitor, so it is a client
// island that renders nothing until it knows. The referral itself is
// already captured by AttributionCapture (the root layout) — this only says
// so. A signed-in viewer (code present in the answer) sees nothing.
// ---------------------------------------------------------------------------

export function ReferralLandingNote() {
  const [friendGets, setFriendGets] = useState<string | null>(null);
  useEffect(() => {
    const code = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
    if (!code) return;
    let live = true;
    void readReferralShareInfo().then((info) => {
      if (!live || !info?.enabled || !info.friendGets || info.code) return;
      setFriendGets(info.friendGets);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!friendGets) return null;
  return (
    <p
      data-testid="referral-landing-note"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-primary-bright/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
    >
      <Gift className="h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
      <span>
        Made on PipGlyph. Your friend&apos;s link gets you {friendGets} when you save your first card.
      </span>
      <Link href="/signup" className="font-medium text-primary-bright underline-offset-4 hover:underline">
        Create your own card
      </Link>
    </p>
  );
}
