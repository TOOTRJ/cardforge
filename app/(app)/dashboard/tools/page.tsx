import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  FlaskConical,
  GalleryVerticalEnd,
  Layers,
  PenTool,
  Printer,
  Shapes,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ToolCard } from "@/components/tools/tool-card";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getViewerTools } from "@/lib/tools/queries";

// ---------------------------------------------------------------------------
// /dashboard/tools — the signed-in Tools hub (owner request 2026-11-06):
// the tools every account has, the beta tools the viewer may open, and the
// ones coming next with "Notify me". Who sees what is lib/tools/access.ts;
// the public directory of what PipGlyph does stays /tools (static, SEO).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Tools",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type CoreTool = { name: string; summary: string; href: string; cta: string; icon: LucideIcon };

const CORE_TOOLS: readonly CoreTool[] = [
  {
    name: "Card creator",
    summary: "Every frame, your art, precise pips and rules text.",
    href: "/create",
    cta: "Create a card",
    icon: PenTool,
  },
  {
    name: "AI card generator",
    summary: "Describe a card, get its text and art, then refine it.",
    href: "/create",
    cta: "Open the creator",
    icon: Wand2,
  },
  {
    name: "Custom pips",
    summary: "Swap the six standard mana symbols for your own art.",
    href: "/settings",
    cta: "Manage in Settings",
    icon: Shapes,
  },
  {
    name: "Deck builder",
    summary: "Mix real cards with your own, with charts and a sample hand.",
    href: "/dashboard/decks",
    cta: "My decks",
    icon: Layers,
  },
  {
    name: "Print sheets",
    summary: "Pick cards and download print-ready sheets or PNGs.",
    href: "/dashboard/cards",
    cta: "My cards",
    icon: Printer,
  },
  {
    name: "Card library",
    summary: "Every card you've made, with search, sorting and bulk actions.",
    href: "/dashboard/cards",
    cta: "Open library",
    icon: GalleryVerticalEnd,
  },
];

export default async function ToolsHubPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/tools")}`);
  const isAdmin = Boolean(profile.is_admin);
  const tools = await getViewerTools();

  const open = tools.filter((entry) => entry.allowed);
  const upcoming = tools.filter((entry) => !entry.allowed);

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Workshop"
        title="Tools"
        description="Everything you can make on PipGlyph, and what's being built next. New tools open to testers first."
      />

      {open.length > 0 ? (
        <section aria-labelledby="tools-yours" className="mt-10">
          <SectionTitle id="tools-yours" title="Your new tools" note="Early access — your feedback shapes them." />
          <ul className="mt-5 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {open.map((entry) => (
              <li key={entry.tool.slug} className="flex">
                <ToolCard entry={entry} isAdmin={isAdmin} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="tools-core" className="mt-10">
        <SectionTitle id="tools-core" title="Everyday tools" note="On every account." />
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CORE_TOOLS.map((tool) => (
            <li key={tool.name} className="flex">
              <CoreToolLink tool={tool} />
            </li>
          ))}
        </ul>
      </section>

      {upcoming.length > 0 ? (
        <section aria-labelledby="tools-next" className="mt-12">
          <SectionTitle
            id="tools-next"
            title="Coming soon"
            note="Press Notify me and you'll hear first — testers are picked from that list."
          />
          <ul className="mt-5 grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
            {upcoming.map((entry) => (
              <li key={entry.tool.slug} className="flex">
                <ToolCard entry={entry} isAdmin={isAdmin} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SurfaceCard className="mt-12 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary-bright" aria-hidden />
          <p className="text-sm leading-6 text-muted">
            <span className="font-medium text-foreground">Have an idea for a tool?</span>{" "}
            Tell us what
            you&rsquo;d use — the next ones come from what players ask for.
          </p>
        </div>
        <Link
          href="/feedback"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-primary-bright hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          Send feedback
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </SurfaceCard>
    </DashboardShell>
  );
}

function SectionTitle({ id, title, note }: { id: string; title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-3">
      <h2 id={id} className="font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="text-sm text-subtle">{note}</p>
    </div>
  );
}

function CoreToolLink({ tool }: { tool: CoreTool }) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.href}
      className="group flex w-full items-start gap-4 rounded-card border border-border/70 bg-surface/60 p-4 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/5 text-gold-strong">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-medium text-foreground">{tool.name}</span>
        <span className="text-sm leading-5 text-muted">{tool.summary}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary-bright">
          {tool.cta}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </span>
    </Link>
  );
}
