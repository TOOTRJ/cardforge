import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Layers,
  PenTool,
  Printer,
  Scale,
  Shapes,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { SurfaceCard } from "@/components/ui/surface-card";
import { itemListJsonLd, JsonLd } from "@/components/seo/json-ld";
import { TOOL_COMPARISON, TOOLS, type ToolEntry } from "@/lib/content/tools";

// ---------------------------------------------------------------------------
// /tools — the directory of what PipGlyph lets you do (TODO NV7): one card
// per tool (lib/content/tools.ts — name, one sentence, where it lives) and
// the card maker comparison. It gives the four SEO landing pages a home
// that isn't a footer column called "Guides".
//
// Hard guarantee of static rendering: a future cookie or header read fails
// the build instead of silently losing CDN cacheability.
// ---------------------------------------------------------------------------

export const dynamic = "error";

const TITLE = "Tools — Card Creator, AI Generator, Pip Editor and More";
const DESCRIPTION =
  "Every PipGlyph tool in one place: the custom MTG card creator, the AI card generator, the mana pip editor, the deck builder and print sheets.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools" },
  openGraph: {
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: "/tools",
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
  },
};

const TOOL_ICONS: Record<string, LucideIcon> = {
  "card-creator": PenTool,
  "ai-generator": Wand2,
  "pip-editor": Shapes,
  "deck-builder": Layers,
  "print-sheets": Printer,
  compare: Scale,
};

export default function ToolsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <JsonLd
        data={itemListJsonLd({
          name: "PipGlyph tools",
          items: [...TOOLS, TOOL_COMPARISON].map((tool) => ({
            name: tool.name,
            path: tool.href,
          })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "Tools", path: "/tools" },
        ]}
      />

      <PageHeader
        eyebrow="Tools"
        title="Everything you can make here"
        description="One card creator at the center, and the tools around it: an AI generator, a pip editor, a deck builder and print sheets. Free to start; a few extras come with a plan."
      />

      <ul className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((tool) => (
          <li key={tool.slug} className="flex">
            <ToolCard tool={tool} />
          </li>
        ))}
        <li className="flex">
          <ToolCard tool={TOOL_COMPARISON} tone="quiet" />
        </li>
      </ul>
    </div>
  );
}

function ToolCard({ tool, tone = "default" }: { tool: ToolEntry; tone?: "default" | "quiet" }) {
  const Icon = TOOL_ICONS[tool.slug] ?? PenTool;
  return (
    <SurfaceCard
      className={
        tone === "quiet"
          ? "flex w-full flex-col gap-4 border-dashed bg-surface/40 p-6"
          : "flex w-full flex-col gap-4 p-6 transition-colors hover:border-border-strong"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <IconTile tone={tone === "quiet" ? "purple" : "gold"} size="lg">
          <Icon aria-hidden />
        </IconTile>
        {tool.plan ? (
          // The heading says it to a screen reader ("Print sheets (Pro plan)").
          <Badge variant="gold" aria-hidden>
            {tool.plan}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          {tool.name}
          {tool.plan ? <span className="sr-only"> ({tool.plan} plan)</span> : null}
        </h2>
        <p className="text-sm leading-6 text-muted">{tool.summary}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
        <Link
          href={tool.href}
          className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          {tool.cta}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        {tool.more ? (
          <Link
            href={tool.more.href}
            className="rounded-sm text-sm text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            {tool.more.label}
          </Link>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
