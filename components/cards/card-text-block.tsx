import type { ReactNode } from "react";
import { InlinePips } from "@/components/cards/inline-pips";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { describeManaCost } from "@/lib/cards/card-display";
import { flavorSegments } from "@/lib/cards/flavor-markup";
import type { PipOverrides } from "@/lib/pips/override";
import { cn } from "@/lib/utils";
import type { CardTextFace } from "@/lib/cards/card-text-faces";

// ---------------------------------------------------------------------------
// CardTextBlock — one face of a card as TEXT, laid out the way the card and
// every card database print it (TODO CP2b): the name with its cost as the
// card's own pips, the type line with the rarity, the rules (pips inline,
// reminder text in italics), the flavour, the artist and the stats. What the
// picture shows, readable by a screen reader, a crawler and someone who
// wants to copy a line. The card page draws one per face (the front, then a
// back with a body of its own) inside "Card details".
// ---------------------------------------------------------------------------

export type { CardTextFace };

export function CardTextBlock({
  face,
  pipOverrides,
  testId,
  label,
}: {
  face: CardTextFace;
  pipOverrides: PipOverrides | null;
  testId?: string;
  /** The block's name for assistive tech ("Front face", "Back face"). */
  label: string;
}) {
  const rules = (face.rulesText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const flavor = (face.flavorText ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="overflow-hidden rounded-card border border-border/60 bg-surface/60 text-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <p className="min-w-0 font-display text-base font-semibold leading-6 text-foreground">{face.name}</p>
        {face.cost?.trim() ? <CostPips cost={face.cost} overrides={pipOverrides} /> : null}
      </div>
      <p className="border-b border-border/60 px-4 py-2.5 leading-6 text-foreground" data-testid="card-text-type">
        <span>{face.typeLine}</span>
        {face.rarity ? (
          <span className="text-muted">
            <span aria-hidden> · </span>
            <span className="sr-only">, rarity </span>
            {face.rarity}
          </span>
        ) : null}
      </p>
      {rules.length > 0 || flavor.length > 0 ? (
        <div className="flex flex-col gap-2 px-4 py-3 leading-6 text-foreground">
          {rules.map((line, i) => (
            <p key={`r${i}`}>
              <RulesLine line={line} />
            </p>
          ))}
          {flavor.length > 0 ? (
            <div className={cn("flex flex-col gap-1 text-muted", rules.length > 0 && "border-t border-border/40 pt-2")}>
              {flavor.map((line, i) => (
                <p key={`f${i}`} className="italic">
                  {flavorSegments(line).map((seg, j) =>
                    seg.upright ? (
                      <span key={j} className="not-italic">
                        {seg.text}
                      </span>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {face.artist || face.stats || face.colorLine ? (
        <div className="flex items-end justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted">
            {face.colorLine ? <p>Color: {face.colorLine}</p> : null}
            {face.artist ? (
              <p>
                Illustrated by <span className="text-foreground">{face.artist}</span>
              </p>
            ) : null}
          </div>
          {face.stats ? (
            <p
              className="shrink-0 rounded-md border border-border/60 bg-elevated/60 px-2.5 py-0.5 font-display text-base font-semibold tabular-nums text-foreground"
              data-testid="card-text-stats"
            >
              {face.stats.label ? <span className="sr-only">{face.stats.label}: </span> : null}
              {face.stats.value}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A rules line: its pips drawn, its reminder text — a run in parentheses —
 *  in italics, as printed. */
function RulesLine({ line }: { line: string }) {
  const parts: ReactNode[] = [];
  const reminder = /\([^()]*\)/g;
  let cursor = 0;
  for (const match of line.matchAll(reminder)) {
    const at = match.index ?? 0;
    if (at > cursor) parts.push(<InlinePips key={`t${at}`} text={line.slice(cursor, at)} />);
    parts.push(<InlinePips key={`m${at}`} text={match[0]} className="italic text-muted" />);
    cursor = at + match[0].length;
  }
  if (cursor < line.length) parts.push(<InlinePips key="end" text={line.slice(cursor)} />);
  return <>{parts}</>;
}

/** A cost's pips: the card's own pip drawings (CardPip through
 *  ManaCostGlyphs' `disc`, in the default "modern" style — the look UI1's
 *  colour pips have, ColorPip) at a UI size, the owner's custom pips where
 *  the card draws them. The pictures are decorative: the cost is said in
 *  words beside them, for a screen reader and a crawler ("2 generic,
 *  blue"). */
const COST_DISC = { size: "18px", gap: "3px", px: 18 } as const;

export function CostPips({ cost, overrides }: { cost: string; overrides: PipOverrides | null }) {
  return (
    <span className="inline-flex shrink-0 items-center align-middle" data-testid="card-details-cost">
      <span aria-hidden className="inline-flex py-0.5">
        <ManaCostGlyphs cost={cost} disc={COST_DISC} overrides={overrides} className="flex-wrap justify-end gap-y-1" />
      </span>
      <span className="sr-only">Mana cost: {describeManaCost(cost) || cost}</span>
    </span>
  );
}
