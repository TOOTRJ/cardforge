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
import { isSetsEnabled } from "@/lib/sets/flags";
import { getMyDeckCardWithDeck, listMyDecks } from "@/lib/decks/queries";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getDeckAiSeeds } from "@/lib/ai/generation-jobs";
import type { DeckRemixContext } from "@/types/deck";
import { getCreatorLabMode } from "@/lib/creator/lab";
import { canUseCreatorLab, resolveCreatorLayout } from "@/lib/creator/lab-shared";
import { FlaskConical, Layers3 } from "lucide-react";

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
  searchParams: Promise<{
    tag?: string;
    backFor?: string;
    deckCard?: string;
    remix?: string;
    lab?: string;
  }>;
}) {
  const {
    tag: tagParam,
    backFor: backForParam,
    deckCard: deckCardParam,
    remix: remixParam,
    lab: labParam,
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

  const [gameSystem, profile, labMode] = await Promise.all([
    getFantasyGameSystem(),
    getCurrentProfile(),
    // The admin's switch for the hidden canvas walkthrough (creator lab).
    getCreatorLabMode(),
  ]);
  // The lab is opt-in twice over: the admin switch must allow this viewer
  // AND the URL must ask for it, so nobody lands on the canvas by surprise.
  const labAllowed = canUseCreatorLab(labMode, Boolean(profile?.is_admin));
  const layout = resolveCreatorLayout(labAllowed, labParam);
  const labToggleHref = (() => {
    const params = new URLSearchParams();
    if (tagParam) params.set("tag", tagParam);
    if (backForParam) params.set("backFor", backForParam);
    if (deckCardParam) params.set("deckCard", deckCardParam);
    if (remixParam) params.set("remix", remixParam);
    if (layout === "stepper") params.set("lab", "1");
    const query = params.toString();
    return query ? `/create?${query}` : "/create";
  })();
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];
  const [mySets, myCards, myDecks, entitlements] = await Promise.all([
    // The publish panel's set picker is flag-gated — don't pay the query.
    isSetsEnabled() ? listMySets() : Promise.resolve([]),
    listMyCards(),
    listMyDecks(),
    getEntitlements(),
  ]);
  // Theme/style each deck was last generated with — the AI dialog imports
  // them when a deck is picked (Pro deck-aware generation).
  const deckSeeds = await getDeckAiSeeds(myDecks.map((deck) => deck.id));

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

  // /create?remix=<cardId> — a NEW card prefilled from another card (yours or
  // anyone's public/unlisted one; RLS decides what's readable). The creator
  // opens in remix mode with the structural fields locked; nothing is
  // inserted until Save, when the slug follows the chosen title and
  // parent_card_id links it back.
  const remixParent =
    !backFor && !deckRemix && remixParam && UUID_PATTERN.test(remixParam)
      ? await getCardById(remixParam)
      : null;

  if (!gameSystem) {
    return <SchemaUnseeded />;
  }

  if (remixParam && !remixParent) {
    // A deleted / private / malformed source — say so rather than silently
    // opening a blank creator the user didn't ask for.
    return <RemixSourceMissing />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={remixParent ? "Remix" : "Creator"}
        title={
          backFor
            ? "Forge the back face"
            : deckRemix
              ? `Create a custom proxy of “${deckRemix.entryName}”`
              : remixParent
                ? `Remix “${remixParent.title}”`
                : "Forge a new card"
        }
        description={
          backFor
            ? `Build the back for “${backFor.title}”. When you save, it links back automatically.`
            : deckRemix
              ? `Your version of the real card, for “${deckRemix.deckTitle}”. Everything is pre-filled — change at least one thing to make it yours, then save to link it into the deck.`
              : remixParent
                ? "Your take on this card. The type, frame and colour stay as they are — change the name, art, text or numbers, then save it as a new card of your own."
                : "Type on the left, watch the card take shape on the right. Save when you like the result."
        }
        actions={
          <>
            {labAllowed ? (
              <Button asChild variant="outline">
                <Link href={labToggleHref} data-testid="creator-lab-toggle">
                  {layout === "canvas" ? (
                    <>
                      <Layers3 className="h-4 w-4" aria-hidden /> Back to the steps
                    </>
                  ) : (
                    <>
                      <FlaskConical className="h-4 w-4" aria-hidden /> Try the canvas creator
                    </>
                  )}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="ghost">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
              </Link>
            </Button>
          </>
        }
      />

      {remixParent || layout === "canvas" ? null : (
        <div className="mt-10">
          <StartWithHero />
        </div>
      )}

      <div id={FORM_SCROLL_TARGET_ID} className="mt-10 scroll-mt-24">
        <CardCreatorForm
          mode={remixParent ? "remix" : "create"}
          card={remixParent}
          userId={user.id}
          ownerUsername={profile?.username ?? null}
          gameSystems={[gameSystem]}
          templates={templates}
          mySets={mySets}
          myDecks={myDecks.map((deck) => ({
            id: deck.id,
            title: deck.title,
            format: deck.format,
            slug: deck.slug,
            theme: deckSeeds.get(deck.id)?.theme ?? null,
            style: deckSeeds.get(deck.id)?.style ?? null,
          }))}
          canDesignForDeck={entitlements.effectiveTier === "pro"}
          myCards={myCards}
          backForCardId={backFor?.id ?? null}
          backForSlug={backFor?.slug ?? null}
          deckRemix={deckRemix}
          aiConfigured={isDesignAiConfigured()}
          pipOverrides={await getPipOverrides(user.id)}
          verifiedFrameKeys={await getVerifiedFrameKeys()}
          profileOverrides={await getFrameProfileOverrides()}
          initialTag={initialTag}
          activeChallenge={await getCurrentChallenge()}
          defaultArtistCredit={profile?.display_name || profile?.username || ""}
          layout={layout}
        />
      </div>
    </div>
  );
}

function RemixSourceMissing() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          That card can&apos;t be remixed
        </h1>
        <p className="text-sm leading-6 text-muted">
          It may have been deleted or made private by its owner.
        </p>
        <div className="mt-2 flex justify-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/gallery">Browse the gallery</Link>
          </Button>
          <Button asChild>
            <Link href="/create">Forge a new card</Link>
          </Button>
        </div>
      </SurfaceCard>
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
