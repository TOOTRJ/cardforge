import { cn } from "@/lib/utils";

// A press-kit asset tile: preview on a controlled background + download
// links. Server component; previews are plain <img> tags pointing at the
// static files in public/brand (no next/image — SVGs and exact-pixel
// assets should be served untouched).

type BrandAssetCardProps = {
  title: string;
  note?: string;
  previewSrc: string;
  previewBg?: "dark" | "light";
  /** Rendered height of the preview image in px. */
  previewSize?: number;
  downloads: { label: string; href: string }[];
};

export function BrandAssetCard({
  title,
  note,
  previewSrc,
  previewBg = "dark",
  previewSize = 72,
  downloads,
}: BrandAssetCardProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface/80">
      <div
        className={cn(
          "flex items-center justify-center px-4 py-6",
          previewBg === "light"
            ? "border-b border-border bg-[#fafafa]"
            : "border-b border-border bg-background",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewSrc}
          alt={`${title} preview`}
          style={{ height: previewSize, width: "auto" }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="font-display text-sm font-semibold text-foreground">
          {title}
        </h3>
        {note ? <p className="text-xs leading-5 text-muted">{note}</p> : null}
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-2">
          {downloads.map((d) => (
            <a
              key={d.href}
              href={d.href}
              download
              className="text-xs font-medium text-primary-bright underline-offset-2 hover:underline"
            >
              {d.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
