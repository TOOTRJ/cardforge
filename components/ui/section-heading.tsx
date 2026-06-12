import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SectionHeading — the PipGlyph heading pattern: small gold caps eyebrow,
// serif display title, muted description. Used by marketing sections and
// (via PageHeader) app pages so the brand voice stays consistent without
// per-page re-styling.
// ---------------------------------------------------------------------------

type SectionHeadingProps = {
  /** Small uppercase label above the title, rendered in gold. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "center";
  /** Heading element for the title. Visual size is independent (`size`). */
  as?: "h1" | "h2" | "h3";
  /** lg = hero scale, md = section scale. */
  size?: "md" | "lg";
  className?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  as: Heading = "h2",
  size = "md",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          {eyebrow}
        </p>
      ) : null}
      <Heading
        className={cn(
          "text-balance font-display font-semibold tracking-tight text-foreground",
          size === "lg"
            ? "text-4xl sm:text-5xl"
            : "text-2xl sm:text-3xl",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className="mt-3 text-sm leading-relaxed text-muted sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
