import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// OracleText
//
// Renders MTG oracle text with proper typographic treatment:
//   • Text inside (parentheses) → rendered in italics (reminder text)
//   • Each newline-separated paragraph becomes its own block
//   • Activated ability cost lines (contain ":" before any text) get a subtle
//     monospace treatment on the cost half
//
// Usage:
//   <OracleText text="Flying\nWhenever this enters, draw a card. (You draw one card.)" />
// ---------------------------------------------------------------------------

type OracleTextProps = {
  text: string | null | undefined;
  className?: string;
};

export function OracleText({ text, className }: OracleTextProps) {
  if (!text?.trim()) {
    return (
      <span className={cn("italic text-subtle", className)}>
        Rules text appears here.
      </span>
    );
  }

  // Split on newlines to get individual ability paragraphs.
  const paragraphs = text.trim().split(/\n+/);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {paragraphs.map((para, i) => (
        <OracleParagraph key={i} text={para} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single line / paragraph of oracle text.
// Splits the line into runs of plain text and (parenthetical) spans.
// ---------------------------------------------------------------------------

function OracleParagraph({ text }: { text: string }) {
  const segments = parseOracleLine(text);

  return (
    <p className="leading-[1.55]">
      {segments.map((seg, i) =>
        seg.italic ? (
          <em key={i} className="not-italic text-subtle/90 italic">
            {seg.text}
          </em>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Parser — splits a single line into alternating plain/italic segments.
// Everything inside the outermost matched parens is italic.
// Nested parens (rare in MTG) are kept as-is.
// ---------------------------------------------------------------------------

type Segment = { text: string; italic: boolean };

function parseOracleLine(line: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let plainStart = 0;

  while (i < line.length) {
    if (line[i] === "(") {
      // Flush any accumulated plain text.
      if (i > plainStart) {
        segments.push({ text: line.slice(plainStart, i), italic: false });
      }

      // Find the matching closing paren (handle depth for safety).
      let depth = 1;
      let j = i + 1;
      while (j < line.length && depth > 0) {
        if (line[j] === "(") depth++;
        else if (line[j] === ")") depth--;
        j++;
      }

      // j is now one past the closing ")".
      segments.push({ text: line.slice(i, j), italic: true });
      i = j;
      plainStart = i;
    } else {
      i++;
    }
  }

  // Flush remaining plain text.
  if (plainStart < line.length) {
    segments.push({ text: line.slice(plainStart), italic: false });
  }

  return segments.length > 0 ? segments : [{ text: line, italic: false }];
}
