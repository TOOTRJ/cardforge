import Link from "next/link";
import type { ReactNode } from "react";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { slugifyTag } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// MDX component map for article bodies (passed to MDXRemote). Everything here
// is a server component — articles stay static HTML with zero shipped JS.
//
// Available to authors inside .mdx:
//   <Mana cost="{2}{R}{R}" />            inline mana pips (real Mana font)
//   <Callout tone="tip|note|warning">…</Callout>   boxed aside
//
// h2/h3 are overridden to carry slugified ids so the table of contents (built
// from the same slugifyTag in extractToc) links to real anchors. Links to
// internal paths use next/link; external links open safely in a new tab.
// ---------------------------------------------------------------------------

/** Flatten heading children to their visible text so the generated id matches
 *  the one extractToc derives from the raw Markdown. */
function childrenToString(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childrenToString).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return childrenToString(props?.children);
  }
  return "";
}

function Heading2({ children }: { children?: ReactNode }) {
  return <h2 id={slugifyTag(childrenToString(children))}>{children}</h2>;
}

function Heading3({ children }: { children?: ReactNode }) {
  return <h3 id={slugifyTag(childrenToString(children))}>{children}</h3>;
}

export function Mana({ cost }: { cost: string }) {
  return <ManaCostGlyphs cost={cost} size="sm" className="align-middle" />;
}

const CALLOUT_TONES = {
  tip: { Icon: Lightbulb, ring: "border-gold/40", icon: "text-gold-strong" },
  note: { Icon: Info, ring: "border-border", icon: "text-primary-bright" },
  warning: { Icon: TriangleAlert, ring: "border-accent/40", icon: "text-accent" },
} as const;

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_TONES;
  title?: string;
  children?: ReactNode;
}) {
  const { Icon, ring, icon } = CALLOUT_TONES[tone] ?? CALLOUT_TONES.note;
  return (
    <aside
      className={cn(
        "my-6 flex gap-3 rounded-frame border bg-surface p-4 text-sm leading-6 text-muted",
        ring,
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", icon)} aria-hidden />
      <div className="flex flex-col gap-1">
        {title ? (
          <span className="font-semibold text-foreground">{title}</span>
        ) : null}
        <div>{children}</div>
      </div>
    </aside>
  );
}

function MdxLink({
  href = "",
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const isInternal = href.startsWith("/") || href.startsWith("#");
  if (isInternal) {
    return <Link href={href}>{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export const mdxComponents = {
  h2: Heading2,
  h3: Heading3,
  a: MdxLink,
  Mana,
  Callout,
};
