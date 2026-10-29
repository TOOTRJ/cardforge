import Image from "next/image";
import Link from "next/link";
import { SurfaceCard } from "@/components/ui/surface-card";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { creatorStats, profilePath } from "@/lib/creators/directory";
import type { PublicCreator } from "@/lib/creators/queries";

// ---------------------------------------------------------------------------
// One maker on /creators (TODO NV11): avatar, name, handle, what they've
// published, and a strip of their three newest public cards. The whole card
// is ONE link to the profile — the name's link stretched over the card
// (`after:absolute`), so a keyboard meets each creator once and a screen
// reader hears the name, not every thumbnail.
//
// The strip is a picture of the profile, not a way into each card:
// aria-hidden, and it lets the pointer through to the link (the thumbnails
// are positioned, so they'd paint over the stretched link and swallow the
// click). Each card is its 600 px thumb through BakedCardThumbnail with no
// "2 faces" button (too small to turn — the TwoFacesMark places' rule; it's
// never a control here). The avatar goes through profileMediaSrc() like
// every other avatar.
// ---------------------------------------------------------------------------

const STRIP_SIZES = "(min-width: 1280px) 120px, (min-width: 768px) 16vw, 30vw";

export function CreatorCard({
  creator,
  profileOverrides = null,
}: {
  creator: PublicCreator;
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  const avatarUrl = profileMediaSrc("avatar", creator.avatarUrl, creator.id);
  const initial = (creator.name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();
  const handle = `@${creator.username}`;

  return (
    <SurfaceCard
      as="article"
      className="relative flex h-full w-full min-w-0 flex-col gap-4 p-5 transition-colors hover:border-border-strong"
    >
      <div className="flex min-w-0 items-center gap-3">
        {avatarUrl ? (
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-border/60">
            <Image src={avatarUrl} alt="" fill sizes="48px" className="object-cover" unoptimized />
          </span>
        ) : (
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent font-display text-lg font-semibold text-primary-foreground"
          >
            {initial}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate font-display text-lg font-semibold tracking-tight text-foreground">
            <Link
              href={profilePath(creator.username)}
              className="rounded-sm after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-bright/60"
            >
              {creator.name}
            </Link>
          </h2>
          {creator.name !== handle ? (
            <span className="truncate font-mono text-xs text-muted">{handle}</span>
          ) : null}
        </div>
      </div>

      <p className="flex flex-wrap gap-x-2 gap-y-1 text-sm text-muted">
        {creatorStats(creator).map((part, index) => (
          <span key={part} className="inline-flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden className="text-subtle">
                ·
              </span>
            ) : null}
            {part}
          </span>
        ))}
      </p>

      {creator.strip.length > 0 ? (
        <div aria-hidden className="pointer-events-none mt-auto grid grid-cols-3 gap-2">
          {creator.strip.map((card) => (
            <BakedCardThumbnail
              key={card.id}
              renderedImageUrl={card.rendered_image_url}
              renderedThumbUrl={card.rendered_thumb_url}
              title={card.title}
              alt=""
              sizes={STRIP_SIZES}
              previewData={cardToPreviewData(card, profileOverrides)}
            />
          ))}
        </div>
      ) : null}
    </SurfaceCard>
  );
}
