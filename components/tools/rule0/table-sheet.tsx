import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ColorPips, type PipColor } from "@/components/cards/color-pip";
import { cn } from "@/lib/utils";
import { GAME_CHANGERS_SOURCE } from "@/lib/tools/rule0/game-changers";
import { BRACKET_RULES_SOURCE, NOT_JUDGED } from "@/lib/tools/rule0/bracket-estimate";
import { customHeadline, type SheetCardLine, type TableSheetFacts } from "@/lib/tools/rule0/sheet";
import { winConditionLines } from "@/lib/validation/table-sheet";
import { DECK_BOARD_LABELS } from "@/types/deck";
import type { QrPath } from "@/lib/qr/qr-path";

// ---------------------------------------------------------------------------
// THE Rule 0 table sheet — one component for every place it is drawn: the
// owner's live preview, a visitor's shared view and the printed page
// (`.table-sheet` in app/globals.css: on paper it is black on white, the
// site's chrome hidden, one page). Plain markup, no state: the editor hands
// it the text as it is typed.
// ---------------------------------------------------------------------------

export type TableSheetDeck = {
  title: string;
  formatLabel: string;
  ownerUsername: string | null;
  /** The owner's chosen bracket (Commander decks only). */
  bracket: { level: number; name: string } | null;
  isCommander: boolean;
  colors: { symbols: PipColor[]; label: string } | null;
};

export type TableSheetText = {
  gamePlan: string | null;
  winConditions: string | null;
  tableNotes: string | null;
};

const SECTION_TITLE = "text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-gold-strong";
const LINK_CLASS =
  "rounded-sm text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

