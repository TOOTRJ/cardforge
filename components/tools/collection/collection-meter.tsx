import type { CollectionStats } from "@/lib/tools/collection/queries";
import { cn } from "@/lib/utils";

const n = (value: number) => value.toLocaleString("en-US");

/** The collection in three numbers and the cap's meter. The cap counts
 *  DIFFERENT cards (each printing, finish and language) — copies never —
 *  and nothing here touches the saved-card limit. */
export function CollectionMeter({ stats }: { stats: CollectionStats }) {
  const share = stats.cap > 0 ? Math.min(1, stats.cards / stats.cap) : 0;
  const near = share >= 0.9;
  return (
    <section aria-labelledby="collection-meter-title" className="rounded-xl border border-border bg-surface/60 p-4 sm:p-5">
      <h2 id="collection-meter-title" className="sr-only">
        Your collection
      </h2>
      <dl className="grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Different cards</dt>
          <dd className="font-display text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{n(stats.cards)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Copies</dt>
          <dd className="font-display text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{n(stats.copies)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Commanders</dt>
          <dd className="font-display text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{n(stats.commanders)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-col gap-1.5">
        <div
          role="meter"
          aria-label="Collection space used"
          aria-valuemin={0}
          aria-valuemax={stats.cap}
          aria-valuenow={stats.cards}
          aria-valuetext={`${n(stats.cards)} of ${n(stats.cap)} different cards`}
          className="h-1.5 overflow-hidden rounded-full bg-elevated"
        >
          <div
            className={cn("h-full rounded-full", near ? "bg-ember" : "bg-primary-bright")}
            style={{ width: `${Math.max(share > 0 ? 1 : 0, share * 100)}%` }}
          />
        </div>
        <p className="text-xs text-subtle">
          {`${n(stats.cards)} of ${n(stats.cap)} different cards. Copies of one card don't count, and your collection never uses your saved-card slots.`}
        </p>
      </div>
    </section>
  );
}
