import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// Pieces the deck and set analytics panels share.
// ---------------------------------------------------------------------------

/** Legend swatch per color identity — Tailwind classes, not brand hexes,
 *  because these sit on themed surfaces. */
export const COLOR_DOT_CLASS: Record<ColorIdentity, string> = {
  white: "bg-amber-200",
  blue: "bg-sky-400",
  black: "bg-zinc-500",
  red: "bg-rose-400",
  green: "bg-emerald-400",
  colorless: "bg-slate-400",
  multicolor: "bg-linear-to-r from-fuchsia-400 to-amber-300",
};

export type BarRow = { key: string; label: string; count: number };

/** Horizontal bars scaled to the largest count. Renders `emptyMessage`
 *  (or nothing) when there are no rows. */
export function BarList({
  rows,
  emptyMessage,
}: {
  rows: BarRow[];
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return emptyMessage ? (
      <span className="text-xs text-muted">{emptyMessage}</span>
    ) : null;
  }
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-muted">{row.label}</span>
          <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-elevated">
            <span
              className="absolute inset-y-0 left-0 bg-linear-to-r from-primary to-accent"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-muted">
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}
