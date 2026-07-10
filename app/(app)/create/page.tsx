import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  StartWithHero,
  FORM_SCROLL_TARGET_ID,
} from "@/components/creator/start-with-hero";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getPipOverrides } from "@/lib/pips/queries";
import { getCurrentChallenge } from "@/lib/challenges/queries";
import {
  getCardById,
  getFantasyGameSystem,
  getTemplatesForGameSystem,
  listMyCards,
} from "@/lib/cards/queries";
import { listMySets } from "@/lib/sets/queries";
import { getMyDeckCardWithDeck } from "@/lib/decks/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";
import type { DeckRemixContext } from "@/types/deck";

export const metadata: Metadata = {
  title: "Create",
  description:
    "Forge a new custom trading card with a live preview, art upload, and visibility controls.",
};

const CHALLENGE_TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; backFor?: string; deckCard?: string }>;
}) {
  const {
    tag: tagParam,
    backFor: backForParam,
    deckCard: deckCardParam,
  } = await searchParams;
  const initialTag =
    tagParam && CHALLENGE_TAG_PATTERN.test(tagParam) ? tagParam : null;
  // Re-checked here in addition to the proxy/(app) layout — defense in depth.
  if (!isSupabaseConfigured()) {
    return <NotConfigured />;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/create");
  }

  const [gameSystem, profile] = await Promise.all([
    getFantasyGameSystem(),
    getCurrentProfile(),
  ]);
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];
  const [mySets, myCards] = await Promise.all([listMySets(), listMyCards()]);

  // /create?backFor=<cardId> — building a NEW card that becomes another owned
  // card's back face. Validate the target exists + is the user's before wiring
  // the auto-link flow; otherwise ignore the param.
  const backForCard =
    backForParam && UUID_PATTERN.test(backForParam)
      ? await getCardById(backForParam)
      : null;
  const backFor =
    backForCard && backForCard.owner_id === user.id ? backForCard : null;

  // /create?deckCard=<deckCardId> — remixing a deck entry into a custom
  // proxy. The query proves the user owns the entry's deck; on save the new
  // card links back to the entry and we return to the deck. Ignored when
  // invalid (someone else's deck, deleted entry, malformed id).
  const deckRemixSource =
    deckCardParam && UUID_PATTERN.test(deckCardParam)
      ? await getMyDeckCardWithDeck(deckCardParam)
      : null;
  const deckRemix: DeckRemixContext | null = deckRemixSource
    ? {
        deckCardId: deckRemixSource.entry.id,
        scryfallId: deckRemixSource.entry.scryfall_id,
        deckSlug: deckRemixSource.deck.slug,
        deckTitle: deckRemixSource.deck.title,
        entryName: deckRemixSource.entry.name,
      }
    : null;

  if (!gameSystem) {
    return <SchemaUnseeded />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Creator"
        title={
          backFor
            ? "Forge the back face"
            : deckRemix
              ? `Remix “${deckRemix.entryName}”`
              : "Forge a new card"
        }
        description={
          backFor
            ? `Build the back for “${backFor.title}”. When you save, it links back automatically.`
            : deckRemix
              ? `Make your own version for “${deckRemix.deckTitle}”. The original's stats are pre-filled — change anything. Saving links it into the deck.`
              : "Type on the left, watch the card take shape on the right. Save when you like the result."
        }
        actions={
          <>
<Button asChild variant="ghost">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <StartWithHero />
      </div>

      <div id={FORM_SCROLL_TARGET_ID} className="mt-10 scroll-mt-24">
        <CardCreatorForm
          mode="create"
          userId={user.id}
          ownerUsername={profile?.username ?? null}
          gameSystems={[gameSystem]}
          templates={templates}
          mySets={mySets}
          myCards={myCards}
          backForCardId={backFor?.id ?? null}
          backForSlug={backFor?.slug ?? null}
          deckRemix={deckRemix}
          aiConfigured={isAIConfigured()}
          pipOverrides={await getPipOverrides(user.id)}
          verifiedFrameKeys={await getVerifiedFrameKeys()}
          profileOverrides={await getFrameProfileOverrides()}
          initialTag={initialTag}
          activeChallenge={await getCurrentChallenge()}
          defaultArtistCredit={profile?.display_name || profile?.username || ""}
        />
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Supabase isn&apos;t configured
        </h1>
        <p className="text-sm leading-6 text-muted">
          Set <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
          in your environment to enable the creator.
        </p>
      </SurfaceCard>
    </div>
  );
}

function SchemaUnseeded() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          No game system seeded yet
        </h1>
        <p className="text-sm leading-6 text-muted">
          The <code className="font-mono text-foreground">fantasy</code> game system
          row is missing. Apply{" "}
          <code className="font-mono text-foreground">
            supabase/migrations/0003_card_data_model.sql
          </code>{" "}
          to seed it.
        </p>
      </SurfaceCard>
    </div>
  );
}
