"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { useLiveCredits } from "@/components/billing/credits-bus";
import { formatCredits } from "@/lib/billing/plans";

/** The header's credits indicator, kept live by the credits bus so the
 *  balance ticks down/up in real time while an AI generation runs. */
export function HeaderCreditsChip({
  credits,
  creditsUsed,
}: {
  credits: number;
  creditsUsed: number;
}) {
  const balance = useLiveCredits(credits);
  return (
    <Link
      href="/settings#billing"
      title="AI credits — balance · used this month"
      className="hidden h-9 items-center gap-1.5 rounded-md border border-border/60 bg-elevated px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong sm:inline-flex"
    >
      <Coins className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
      <span>{formatCredits(balance)}</span>
      {/* Below lg the row holds the account controls and the hamburger only
          (TODO 3b.27): the balance stays, "used" moves to the title and to
          the drawer's Account line. */}
      <span className="hidden text-subtle lg:inline">· {creditsUsed} used</span>
    </Link>
  );
}
