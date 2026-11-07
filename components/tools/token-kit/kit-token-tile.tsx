"use client";

import { memo, useRef, useState } from "react";
import { BookmarkPlus, ImagePlus, Loader2, Map as MapIcon, Minus, MoreHorizontal, Plus, Sparkles, Trash2 } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { KitItem } from "@/lib/tools/token-kit/collect";
import { KIT_MAX_COPIES, kitPreviewData, type KitFrame, type KitItemState, type KitSettings } from "@/lib/tools/token-kit/model";
import { makersLine } from "@/lib/tools/token-kit/workspace";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One kit token: its live CardPreview (the same builder the print route
// reads, so the sheet is the tile), who makes it, whether it is in the kit
// and how many copies, and its picture / save actions. A token the kit
// can't draw (a dungeon, a colour with no verified frame yet) is listed
// with why, never drawn on a frame that isn't verified.
// ---------------------------------------------------------------------------

export type KitTileActions = {
  onChange: (key: string, patch: Partial<KitItemState>) => void;
  onUpload: (key: string, file: File) => void;
  onPaint: (key: string) => void;
  onSave: (key: string) => void;
};

type Props = KitTileActions & {
  item: KitItem;
  state: KitItemState;
  frame: KitFrame;
  settings: KitSettings;
  verifiedKeys: ReadonlySet<string>;
  busy: "upload" | "paint" | "save" | null;
};

function KitTokenTileInner({ item, state, frame, settings, verifiedKeys, busy, onChange, onUpload, onPaint, onSave }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const preview = frame.ok ? kitPreviewData(item.face, settings, state, verifiedKeys) : null;
  const included = state.include && frame.ok;
  const title = item.face.title;
  const setCopies = (next: number) => onChange(item.key, { copies: Math.min(KIT_MAX_COPIES, Math.max(1, next)) });

  return (
    <article
      className={cn("flex min-w-0 flex-col gap-2", !included && frame.ok && "opacity-60")}
      data-testid="kit-token"
      aria-label={title}
    >
      <div className="relative">
        {preview ? (
          <CardPreview {...preview.data} className="w-full" />
        ) : (
          <div className="card-corners flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 border border-dashed border-border bg-surface/50 p-4 text-center">
            <MapIcon className="h-6 w-6 text-gold" aria-hidden />
            <span className="font-display text-sm font-semibold text-foreground">{title}</span>
            <span className="text-xs leading-5 text-muted">
              {frame.ok
                ? null
                : frame.reason === "dungeon"
                  ? "A dungeon is a map with rooms — keep a printed one handy. It isn't drawn here."
                  : "No frame is verified in this colour yet, so it isn't drawn."}
            </span>
          </div>
        )}
        {busy === "paint" || busy === "upload" ? (
          <div className="card-corners absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 text-sm text-foreground backdrop-blur-[2px]">
            <Loader2 className="h-5 w-5 animate-spin text-gold" aria-hidden />
            {busy === "paint" ? "Painting…" : "Uploading…"}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm font-medium text-foreground" title={title}>
          {title}
          {item.face.power && item.face.toughness ? (
            <span className="ml-1.5 text-xs tabular-nums text-subtle">
              {item.face.power}/{item.face.toughness}
            </span>
          ) : null}
        </p>
        {item.makers.length > 0 ? (
          <p className="truncate text-xs text-subtle" title={item.makers.join(", ")}>
            {makersLine(item.makers)}
          </p>
        ) : null}
        {frame.ok && frame.standIn ? (
          <p className="text-[11px] leading-4 text-subtle">
            On the {frame.design === "arch" ? "arch" : "full-art"} design: the kit&apos;s isn&apos;t verified in this colour yet.
          </p>
        ) : null}
      </div>

      {frame.ok ? (
        <div className="flex items-center gap-1.5">
          <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={state.include}
              onChange={(event) => onChange(item.key, { include: event.target.checked })}
              className="h-4 w-4 accent-[var(--color-primary)]"
              aria-label={`Print ${title}`}
            />
            <span className="max-[380px]:sr-only">Print</span>
          </label>
          <span className="ml-auto flex items-center" title={item.why.length ? `Suggested ${item.suggested}: ${item.why.join(", ")}` : undefined}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 w-8 p-0"
              onClick={() => setCopies(state.copies - 1)}
              disabled={!state.include || state.copies <= 1}
              aria-label={`One fewer copy of ${title}`}
            >
              <Minus aria-hidden />
            </Button>
            <span className="w-7 text-center text-sm tabular-nums text-foreground" aria-live="polite" aria-label={`${state.copies} copies of ${title}`}>
              {state.copies}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 w-8 p-0"
              onClick={() => setCopies(state.copies + 1)}
              disabled={!state.include || state.copies >= KIT_MAX_COPIES}
              aria-label={`One more copy of ${title}`}
            >
              <Plus aria-hidden />
            </Button>
          </span>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="ghost" className="h-9 w-9 p-0" aria-label={`More for ${title}`} disabled={busy !== null}>
                <MoreHorizontal aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1.5">
              <div className="flex flex-col">
                <MenuButton
                  icon={ImagePlus}
                  onClick={() => {
                    setMenuOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  {state.artUrl ? "Replace art (upload)" : "Upload art"}
                </MenuButton>
                <MenuButton
                  icon={Sparkles}
                  onClick={() => {
                    setMenuOpen(false);
                    onPaint(item.key);
                  }}
                  hint="1 credit"
                >
                  Paint with AI
                </MenuButton>
                {state.artUrl ? (
                  <MenuButton
                    icon={Trash2}
                    onClick={() => {
                      setMenuOpen(false);
                      onChange(item.key, { artUrl: null, artistCredit: null, artPosition: null });
                    }}
                  >
                    Remove art
                  </MenuButton>
                ) : null}
                <div className="my-1 border-t border-border/60" />
                <MenuButton
                  icon={BookmarkPlus}
                  onClick={() => {
                    setMenuOpen(false);
                    onSave(item.key);
                  }}
                  hint="Uses a card slot"
                >
                  Save to My Cards
                </MenuButton>
              </div>
            </PopoverContent>
          </Popover>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(item.key, file);
            }}
          />
        </div>
      ) : null}
      {busy === "save" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Saving to My Cards…
        </p>
      ) : null}
    </article>
  );
}

function MenuButton({
  icon: Icon,
  onClick,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  onClick: () => void;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <span className="flex-1">{children}</span>
      {hint ? <span className="text-[11px] text-subtle">{hint}</span> : null}
    </button>
  );
}

/** Each tile re-renders only when its own token, state or frame changes. */
export const KitTokenTile = memo(KitTokenTileInner);