export function TableSheet({
  deck,
  facts,
  text,
  qr,
  editing = false,
  className,
}: {
  deck: TableSheetDeck;
  facts: TableSheetFacts;
  text: TableSheetText;
  /** The deck page's address and its code — null when the deck is private
   *  (nobody else could open it). */
  qr: { url: string; path: QrPath } | null;
  /** The owner's preview: empty fields say where to fill them in. */
  editing?: boolean;
  className?: string;
}) {
  const wins = winConditionLines(text.winConditions);
  const empty = editing ? "Not written yet — fill it in above." : "Not written yet.";
  return (
    <article
      aria-labelledby="table-sheet-title"
      className={cn(
        "table-sheet flex flex-col gap-6 border border-border bg-surface p-5 text-foreground sm:p-8",
        className,
      )}
    >
      {/* The deck at a glance, and the way back to it. */}
      <header className="flex flex-col gap-5 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <p className={SECTION_TITLE}>Rule 0 table sheet</p>
          <h1 id="table-sheet-title" className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {deck.title}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{deck.formatLabel}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">
              {facts.cardCount} card{facts.cardCount === 1 ? "" : "s"}
            </span>
            {deck.colors ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="sr-only">Colors: {deck.colors.label}</span>
                  <ColorPips colors={deck.colors.symbols} size={16} decorative />
                </span>
              </>
            ) : null}
            {deck.ownerUsername ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  by <span className="font-mono text-foreground">@{deck.ownerUsername}</span>
                </span>
              </>
            ) : null}
          </p>
          {facts.commanders.length > 0 ? (
            <p className="text-sm">
              <span className="text-muted">{facts.commanders.length === 1 ? "Commander: " : "Commanders: "}</span>
              {facts.commanders.map((line, index) => (
                <span key={line.id}>
                  {index > 0 ? " & " : null}
                  <Link href={line.href} className={cn(LINK_CLASS, "font-semibold")}>
                    {line.name}
                  </Link>
                  {line.badge !== "imported" ? <span className="text-muted"> ({line.badgeLabel.toLowerCase()})</span> : null}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        {qr ? (
          <figure className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
            <svg
              viewBox={`0 0 ${qr.path.size} ${qr.path.size}`}
              className="table-sheet-qr h-24 w-24 rounded-sm bg-white p-0 text-black"
              role="img"
              aria-label={`QR code to the deck page, ${qr.url}`}
              shapeRendering="crispEdges"
            >
              <rect width={qr.path.size} height={qr.path.size} fill="#fff" />
              <path d={qr.path.d} fill="currentColor" />
            </svg>
            <figcaption className="max-w-[12rem] text-xs text-muted sm:text-right">
              Scan for the full deck
              <span className="block break-all font-mono text-[0.65rem] text-subtle">{qr.url.replace(/^https?:\/\//, "")}</span>
            </figcaption>
          </figure>
        ) : null}
      </header>

      <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
        {deck.isCommander ? <BracketSection deck={deck} facts={facts} /> : null}
        <CustomCardsSection facts={facts} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
        <section aria-labelledby="table-sheet-plan" className="flex flex-col gap-2">
          <h2 id="table-sheet-plan" className={SECTION_TITLE}>
            Game plan
          </h2>
          {text.gamePlan ? (
            <p className="whitespace-pre-line text-sm leading-6">{text.gamePlan}</p>
          ) : (
            <p className="text-sm italic text-subtle">{empty}</p>
          )}
        </section>
        <section aria-labelledby="table-sheet-wins" className="flex flex-col gap-2">
          <h2 id="table-sheet-wins" className={SECTION_TITLE}>
            Win conditions
          </h2>
          {wins.length > 0 ? (
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm leading-6 marker:text-subtle">
              {wins.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
          ) : (
            <p className="text-sm italic text-subtle">{empty}</p>
          )}
        </section>
      </div>

      {text.tableNotes ? (
        <section aria-labelledby="table-sheet-notes" className="flex flex-col gap-2 border-t border-border pt-5">
          <h2 id="table-sheet-notes" className={SECTION_TITLE}>
            Also worth a word
          </h2>
          <p className="whitespace-pre-line text-sm leading-6">{text.tableNotes}</p>
        </section>
      ) : null}

      <footer className="border-t border-border pt-4 text-xs leading-5 text-subtle">
        Made with PipGlyph. Game Changers list as of {GAME_CHANGERS_SOURCE.updated} (
        <a href={GAME_CHANGERS_SOURCE.announcement} className={LINK_CLASS} rel="noopener noreferrer" target="_blank">
          Wizards of the Coast
        </a>
        ); bracket limits from{" "}
        <a href={BRACKET_RULES_SOURCE.url} className={LINK_CLASS} rel="noopener noreferrer" target="_blank">
          Commander Brackets
        </a>
        . A guide for the pre-game talk, not a ruling — the table decides.
      </footer>
    </article>
  );
}

function BracketSection({ deck, facts }: { deck: TableSheetDeck; facts: TableSheetFacts }) {
  const estimate = facts.estimate;
  return (
    <section aria-labelledby="table-sheet-bracket" className="flex flex-col gap-3">
      <h2 id="table-sheet-bracket" className={SECTION_TITLE}>
        Bracket
      </h2>
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 border border-border bg-background/40 p-3">
          <dt className="text-xs text-muted">The owner says</dt>
          <dd className="font-display text-lg font-semibold leading-tight">
            {deck.bracket ? (
              <>
                Bracket {deck.bracket.level}
                <span className="block font-sans text-sm font-normal text-muted">{deck.bracket.name}</span>
              </>
            ) : (
              <span className="font-sans text-sm font-normal italic text-subtle">Not set</span>
            )}
          </dd>
        </div>
        {estimate ? (
          <div className="flex flex-col gap-0.5 border border-border bg-background/40 p-3">
            <dt className="text-xs text-muted">Game Changers check</dt>
            <dd className="font-display text-lg font-semibold leading-tight">
              {estimate.verdict}
              <span className="block font-sans text-sm font-normal text-muted">{estimate.countLabel}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {estimate?.fit === "below" ? (
        <p className="flex gap-2 border border-gold/50 bg-gold/10 p-3 text-sm leading-6">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
          <span>
            <strong className="font-semibold">Talk about this one.</strong> Bracket {deck.bracket?.level} allows{" "}
            {deck.bracket && deck.bracket.level <= 2 ? "no Game Changers" : "up to three Game Changers"}; this deck plays{" "}
            {estimate.gameChangers}.
          </span>
        </p>
      ) : estimate?.fit === "fits" ? (
        <p className="flex gap-2 text-sm leading-6 text-muted">
          <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
          <span>The Game Changers count fits the owner&apos;s bracket. {estimate.reason}</span>
        </p>
      ) : estimate ? (
        <p className="text-sm leading-6 text-muted">{estimate.reason}</p>
      ) : null}
      {facts.gameChangers.length > 0 ? (
        <ul aria-label="Game Changers in this deck" className="flex flex-wrap gap-1.5">
          {facts.gameChangers.map((card) => (
            <li key={card.name} className="border border-border px-2 py-0.5 text-xs">
              {card.name}
              {card.customVersion ? <span className="text-muted"> (custom version)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs leading-5 text-subtle">{NOT_JUDGED}</p>
    </section>
  );
}

function CardLines({ lines, label }: { lines: readonly SheetCardLine[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-1 text-sm leading-6 print:columns-2 print:gap-6">
      {lines.map((line) => (
        <li key={line.id} className="break-inside-avoid">
          {line.quantity > 1 ? <span className="tabular-nums text-muted">{line.quantity}× </span> : null}
          <Link href={line.href} className={LINK_CLASS}>
            {line.name}
          </Link>
          {line.basedOn ? <span className="text-muted"> — {line.basedOn}</span> : null}
          <span className="text-xs text-subtle">
            {" "}
            · {line.badgeLabel}
            {line.board !== "main" ? ` · ${DECK_BOARD_LABELS[line.board]}` : ""}
            {line.maker ? ` · by @${line.maker}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CustomCardsSection({ facts }: { facts: TableSheetFacts }) {
  return (
    <section aria-labelledby="table-sheet-custom" className="flex flex-col gap-3">
      <h2 id="table-sheet-custom" className={SECTION_TITLE}>
        Custom cards and proxies
      </h2>
      <p className={cn("text-sm font-semibold leading-6", facts.customCount > 0 && "text-gold-strong")}>
        {customHeadline(facts)}
      </p>
      {facts.custom.length > 0 ? <CardLines lines={facts.custom} label="Custom cards" /> : null}
      {facts.proxies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted">
            Proxies — PipGlyph prints of the real card, unchanged ({facts.proxyCount})
          </h3>
          <CardLines lines={facts.proxies} label="Proxies" />
        </div>
      ) : null}
      {facts.notFound.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted">Lines that matched no card ({facts.notFoundCount})</h3>
          <CardLines lines={facts.notFound} label="Lines that matched no card" />
        </div>
      ) : null}
      <p className="text-xs leading-5 text-subtle">
        {`${facts.realCount} real card${facts.realCount === 1 ? "" : "s"} besides. The maybeboard isn't counted.`}
      </p>
    </section>
  );
}
