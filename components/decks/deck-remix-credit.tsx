import Link from "next/link";
import { GitFork } from "lucide-react";
import type { DeckRemixCredit } from "@/lib/decks/remix-credit";

// ---------------------------------------------------------------------------
// A cloned deck's credit (TODO DK5.16), under the hero: "Remixed from
// <deck> by @owner" while the source is public (or the viewer's own), else
// "Remixed from another deck" — never an unlisted or private deck's name or
// link (lib/decks/remix-credit.ts, migration 0164). Not a clone: nothing.
// ---------------------------------------------------------------------------

export async function DeckRemixCreditSlot({ credit }: { credit: Promise<DeckRemixCredit | null> }) {
  return <DeckRemixCreditLine credit={await credit} />;
}

export function DeckRemixCreditLine({ credit }: { credit: DeckRemixCredit | null }) {
  if (!credit) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <GitFork className="h-4 w-4 text-subtle" aria-hidden />
      {credit.shown ? (
        <>
          Remixed from{" "}
          <Link
            href={`/deck/${credit.slug}`}
            className="rounded-sm font-medium text-foreground underline decoration-gold/50 underline-offset-4 hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            {credit.title}
          </Link>
          {credit.ownerUsername ? (
            <>
              {" "}
              by{" "}
              <Link
                href={`/profile/${credit.ownerUsername}`}
                className="rounded-sm font-mono text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                @{credit.ownerUsername}
              </Link>
            </>
          ) : null}
        </>
      ) : (
        "Remixed from another deck"
      )}
    </p>
  );
}
