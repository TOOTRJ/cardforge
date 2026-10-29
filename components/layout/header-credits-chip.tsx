"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { useLiveCredits } from "@/components/billing/credits-bus";
import { formatCredits } from "@/lib/billing/plans";
import { trackNavClick } from "./nav-click";

/** The header's credits indicator, kept live by the credits bus so the
 *  balance ticks down/up in real time while an AI generation runs. It opens
 *  Billing & plan — the ONE billing destination (/dashboard/billing, the
 *  Account menu's too; TODO NV1). */
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
      href="/dashboard/billing"
      title="AI credits — balance · used this month"
      onClick={() => trackNavClick("credits", "header", true)}
      className="hidden h-9 items-center gap-1.5 rounded-md border border-border/60 bg-elevated px-2.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 sm:inline-flex"
    >
      <Coins className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
      <span>{formatCredits(balance)}</span>
      <span className="sr-only">AI credits</span>
      {/* Below lg the row holds the account controls and the hamburger only
          (TODO 3b.27): the balance stays, "used" moves to the title and to
          the drawer's Account line. */}
      <span className="hidden text-subtle lg:inline">· {creditsUsed} used</span>
    </Link>
  );
}
