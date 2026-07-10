"use client";

import { type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Eye, Pencil } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArtPosition, FrameStyle } from "@/types/card";
import type { listMyCards } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// DashboardCardTile — one tile on the dashboard grid that participates in
// bulk selection. Behavior:
//   - Normal mode:
//       - Hovering (or focusing) the tile reveals Edit / View buttons — the
//         user picks the action instead of guessing what a click does
//       - Plain click on the card body → View (the card's page; matches what
//         touch users get, where there's no hover to reveal the buttons)
//       - Cmd / Ctrl + click → toggles selection without clearing others
//       - Shift + click → range-selects from the last-clicked card to this one
//       - The corner checkbox appears on hover / focus and toggles selection
//   - Select mode (toggled by the section's "Select" button):
//       - Plain click anywhere on the card toggles its checkmark (no navigate)
//       - Checkboxes are always visible, matching the Google Photos / iOS
//         Photos multi-select pattern
// ---------------------------------------------------------------------------

export type DashboardCard = Awaited<ReturnType<typeof listMyCards>>[number];

type Props = {
  profileOverrides?: FrameProfileOverridesMap | null;
  card: DashboardCard;
  isSelected: boolean;
  /** When true, a plain click toggles selection instead of navigating, and
   *  the checkbox is always visible. */
  selectMode: boolean;
  /** A card can appear in more than one section (e.g. a public card is also
   *  a "recent" card). `viewTransitionName` must be unique in the document,
   *  so only the first-rendered instance owns the shared-element transition;
   *  duplicates would abort the transition and spam the console. */
  enableViewTransition?: boolean;
  /** Called for Cmd/Ctrl/Shift-modifier clicks (and plain clicks in select
   *  mode) on the card body, plus any click on the corner checkbox. */
  onToggle: (
    cardId: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
};

export function DashboardCardTile({
  card,
  profileOverrides = null,
  isSelected,
  selectMode,
  enableViewTransition = true,
  onToggle,
}: Props) {
  const router = useRouter();
  const editHref = `/card/${card.slug}/edit`;
  // The id→canonical redirect resolves the owner username server-side, so
  // the tile doesn't need it in its props.
  const viewHref = `/go/card/${card.id}`;

  const handleBodyClick = (event: MouseEvent | KeyboardEvent) => {
    if (
      selectMode ||
      ("metaKey" in event && (event.metaKey || event.ctrlKey || event.shiftKey))
    ) {
      event.preventDefault();
      onToggle(card.id, {
        meta: "metaKey" in event && (event.metaKey || event.ctrlKey),
        shift: "shiftKey" in event && event.shiftKey,
      });
      return;
    }
    // Plain activation outside select mode → View. Touch users have no
    // hover, so the body itself must stay a useful target.
    router.push(viewHref);
  };

  return (
    <div className="group/tile flex flex-col gap-2">
      <div
        className={cn(
          // The selection ring sits on the outer rectangle so the
          // CardHoverEffect tilt still works without distorting it. The
          // ring transitions in/out on selection-state changes.
          "relative rounded-frame transition-[box-shadow] duration-150",
          isSelected
            ? "ring-2 ring-primary-bright ring-offset-2 ring-offset-background"
            : "",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={
            selectMode
              ? isSelected
                ? `Deselect ${card.title}`
                : `Select ${card.title}`
              : `View ${card.title}`
          }
          onClick={handleBodyClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleBodyClick(event);
            }
          }}
          className="group block cursor-pointer rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          style={
            enableViewTransition
              ? { viewTransitionName: `card-${card.id}` }
              : undefined
          }
        >
          <CardHoverEffect>
            <BakedCardThumbnail
              renderedImageUrl={card.rendered_image_url}
              title={card.title}
              previewData={{
                profileOverrides,
                title: card.title,
                cost: card.cost,
                cardType: card.card_type,
                supertype: card.supertype,
                subtypes: card.subtypes,
                rarity: card.rarity,
                colorIdentity: card.color_identity,
                rulesText: card.rules_text,
                flavorText: card.flavor_text,
                power: card.power,
                toughness: card.toughness,
                loyalty: card.loyalty,
                defense: card.defense,
                artistCredit: card.artist_credit,
                artUrl: card.art_url,
                artPosition: card.art_position as ArtPosition,
                frameStyle: card.frame_style as FrameStyle,
                setIconUrl: card.set_icon_url,
                setIconCode: card.set_icon_code,
              }}
            />
          </CardHoverEffect>
        </div>

        {/* Hover action buttons — the user picks Edit or View explicitly.
            Hidden (and click-transparent) at rest; revealed on tile hover or
            keyboard focus. z-30 sits above CardHoverEffect's glare (z-20);
            suppressed entirely in select mode where clicks mean "toggle". */}
        {!selectMode ? (
          <div
            className={cn(
              // The overlay itself never intercepts the pointer — hit
              // testing passes through to CardHoverEffect so the gallery
              // tilt + glare keep tracking while the buttons are up. The
              // scrim fades the card so the actions stand out; only the
              // buttons themselves become clickable, and only once
              // revealed (invisible links must not swallow clicks).
              "pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-frame",
              "bg-background/55",
              "opacity-0 transition-opacity duration-150",
              "group-hover/tile:opacity-100 group-focus-within/tile:opacity-100",
            )}
          >
            <Button
              asChild
              size="sm"
              className="pointer-events-none shadow-lg group-hover/tile:pointer-events-auto group-focus-within/tile:pointer-events-auto"
            >
              <Link href={editHref} aria-label={`Edit ${card.title}`}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="pointer-events-none shadow-lg group-hover/tile:pointer-events-auto group-focus-within/tile:pointer-events-auto"
            >
              <Link href={viewHref} aria-label={`View ${card.title}`}>
                <Eye className="h-3.5 w-3.5" aria-hidden />
                View
              </Link>
            </Button>
          </div>
        ) : null}

        {/* Corner checkbox. z-40 keeps it above the action-button overlay
            (z-30) and CardHoverEffect's glare (z-20). */}
        <button
          type="button"
          onClick={(event) => {
            // Independent of modifiers — checkbox is always a single-toggle.
            event.stopPropagation();
            onToggle(card.id, {
              meta: event.metaKey || event.ctrlKey,
              shift: event.shiftKey,
            });
          }}
          aria-pressed={isSelected}
          aria-label={isSelected ? `Deselect ${card.title}` : `Select ${card.title}`}
          className={cn(
            "absolute right-3 top-3 z-40 flex h-7 w-7 items-center justify-center rounded-md border shadow-md transition-all",
            "focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-bright/60",
            // Always visible when selected or in select mode; otherwise it
            // reveals on hover/focus so the grid stays clean at rest.
            isSelected || selectMode
              ? "opacity-100"
              : "opacity-0 group-hover/tile:opacity-100",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/80 bg-background/80 text-transparent hover:border-border-strong hover:text-foreground",
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{visibilityLabel(card.visibility)}</span>
        <span
          className={cn(
            "transition-opacity",
            selectMode
              ? isSelected
                ? "text-primary-bright opacity-100"
                : "opacity-100"
              : "opacity-0",
          )}
        >
          {selectMode ? (isSelected ? "Selected" : "Click to select") : null}
        </span>
      </div>
    </div>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
