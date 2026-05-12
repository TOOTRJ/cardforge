import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { SetCreatorForm } from "@/components/sets/set-creator-form";
import { SetCardManager } from "@/components/sets/set-card-manager";
import { SetAnalyticsPanel } from "@/components/sets/set-analytics-panel";
import { DeleteSetDialog } from "@/components/sets/delete-set-dialog";
import {
  getMySetBySlug,
  listCardsInSet,
  listMyCardsNotInSet,
} from "@/lib/sets/queries";
import { computeSetAnalytics } from "@/lib/sets/analytics";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type EditSetPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: EditSetPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Edit ${slug.replace(/-/g, " ")}`,
    description: "Edit your custom set.",
  };
}

export default async function EditSetPage({ params }: EditSetPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Supabase isn&apos;t configured
          </h1>
          <p className="text-sm leading-6 text-muted">
            Set the Supabase env vars to enable set editing.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/set/${slug}/edit`)}`);
  }

  const set = await getMySetBySlug(slug);
  if (!set) {
    // Either doesn't exist or isn't owned by the user — RLS-safe 404.
    notFound();
  }

  const [items, candidates] = await Promise.all([
    listCardsInSet(set.id),
    listMyCardsNotInSet(set.id),
  ]);
  const analytics = computeSetAnalytics(items.map((i) => i.card));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Editing set"
        title={set.title}
        description={`Slug: /set/${set.slug}`}
        actions={
          <>
            <Badge
              variant={set.visibility === "public" ? "primary" : "outline"}
            >
              {visibilityLabel(set.visibility)}
            </Badge>
            <Button asChild variant="outline">
              <Link href={`/set/${set.slug}`}>
                <Eye className="h-4 w-4" aria-hidden /> View public page
              </Link>
            </Button>
            <DeleteSetDialog
              setId={set.id}
              setTitle={set.title}
              redirectTo="/sets"
            />
            <Button asChild variant="ghost">
              <Link href="/sets">
                <ArrowLeft className="h-4 w-4" aria-hidden /> All sets
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <SetCreatorForm mode="edit" userId={user.id} set={set} />

        <div className="flex flex-col gap-10">
          <section className="flex flex-col gap-4">
            <header className="flex flex-col gap-1">
              <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
                Analytics
              </h2>
              <p className="text-sm text-muted">
                Live counts across the cards in this set.
              </p>
            </header>
            <SetAnalyticsPanel analytics={analytics} />
          </section>

          <SetCardManager
            setId={set.id}
            setSlug={set.slug}
            items={items}
            candidates={candidates}
          />
        </div>
      </div>
    </div>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
