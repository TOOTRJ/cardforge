import Link from "next/link";
import type { ReactNode } from "react";
import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
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
//   <CardRow caption="…"><CardScan … /></CardRow>  printed cards, side by side
//
// h2/h3 are overridden to carry slugified ids so the table of contents (built
// from the same slugifyTag in extractToc) links to real anchors. Links to
// internal paths use next/link; external links open safely in a new tab.
// Tables (GFM, via articleMdxOptions below) sit in a horizontal scroll box.
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

/** `id` is given only by generated headings (GFM's "Footnotes", whose
 *  references point at it); a heading the guide wrote gets its slug. */
function Heading2({ id, children }: { id?: string; children?: ReactNode }) {
  return <h2 id={id ?? slugifyTag(childrenToString(children))}>{children}</h2>;
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

function Callout({
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

/** Scryfall's image host — the only place a printed card's picture may come
 *  from. Never a file in git: the pictures are Wizards of the Coast's. */
const CARD_SCAN_HOST = "https://cards.scryfall.io/";

/**
 * One printed card, whole and unaltered (Scryfall's image guidelines: no
 * crop, no overlay, the artist line and copyright left readable), linked to
 * its Scryfall page and credited to its illustrator.
 */
function CardScan({
  name,
  printing,
  artist,
  src,
  href,
}: {
  name: string;
  /** Set and year as printed, e.g. "Theros, 2013". */
  printing: string;
  artist: string;
  src: string;
  href: string;
}) {
  if (!src.startsWith(CARD_SCAN_HOST)) return null;
  return (
    <figure className="m-0 flex w-36 flex-col gap-2 sm:w-44 group-data-[size=large]:w-40 sm:group-data-[size=large]:w-64">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {/* A remote scan, shown as Scryfall serves it: next/image would
            re-encode Wizards' picture through our optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${name} (${printing}), a printed Magic card`}
          width={488}
          height={680}
          loading="lazy"
          decoding="async"
          className="m-0 block h-auto w-full"
          style={{ borderRadius: "4.75% / 3.5%" }}
        />
      </a>
      <figcaption className="m-0 text-xs leading-5 text-muted">
        <span className="font-semibold text-foreground">{name}</span>
        <br />
        {printing}. Illustrated by {artist}.
      </figcaption>
    </figure>
  );
}

/** A row of printed cards with one line saying what to look at. */
function CardRow({
  caption,
  size,
  children,
}: {
  caption?: string;
  /** "large" for a comparison whose point is a detail of the frame. */
  size?: "large";
  children?: ReactNode;
}) {
  return (
    <div data-size={size} className="group my-3 flex flex-col gap-3">
      <div className="flex flex-wrap justify-center gap-4 sm:gap-6">{children}</div>
      <p className="m-0 text-center text-sm leading-6 text-muted">
        {caption ? `${caption} ` : null}
        <span className="text-xs">
          Card images © Wizards of the Coast, shown via Scryfall.
        </span>
      </p>
    </div>
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

/** A wide table (the color pie's five columns) scrolls inside its own box on
 *  a phone instead of pushing the whole page sideways. Focusable so a
 *  keyboard user can scroll it too (axe: scrollable-region-focusable). */
function Table({ children }: { children?: ReactNode }) {
  return (
    <div
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
    >
      <table>{children}</table>
    </div>
  );
}

export const mdxComponents = {
  h2: Heading2,
  h3: Heading3,
  a: MdxLink,
  table: Table,
  Mana,
  Callout,
  CardRow,
  CardScan,
};

/** Compile options for article bodies. next-mdx-remote parses CommonMark
 *  only, so without remark-gfm every `| a | b |` table rendered as one
 *  paragraph of pipes. GFM also turns on ~~strikethrough~~, task lists,
 *  footnotes and bare-URL autolinks — tests/unit/content/article-mdx.test.tsx
 *  renders every guide with these options to keep that honest. */
export const articleMdxOptions = {
  mdxOptions: { remarkPlugins: [remarkGfm] },
} satisfies MDXRemoteProps["options"];
