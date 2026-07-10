import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { DeckCreatorForm } from "@/components/decks/deck-creator-form";
import { DeleteDeckDialog } from "@/components/decks/delete-deck-dialog";
import { ImportDecklistDialog } from "@/components/decks/import-decklist-dialog";
import { getMyDeckBySlug } from "@/lib/decks/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DECK_FORMAT_LABELS } from "@/types/deck";

type EditDeckPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: EditDeckPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Edit ${slug.replace(/-/g, " ")}`,
    description: "Edit your deck.",
  };
}

export default async function EditDeckPage({ params }: EditDeckPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Supabase isn&apos;t configured
          </h1>
          <p className="text-sm leading-6 text-muted">
            Set the Supabase env vars to enable deck editing.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/deck/${slug}/edit`)}`);
  }

  const deck = await getMyDeckBySlug(slug);
  if (!deck) {
    // Either doesn't exist or isn't owned by the user — RLS-safe 404.
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Editing deck"
        title={deck.title}
        description="Update the deck's details, import a decklist, or manage visibility."
        actions={
          <>
            <Badge
              variant={deck.visibility === "public" ? "primary" : "outline"}
            >
              {deck.visibility}
            </Badge>
            <Badge variant="outline">{DECK_FORMAT_LABELS[deck.format]}</Badge>
            <Button asChild variant="ghost">
              <Link href="/dashboard/decks">
                <ArrowLeft className="h-4 w-4" aria-hidden /> All decks
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/deck/${deck.slug}`}>
                <Eye className="h-4 w-4" aria-hidden /> View deck
              </Link>
            </Button>
            <ImportDecklistDialog deckId={deck.id} />
            <DeleteDeckDialog deckId={deck.id} deckTitle={deck.title} />
          </>
        }
      />

      <div className="mt-10">
        <DeckCreatorForm mode="edit" userId={user.id} deck={deck} />
      </div>
    </div>
  );
}
