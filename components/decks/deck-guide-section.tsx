import { Lightbulb, Sparkles, Swords, Shield, Hand } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { DeckAnalyzeButton, DeckGuideUpgradeButton } from "@/components/decks/deck-analyze-button";
import type { DeckGuide } from "@/lib/decks/guides";

// ---------------------------------------------------------------------------
// DeckGuideSection — the AI "how to play" section on the deck page.
//   Pro viewer + guide exists → the full guide (overview, game plan,
//     mulligan, key cards, combos, weaknesses).
//   Pro owner, no guide     → "Analyze this deck · 1 credit" (AI-generated
//     decks arrive with one; imported/hand-built decks pay once).
//   Non-Pro viewer          → teaser + upgrade CTA (owner decision
//     2026-09-15: Pro viewers only).
// ---------------------------------------------------------------------------

export function DeckGuideSection({
  deckId,
  guide,
  isOwner,
  viewerIsPro,
  aiConfigured,
  hasCards,
}: {
  deckId: string;
  guide: DeckGuide | null;
  isOwner: boolean;
  viewerIsPro: boolean;
  aiConfigured: boolean;
  hasCards: boolean;
}) {
  if (!viewerIsPro) {
    return (
      <section className="mt-12">
        <PageHeader
          eyebrow="How to play"
          title="Game plan & combos"
          description="An AI-written primer for this deck — sequencing, mulligans, the combos in the list and what to play around."
        />
        <SurfaceCard className="mt-6 flex flex-col gap-3 border-gold/30 bg-gold/5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-gold" aria-hidden />
              Deck guides are a Pro feature
              <Badge variant="accent" className="text-[10px]">Pro</Badge>
            </span>
            <p className="text-sm leading-6 text-muted">
              Pro members see how to pilot every deck on PipGlyph — including this one.
            </p>
          </div>
          <DeckGuideUpgradeButton />
        </SurfaceCard>
      </section>
    );
  }

  const ownerAction =
    isOwner && aiConfigured && hasCards ? (
      <DeckAnalyzeButton deckId={deckId} refresh={Boolean(guide)} />
    ) : null;

  if (!guide) {
    return (
      <section className="mt-12">
        <PageHeader
          eyebrow="How to play"
          title="Game plan & combos"
          description={
            isOwner
              ? "Let the AI read the whole list and write the primer: game plan, mulligans, combos and weaknesses."
              : "The owner hasn't analyzed this deck yet."
          }
          actions={ownerAction}
        />
      </section>
    );
  }

  return (
    <section className="mt-12">
      <PageHeader
        eyebrow="How to play"
        title="Game plan & combos"
        description={`AI-written ${guide.source === "generation" ? "with the deck" : "from the current list"} · ${new Date(guide.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
        actions={ownerAction}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-6">
          <SurfaceCard className="flex flex-col gap-4 p-6">
            <p className="text-base leading-7 text-foreground">{guide.overview}</p>
            {guide.game_plan.length > 0 ? (
              <div className="flex flex-col gap-2">
                <GuideLabel icon={Swords}>Game plan</GuideLabel>
                <ol className="flex flex-col gap-2 text-sm leading-6 text-muted">
                  {guide.game_plan.map((step, index) => (
                    <li key={index} className="flex gap-3">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-semibold text-gold">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {guide.mulligan ? (
              <div className="flex flex-col gap-2">
                <GuideLabel icon={Hand}>Mulligan</GuideLabel>
                <p className="text-sm leading-6 text-muted">{guide.mulligan}</p>
              </div>
            ) : null}
            {guide.weaknesses ? (
              <div className="flex flex-col gap-2">
                <GuideLabel icon={Shield}>Weaknesses</GuideLabel>
                <p className="text-sm leading-6 text-muted">{guide.weaknesses}</p>
              </div>
            ) : null}
          </SurfaceCard>
        </div>
        <div className="flex flex-col gap-6">
          <SurfaceCard className="flex flex-col gap-3 p-6">
            <GuideLabel icon={Lightbulb}>Combos &amp; synergies</GuideLabel>
            {guide.combos.length === 0 ? (
              <p className="text-sm leading-6 text-muted">
                No dedicated combos — this list wins on synergy and curve.
              </p>
            ) : (
              <ul className="flex flex-col gap-4">
                {guide.combos.map((combo, index) => (
                  <li key={index} className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {combo.cards.map((card, cardIndex) => (
                        <span key={cardIndex} className="flex items-center gap-1.5">
                          {cardIndex > 0 ? <span className="text-xs text-subtle">+</span> : null}
                          <Badge variant="outline" className="font-medium">{card}</Badge>
                        </span>
                      ))}
                    </span>
                    <p className="text-sm leading-6 text-muted">{combo.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
          {guide.key_cards.length > 0 ? (
            <SurfaceCard className="flex flex-col gap-3 p-6">
              <GuideLabel icon={Sparkles}>Key cards</GuideLabel>
              <div className="flex flex-wrap gap-1.5">
                {guide.key_cards.map((card, index) => (
                  <Badge key={index} variant="outline">{card}</Badge>
                ))}
              </div>
            </SurfaceCard>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function GuideLabel({ icon: Icon, children }: { icon: typeof Swords; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
      <Icon className="h-3.5 w-3.5 text-gold" aria-hidden />
      {children}
    </span>
  );
}
