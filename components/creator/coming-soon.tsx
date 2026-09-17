"use client";

/** Veils a control that isn't shippable yet: greyed, inert, with a pill
 *  saying so. Keeps the real control mounted so the layout stays honest. */
export function ComingSoon({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative" aria-disabled="true" data-testid="coming-soon">
      <div
        className="pointer-events-none select-none opacity-40 blur-[1px]"
        // Inert keeps the veiled controls out of the tab order too.
        inert
      >
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full border border-border bg-surface/95 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-foreground shadow-sm">
          {label} · Coming soon
        </span>
      </div>
    </div>
  );
}
