import Link from "next/link";
import { FlaskConical } from "lucide-react";

// ---------------------------------------------------------------------------
// The admin frame-preview banner (TODO 2.1) — persistent above the creator on
// /create and /card/<slug>/edit whenever an admin's preview mode is on
// (?previewFrames=…) or the card being edited is a frame preview. It names
// what the mode unlocks and what a save does, so a preview card never gets
// mistaken for a publishable one. Server-rendered; admin-only by
// construction (the pages build it only after their is_admin check).
// ---------------------------------------------------------------------------

export type FramePreviewBannerProps = {
  /** The normalised ?previewFrames= value; null on an edit page opened
   *  without it (a preview card still gets the banner). */
  param: string | null;
  /** Previewed combos that aren't verified. */
  unverifiedCount: number;
  /** The walk-through's line (which content seeded it), when walking. */
  walkthroughNote?: string | null;
  /** The combo being walked, for the compare / sign-off links. */
  walking?: { template: string; colorKey: string } | null;
  /** Editing a card already flagged as a frame preview. */
  previewCard?: boolean;
  /** The edit page: the frame and colour are locked there (revise mode),
   *  so the mode only keeps the banner and a preview card's rules. */
  editing?: boolean;
  /** This URL without the preview parameters. */
  exitHref: string;
};

export function FramePreviewBanner({
  param,
  unverifiedCount,
  walkthroughNote = null,
  walking = null,
  previewCard = false,
  editing = false,
  exitHref,
}: FramePreviewBannerProps) {
  return (
    <div
      role="status"
      data-testid="frame-preview-banner"
      className="flex flex-col gap-2 rounded-lg border border-sky-400/50 bg-sky-400/10 px-4 py-3 text-sm text-foreground"
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <FlaskConical className="h-4 w-4 shrink-0 text-sky-300" aria-hidden />
        Admin frame preview
        {param ? (
          <code className="rounded bg-elevated/60 px-1.5 py-px font-mono text-[11px] text-muted">
            previewFrames={param}
          </code>
        ) : null}
      </p>
      <p className="leading-6 text-muted">
        {param && editing ? (
          <>
            The frame and colour are fixed while editing; walk a new card
            from Frame verification to preview another combination.
          </>
        ) : param ? (
          <>
            {unverifiedCount > 0
              ? `${unverifiedCount} unverified frame/colour combination${unverifiedCount === 1 ? " is" : "s are"} pickable here — for you only. `
              : "Everything this preview names is already verified. "}
            A save on an unverified combination
            {walking ? ", and every save during a walk-through," : ""} is a{" "}
            <strong className="text-foreground">frame preview</strong>: private,
            flagged, and never in the gallery, sitemap, hubs, trending or feeds.
            AI generation still picks from verified frames only.
          </>
        ) : null}
        {previewCard ? (
          <>
            {param ? " " : ""}
            This card is a <strong className="text-foreground">frame preview</strong>: it
            stays private whatever the Publish step says. It is listed under
            its frame in Frame verification, where it can be deleted.
          </>
        ) : null}
      </p>
      {walkthroughNote ? (
        <p className="leading-6 text-muted" data-testid="frame-walkthrough-note">
          {walkthroughNote}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
        {walking ? (
          <>
            <Link
              href={`/admin/frame-compare?template=${walking.template}&color=${walking.colorKey}`}
              className="underline-offset-2 hover:underline"
            >
              Compare this combination
            </Link>
            <Link
              href={`/admin/frame-compare?template=${walking.template}`}
              className="underline-offset-2 hover:underline"
            >
              Sign off {walking.template}
            </Link>
          </>
        ) : (
          <Link href="/admin/frame-compare" className="underline-offset-2 hover:underline">
            Frame verification
          </Link>
        )}
        {param ? (
          <Link href={exitHref} className="underline-offset-2 hover:underline">
            Exit preview
          </Link>
        ) : null}
      </p>
    </div>
  );
}
