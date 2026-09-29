import { slotKindFor, type SlotScore } from "@/lib/frames/align";
import {
  consensusNudge,
  formatNudgePct,
  slotWantsNudge,
  type ConsensusNudge,
} from "@/lib/frames/score-batch";
import { frameMatchPct } from "@/lib/cards/frame-signoff";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The results table of a template's scoring (TODO 4.12): one row per slot,
// one column per colour — the slot's edge difference after registration
// (lower is better) and, under it, the nudge that colour's scan suggests —
// plus a "Template nudge" column: the move most colours agree on
// (consensusNudge). A frame's layout override is shared by every colour, so
// that column is the one to act on, in Compare → Edit layout; nothing here
// applies it. Only colours whose score counts today (or that this tab's job
// just scored) vote; stale ones are shown dimmed.
// ---------------------------------------------------------------------------

export type SlotTableColumn = {
  colorKey: string;
  /** "live" = scored by this tab's job, newer than the recorded score. */
  state: "scored" | "live" | "stale" | "unscored" | "no-reference";
  overall: number | null;
  global: { dxPct: number; dyPct: number; confidence: number } | null;
  slots: Record<string, SlotScore> | null;
};

const VOTING = new Set<SlotTableColumn["state"]>(["scored", "live"]);

function NudgeLine({ dxPct, dyPct }: { dxPct: number; dyPct: number }) {
  return (
    <span className="whitespace-nowrap text-[10px] text-sky-200/90">
      → {formatNudgePct(dxPct)} / {formatNudgePct(dyPct)}
    </span>
  );
}

function ConsensusCell({ nudge, voters }: { nudge: ConsensusNudge | null; voters: number }) {
  if (voters === 0) return <span className="text-[11px] text-subtle">—</span>;
  if (!nudge) {
    return (
      <span className="text-[11px] text-subtle" title="No move that most colours agree on.">
        stays
      </span>
    );
  }
  return (
    <span
      className="flex flex-col leading-tight"
      title={`${nudge.agree} of ${nudge.of} colours move this way. Mean score ${nudge.meanScore}% now, ${nudge.meanBest}% at each colour's own best spot. Apply it once in Compare → Edit layout: the layout is shared by every colour.`}
    >
      <span className="whitespace-nowrap text-[11px] font-semibold text-sky-200">
        → {formatNudgePct(nudge.dxPct)} / {formatNudgePct(nudge.dyPct)}
      </span>
      <span className="text-[10px] text-subtle tabular-nums">
        {nudge.agree} of {nudge.of} · {nudge.meanScore} → {nudge.meanBest}
      </span>
    </span>
  );
}

export function FrameSlotTable({
  columns,
  slotOrder,
}: {
  columns: SlotTableColumn[];
  /** The template's slots in editor order; slots only a score names are
   *  appended. */
  slotOrder: string[];
}) {
  const scored = columns.filter((c) => c.slots);
  if (scored.length === 0) {
    return (
      <p className="text-xs text-subtle" data-testid="slot-table-empty">
        No colour has a recorded score yet — Score all colours to fill the table.
      </p>
    );
  }
  const paths = [...slotOrder];
  for (const column of scored) {
    for (const path of Object.keys(column.slots ?? {})) {
      if (!paths.includes(path)) paths.push(path);
    }
  }
  const voters = columns.filter((c) => VOTING.has(c.state) && c.slots);

  return (
    <div className="overflow-x-auto" data-testid="slot-table">
      <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
        <caption className="sr-only">
          Per-slot edge difference and suggested nudge for every colour
        </caption>
        <thead>
          <tr className="border-b border-border/50 text-[11px] uppercase tracking-wider text-subtle">
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Slot
            </th>
            {columns.map((column) => (
              <th
                key={column.colorKey}
                scope="col"
                className={cn("px-2 py-1.5 font-medium", !VOTING.has(column.state) && "opacity-60")}
                title={
                  column.state === "stale"
                    ? "Scored on an older renderer, override or reference — score it again."
                    : column.state === "live"
                      ? "Just scored by this tab's job."
                      : undefined
                }
              >
                {column.colorKey}
                {column.state === "stale" ? <span className="ml-1 normal-case text-gold-strong">stale</span> : null}
                {column.state === "live" ? <span className="ml-1 normal-case text-sky-200">new</span> : null}
              </th>
            ))}
            <th scope="col" className="px-2 py-1.5 font-medium text-foreground">
              Template nudge
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/30">
            <th scope="row" className="py-1.5 pr-3 font-medium text-foreground">
              frame
            </th>
            {columns.map((column) => (
              <td
                key={column.colorKey}
                className={cn("px-2 py-1.5 tabular-nums", !VOTING.has(column.state) && "opacity-60")}
              >
                {column.overall === null ? (
                  <span className="text-subtle">—</span>
                ) : (
                  <span className="flex flex-col leading-tight">
                    <span className="font-semibold text-foreground">{column.overall}%</span>
                    <span className="text-[10px] text-subtle">{frameMatchPct(column.overall)}% match</span>
                  </span>
                )}
              </td>
            ))}
            <td className="px-2 py-1.5" />
          </tr>
          <tr className="border-b border-border/30">
            <th
              scope="row"
              className="py-1.5 pr-3 font-medium text-muted"
              title="Where the scan sat before it was lined up (already compensated in every number). Confidence 1 = same structure; a low one means the numbers below are shaky."
            >
              scan offset
            </th>
            {columns.map((column) => (
              <td
                key={column.colorKey}
                className={cn("px-2 py-1.5 tabular-nums text-muted", !VOTING.has(column.state) && "opacity-60")}
              >
                {column.global ? (
                  <span className="flex flex-col leading-tight">
                    <span className="whitespace-nowrap text-[11px]">
                      {formatNudgePct(column.global.dxPct)} / {formatNudgePct(column.global.dyPct)}
                    </span>
                    <span
                      className={cn(
                        "text-[10px]",
                        column.global.confidence < 0.5 ? "text-gold-strong" : "text-subtle",
                      )}
                    >
                      conf {column.global.confidence}
                    </span>
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </td>
            ))}
            <td className="px-2 py-1.5" />
          </tr>
          {paths.map((path) => {
            const isArt = slotKindFor(path) === "art";
            const samples = voters
              .map((c) => c.slots?.[path])
              .filter((s): s is SlotScore => s !== undefined);
            const nudge = isArt ? null : consensusNudge(samples);
            return (
              <tr key={path} className="border-b border-border/20" data-testid={`slot-row-${path}`}>
                <th scope="row" className="py-1.5 pr-3 font-medium text-muted">
                  {path}
                  {isArt ? <span className="ml-1 text-[10px] font-normal text-subtle">(art differs)</span> : null}
                </th>
                {columns.map((column) => {
                  const slot = column.slots?.[path];
                  return (
                    <td
                      key={column.colorKey}
                      className={cn("px-2 py-1.5 align-top tabular-nums", !VOTING.has(column.state) && "opacity-60")}
                    >
                      {slot ? (
                        <span
                          className="flex flex-col leading-tight"
                          title={slotWantsNudge(slot) ? `would score ${slot.best}% moved` : undefined}
                        >
                          <span className="text-foreground">{slot.score}%</span>
                          {!isArt && slotWantsNudge(slot) ? <NudgeLine dxPct={slot.dxPct} dyPct={slot.dyPct} /> : null}
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 align-top" data-testid={`slot-consensus-${path}`}>
                  {isArt ? (
                    <span className="text-[11px] text-subtle">—</span>
                  ) : (
                    <ConsensusCell nudge={nudge} voters={samples.length} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
