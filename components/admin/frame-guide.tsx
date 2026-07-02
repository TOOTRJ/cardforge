import { BookOpen } from "lucide-react";

// ---------------------------------------------------------------------------
// FrameGuide — the step-by-step walkthrough for the frame verification
// workflow, shown (collapsed) on both the checklist and the compare view.
// Server component; uses native <details> so it costs no JS.
// ---------------------------------------------------------------------------

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Pick a frame",
    body: "Expand an era below, find the frame + color combination, and hit Compare. The row's thumbnail shows the real printed card that combination is tested against.",
  },
  {
    title: "Pick the test card (optional)",
    body: "In the compare view, \"Change reference card\" lets you search Scryfall and pin the exact printing our render should recreate. \"Revert to default\" restores the researched pick.",
  },
  {
    title: "Compare",
    body: "Overlay slides the real scan over our render (drag the opacity slider). Side-by-side shows both cards. Difference is the precision tool: pixels that match go dark, misalignment glows bright.",
  },
  {
    title: "Edit the layout",
    body: "Turn on \"Edit layout\", then click any element on the card (title bar, rules box, P/T plate…) or pick it from the chips. Nudge with the arrow keys (0.1% per press, hold Shift for 0.5%), resize with [ ] and { }, or type exact numbers. The card updates live — keep Difference mode on and nudge until the glow goes dark.",
  },
  {
    title: "Save & check",
    body: "Save makes the layout live everywhere immediately (no deploy). \"Score alignment\" gives a number per element — run it before and after your edit; the number should drop. Fonts and art always differ, so compare scores against each other, never against zero.",
  },
  {
    title: "Publish the frame",
    body: "When the frame renders near-perfectly, tick \"Frame renders near-perfectly — publish to all users\". For frames that aren't live yet (Saga, Adventure, Snow…), that checkbox is what releases them to the card creator for that color.",
  },
];

export function FrameGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-border/50 bg-elevated/40"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-4 w-4 text-primary-bright" aria-hidden />
        How to test, compare, edit &amp; publish a frame — step by step
        <span className="ml-auto text-xs text-subtle group-open:hidden">
          show
        </span>
        <span className="ml-auto hidden text-xs text-subtle group-open:inline">
          hide
        </span>
      </summary>
      <ol className="flex flex-col gap-3 border-t border-border/40 px-4 py-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-[10px] font-semibold text-foreground"
            >
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-foreground">
                {step.title}
              </span>
              <span className="text-xs leading-5 text-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="border-t border-border/40 px-4 py-3 text-[11px] leading-5 text-subtle">
        <span className="font-semibold uppercase tracking-wider">
          What saving a layout affects:
        </span>{" "}
        live previews, card detail pages, downloads (PNG/PDF), social images,
        and every NEW save are updated <em>instantly</em>. Gallery thumbnails
        of already-created cards keep their old baked image until the rebake
        sweep runs (saving tells you how many were marked stale). Card content
        — text, art, stats — is never touched; only where the frame draws it.
        Layout edits apply per frame template, to everyone&apos;s cards using
        that frame.
      </div>
    </details>
  );
}
