"use client";

import { Ban, Mountain, Sparkles } from "lucide-react";
import { ColourWheel, colourList } from "@/components/tools/pip-forge/pip-visuals";
import { wheelPlace, type ForgedPip } from "@/lib/tools/pip-forge/model";

// ---------------------------------------------------------------------------
// The colour card a pip stands for: its name and creed, values, the new
// keyword and the colour's other mechanics, what it can't do, its basic land
// type and its place on the six-colour wheel (allies and enemies derived
// from its gap — lib/tools/pip-forge/model.ts wheelPlace).
// ---------------------------------------------------------------------------

function Heading({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h4 id={id} className="text-xs font-semibold uppercase tracking-wider text-subtle">
      {children}
    </h4>
  );
}

export function ColourCardView({ pip, previewDisc }: { pip: ForgedPip; previewDisc: string | null }) {
  const { card } = pip;
  const place = wheelPlace(card.sitsBetween);
  const disc = previewDisc ?? pip.disc;
  return (
    <section aria-labelledby={`card-${pip.id}`} className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-gold">The colour</span>
        <h3 id={`card-${pip.id}`} className="font-display text-2xl font-semibold text-foreground">
          {card.name}
        </h3>
        <p className="text-sm italic text-muted">{card.epithet}</p>
      </header>

      <p className="text-sm leading-6 text-foreground">{card.philosophy}</p>

      <div className="flex flex-col gap-2">
        <Heading>Values</Heading>
        <ul className="flex flex-wrap gap-2">
          {card.values.map((value) => (
            <li key={value} className="rounded-full border border-gold/40 bg-gold/[0.06] px-3 py-1 text-xs text-foreground">
              {value}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <Heading>Mechanics</Heading>
        <div className="rounded-xl border border-gold/40 bg-gold/[0.05] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden />
            {card.keyword.name}
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold">New keyword</span>
          </p>
          <p className="mt-1.5 text-sm italic leading-6 text-muted">({card.keyword.reminder})</p>
        </div>
        <ul className="flex flex-col gap-2.5">
          {card.mechanics.map((mechanic) => (
            <li key={mechanic.name} className="text-sm leading-6">
              <span className="font-medium text-foreground">{mechanic.name}.</span>{" "}
              <span className="text-muted">{mechanic.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <Heading>What it can&apos;t do</Heading>
        <ul className="flex flex-col gap-2">
          {card.cannot.map((limit) => (
            <li key={limit} className="flex gap-2 text-sm leading-6 text-muted">
              <Ban className="mt-1 h-3.5 w-3.5 shrink-0 text-ember" aria-hidden />
              <span>{limit}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-elevated/40 px-4 py-3">
        <Mountain className="h-5 w-5 shrink-0 text-gold" aria-hidden />
        <p className="text-sm text-foreground">
          <span className="text-muted">Basic land type:</span> <span className="font-medium">{card.basicLand}</span>
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Heading>On a six-colour wheel</Heading>
        <div className="grid grid-cols-1 items-center gap-5 @lg:grid-cols-[auto_minmax(0,1fr)]">
          <ColourWheel gap={card.sitsBetween} pipSrc={previewDisc ? null : pip.files.pip} glyphUrl={pip.files.glyph} disc={disc} />
          <dl className="flex flex-col gap-3 text-sm leading-6">
            <div>
              <dt className="font-medium text-foreground">
                <span aria-hidden className="mr-2 inline-block h-0.5 w-5 translate-y-[-3px] rounded bg-gold" />
                Allies: {colourList(place.allies)}
              </dt>
              <dd className="text-muted">{card.alliesWhy}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">
                <span aria-hidden className="mr-2 inline-block w-5 translate-y-[-3px] border-t-2 border-dashed border-ember" />
                Enemies: {colourList(place.enemies)}, and across the wheel {colourList([place.opposite])}
              </dt>
              <dd className="text-muted">{card.enemiesWhy}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
