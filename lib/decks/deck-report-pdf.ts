import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DeckAnalytics } from "@/lib/decks/analytics";
import type { DeckGuideContent } from "@/lib/ai/deck-guide";
import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// Deck report PDF — the "deck.pdf" inside a Pro ZIP export: the deck's
// identity (title, format, type, bracket), its stats, the decklist by
// board, and — when the deck has one — the AI guide: how to play, mulligan
// advice, combos, weaknesses, key cards. Pure (no I/O) so it unit-tests.
// ---------------------------------------------------------------------------

type DeckReportEntry = {
  name: string;
  quantity: number;
  board: DeckBoard;
  type_line: string | null;
  mana_cost: string | null;
  /** The custom proxy's title, when the entry is remixed. */
  proxyTitle?: string | null;
};

export type DeckReportInput = {
  title: string;
  description: string | null;
  formatLabel: string;
  deckTypeLabel: string | null;
  bracketLabel: string | null;
  ownerName: string | null;
  url: string | null;
  analytics: DeckAnalytics;
  entries: DeckReportEntry[];
  guide: DeckGuideContent | null;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BODY = 10.5;
const LINE = 15;
const INK = rgb(0.12, 0.11, 0.1);
const MUTED = rgb(0.42, 0.4, 0.38);
const RULE = rgb(0.78, 0.7, 0.5);

const BOARD_ORDER: DeckBoard[] = ["commander", "companion", "main", "side", "maybe"];
const BOARD_LABEL: Record<DeckBoard, string> = {
  commander: "Commander",
  companion: "Companion",
  main: "Main deck",
  side: "Sideboard",
  maybe: "Maybeboard",
};

/** Helvetica only knows WinAnsi; anything outside it would throw on draw. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‐-‒]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…™]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = pdfSafe(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }
  gap(px = LINE * 0.6) {
    this.y -= px;
  }
  heading(text: string, size = 15) {
    this.ensure(size * 2.4);
    this.gap(LINE * 0.5);
    this.page.drawText(pdfSafe(text), { x: MARGIN, y: this.y - size, size, font: this.bold, color: INK });
    this.y -= size + 6;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.8, color: RULE });
    this.y -= LINE * 0.8;
  }
  label(text: string) {
    this.ensure(LINE * 1.6);
    this.gap(LINE * 0.3);
    this.page.drawText(pdfSafe(text).toUpperCase(), { x: MARGIN, y: this.y - 8, size: 8, font: this.bold, color: MUTED });
    this.y -= LINE;
  }
  paragraph(text: string, opts: { size?: number; color?: ReturnType<typeof rgb>; indent?: number; bullet?: string } = {}) {
    const size = opts.size ?? BODY;
    const indent = opts.indent ?? 0;
    const width = PAGE_W - MARGIN * 2 - indent;
    const lines = wrap(this.regular, text, size, width);
    lines.forEach((line, index) => {
      this.ensure(LINE);
      if (index === 0 && opts.bullet) {
        this.page.drawText(opts.bullet, { x: MARGIN + indent - 12, y: this.y - size, size, font: this.bold, color: opts.color ?? INK });
      }
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font: this.regular, color: opts.color ?? INK });
      this.y -= LINE;
    });
  }
  columns(rows: Array<[string, string]>, colWidth = 150) {
    for (const [key, value] of rows) {
      this.ensure(LINE);
      this.page.drawText(pdfSafe(key), { x: MARGIN, y: this.y - BODY, size: BODY, font: this.bold, color: MUTED });
      this.page.drawText(pdfSafe(value), { x: MARGIN + colWidth, y: this.y - BODY, size: BODY, font: this.regular, color: INK });
      this.y -= LINE;
    }
  }
}

function curveText(curve: number[]): string {
  return curve.map((count, index) => `${index === 7 ? "7+" : index}: ${count}`).join("   ");
}

export async function buildDeckReportPdf(input: DeckReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.title} — deck report`);
  doc.setAuthor("PipGlyph");
  doc.setSubject("Custom MTG-style deck — fan-made, not affiliated with Wizards of the Coast.");
  doc.setCreator("PipGlyph (pipglyph.com)");
  doc.setProducer("pdf-lib");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);

  // Title block.
  w.page.drawText(pdfSafe(input.title), { x: MARGIN, y: w.y - 24, size: 24, font: bold, color: INK });
  w.y -= 34;
  const meta = [input.formatLabel, input.deckTypeLabel, input.bracketLabel, input.ownerName ? `by ${input.ownerName}` : null]
    .filter(Boolean)
    .join("  ·  ");
  w.page.drawText(pdfSafe(meta), { x: MARGIN, y: w.y - BODY, size: BODY, font: regular, color: MUTED });
  w.y -= LINE;
  if (input.url) {
    w.page.drawText(pdfSafe(input.url), { x: MARGIN, y: w.y - 9, size: 9, font: regular, color: MUTED });
    w.y -= LINE;
  }
  if (input.description) {
    w.gap();
    w.paragraph(input.description);
  }

  // Stats.
  const a = input.analytics;
  w.heading("Deck stats");
  w.columns([
    ["Cards", `${a.total} (${a.lands} lands, ${a.total - a.lands} spells)`],
    ["Average mana value", a.averageManaValue === null ? "n/a" : a.averageManaValue.toFixed(2)],
    ["Mana curve", curveText(a.curve)],
    ["Colors", (["W", "U", "B", "R", "G", "C"] as const).map((c) => `${c} ${a.byColor[c]}`).join("   ")],
    ["Types", Object.entries(a.byType).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join("   ") || "—"],
    ["Custom proxies", `${a.remixed} of ${a.total}`],
  ]);

  // Guide.
  if (input.guide) {
    const g = input.guide;
    w.heading("How to play");
    w.paragraph(g.overview);
    if (g.game_plan.length > 0) {
      w.label("Game plan");
      g.game_plan.forEach((step, index) => w.paragraph(step, { indent: 16, bullet: `${index + 1}.` }));
    }
    if (g.mulligan) {
      w.label("Mulligan");
      w.paragraph(g.mulligan);
    }
    if (g.key_cards.length > 0) {
      w.label("Key cards");
      w.paragraph(g.key_cards.join(", "));
    }
    w.heading("Combos & synergies");
    if (g.combos.length === 0) {
      w.paragraph("No dedicated combos — this list wins on synergy and curve.", { color: MUTED });
    }
    for (const combo of g.combos) {
      w.label(combo.cards.join(" + "));
      w.paragraph(combo.description);
    }
    if (g.weaknesses) {
      w.heading("Weaknesses");
      w.paragraph(g.weaknesses);
    }
  }

  // Decklist.
  w.heading("Decklist");
  for (const board of BOARD_ORDER) {
    const rows = input.entries.filter((e) => e.board === board);
    if (rows.length === 0) continue;
    w.label(`${BOARD_LABEL[board]} · ${rows.reduce((n, e) => n + e.quantity, 0)}`);
    for (const entry of rows) {
      const name = entry.proxyTitle?.trim() ? `${entry.name} (as ${entry.proxyTitle.trim()})` : entry.name;
      const detail = [entry.mana_cost, entry.type_line].filter(Boolean).join("  ");
      w.ensure(LINE);
      w.page.drawText(pdfSafe(`${entry.quantity}x`), { x: MARGIN, y: w.y - BODY, size: BODY, font: bold, color: MUTED });
      w.page.drawText(pdfSafe(name), { x: MARGIN + 28, y: w.y - BODY, size: BODY, font: regular, color: INK });
      if (detail) {
        const dw = regular.widthOfTextAtSize(pdfSafe(detail), 8.5);
        w.page.drawText(pdfSafe(detail), { x: PAGE_W - MARGIN - dw, y: w.y - BODY, size: 8.5, font: regular, color: MUTED });
      }
      w.y -= LINE;
    }
  }

  // Footer on every page.
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const text = `PipGlyph deck report · ${input.title} · page ${index + 1} of ${pages.length}`;
    page.drawText(pdfSafe(text), { x: MARGIN, y: MARGIN / 2, size: 8, font: regular, color: MUTED });
  });

  return doc.save();
}
