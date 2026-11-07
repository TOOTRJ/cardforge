import type { Metadata } from "next";
import Link from "next/link";
import { ToolShell } from "@/components/tools/tool-shell";
import { BulkSearch } from "@/components/tools/bulk-customize/bulk-search";
import { openTool } from "@/lib/tools/queries";
import { formatShortDate } from "@/lib/format/dates";
import { listRecentBulkBatches } from "@/lib/tools/bulk-customize/server";

// ---------------------------------------------------------------------------
// /dashboard/tools/bulk-customize — the Bulk Customize beta tool (migration
// 0186): tick several REAL cards and make them your own in one go, with one
// look and one art choice for all of them. The same dialog opens from the
// Collection Deck Builder's selection and a deck's selection; this page is
// its search door and its history. Admins and testers while in beta
// (openTool: a 404 for anyone else).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Bulk Customize",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BulkCustomizePage() {
  const entry = await openTool("bulk-customize");
  const recent = await listRecentBulkBatches(entry.userId);
  return (
    <ToolShell entry={entry}>
      <div className="flex flex-col gap-8">
        <div className="max-w-[38rem] text-sm text-muted">
          <p>
            Pick real cards and make them your own all at once: one frame, border, set symbol and watermark for every
            card, and either each printing&apos;s art, your own art later, or new AI art in one style. You see what the
            batch costs before anything is made.
          </p>
          <p className="mt-2">
            You can also tick cards in your{" "}
            <Link href="/dashboard/tools/collection-builder" className="text-primary-bright underline-offset-2 hover:underline">
              collection
            </Link>{" "}
            or select cards on one of your decks and press Customize there.
          </p>
        </div>

        <BulkSearch />

        {recent.length > 0 ? (
          <section aria-labelledby="bulk-recent" className="flex flex-col gap-3">
            <h2 id="bulk-recent" className="font-display text-lg text-foreground">
              Recent batches
            </h2>
            <ul className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/60">
              {recent.map((batch) => (
                <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-foreground">{formatShortDate(batch.createdAt)}</span>
                  <span className="text-muted">
                    {batch.made} of {batch.cards} made
                    {batch.failed > 0 ? ` · ${batch.failed} didn't` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/dashboard/cards" className="text-sm text-primary-bright underline-offset-2 hover:underline">
              See your cards in My Cards
            </Link>
          </section>
        ) : null}
      </div>
    </ToolShell>
  );
}
