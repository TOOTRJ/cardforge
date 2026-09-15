import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Megaphone, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { GlyphDivider } from "@/components/ui/glyph-divider";
import { getNewsFeed } from "@/lib/updates/queries";
import { formatReleaseDate, type SiteUpdate } from "@/lib/updates/shared";

export const metadata: Metadata = {
  title: "What's new",
  alternates: { canonical: "/news" },
  description:
    "Every PipGlyph update as it ships — new tools, frames, AI features and fixes — plus a look at what the forge is building next.",
};

// ISR over the cached public feed; admin saves purge it (lib/updates/actions).
export const revalidate = 300;

export default async function NewsPage() {
  const { updates, upcoming } = await getNewsFeed();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <PageHeader
        eyebrow="News"
        title="What's new on PipGlyph"
        description="Fresh from the forge: every update as it ships, and a peek at what we're hammering on next."
      />

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="updates-heading" className="flex flex-col gap-5">
          <h2 id="updates-heading" className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
            <Megaphone className="h-5 w-5 text-gold" aria-hidden />
            Latest updates
          </h2>
          {updates.length === 0 ? (
            <SurfaceCard className="p-6 text-sm text-muted">
              Nothing posted yet — the next update lands here the moment it ships.
            </SurfaceCard>
          ) : (
            updates.map((u) => <UpdateCard key={u.id} update={u} />)
          )}
        </section>

        <aside aria-labelledby="upcoming-heading" className="flex flex-col gap-4">
          <h2 id="upcoming-heading" className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
            <Sparkles className="h-5 w-5 text-primary-bright" aria-hidden />
            Coming soon
          </h2>
          <p className="text-sm leading-6 text-muted">
            The features we&apos;re most excited about, straight from the workbench.
          </p>
          {upcoming.length === 0 ? (
            <SurfaceCard className="p-5 text-sm text-muted">
              The workbench is quiet for a moment — check back soon.
            </SurfaceCard>
          ) : (
            upcoming.map((u) => (
              <SurfaceCard key={u.id} tone="gold" className="flex flex-col gap-2 p-5">
                <Badge variant="gold" className="self-start">
                  <Sparkles className="mr-1 h-3 w-3" aria-hidden />
                  Coming soon
                </Badge>
                <h3 className="font-display text-lg font-semibold text-foreground">{u.title}</h3>
                <p className="text-sm leading-6 text-muted">{u.summary}</p>
                {u.body ? (
                  <p className="whitespace-pre-line text-sm leading-6 text-foreground/90">{u.body}</p>
                ) : null}
              </SurfaceCard>
            ))
          )}
          <GlyphDivider className="my-2" />
          <Button asChild variant="outline" className="self-start">
            <Link href="/create">
              Forge a card
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

function UpdateCard({ update }: { update: SiteUpdate }) {
  return (
    <SurfaceCard className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="gold">New</Badge>
        <time dateTime={update.publish_at} className="text-xs text-subtle">
          {formatReleaseDate(update.publish_at)}
        </time>
      </div>
      <h3 className="font-display text-xl font-semibold text-foreground">{update.title}</h3>
      <p className="text-base leading-7 text-muted">{update.summary}</p>
      {update.body ? (
        <p className="whitespace-pre-line text-sm leading-6 text-foreground/90">{update.body}</p>
      ) : null}
      {update.link_href ? (
        <Link
          href={update.link_href}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-bright hover:underline"
        >
          Try it now
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </SurfaceCard>
  );
}
