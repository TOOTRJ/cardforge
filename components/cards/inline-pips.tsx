// ---------------------------------------------------------------------------
// InlinePips — render a sentence with its {W}/{T}/{2/G} codes drawn as real
// mana-font pips, sized to the surrounding text. Read-only counterpart of the
// creator's PipTextEditor; used wherever AI output or stored rules text is
// shown outside the card itself (idea chips, Forge AI suggestions).
// ---------------------------------------------------------------------------

import { splitPipRuns } from "@/lib/cards/pip-runs";
import { cn } from "@/lib/utils";

/** mana-font draws `.ms-cost` as a 1.3em disc; 0.92/1.3 makes the disc
 *  roughly cap-height so it sits in running text like the card preview's. */
export const INLINE_PIP_FONT_SIZE = `${(0.92 / 1.3).toFixed(4)}em`;

export function InlinePip({ suffix, code }: { suffix: string; code: string }) {
  return (
    <i
      role="img"
      aria-label={code}
      title={code}
      className={cn("ms ms-cost ms-shadow mx-[0.06em] align-[-0.08em]", `ms-${suffix}`)}
      style={{ fontSize: INLINE_PIP_FONT_SIZE }}
    />
  );
}

export function InlinePips({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (!text) return null;
  const runs = splitPipRuns(text);
  return (
    <span className={className}>
      {runs.map((run, i) =>
        run.kind === "pip" ? (
          <InlinePip key={i} suffix={run.suffix} code={run.code} />
        ) : (
          <span key={i}>{run.value}</span>
        ),
      )}
    </span>
  );
}
