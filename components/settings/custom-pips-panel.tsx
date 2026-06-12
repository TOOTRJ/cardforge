import { SurfaceCard } from "@/components/ui/surface-card";
import { CustomPipsManager } from "@/components/creator/custom-pips-manager";
import type { PipOverrides } from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// CustomPipsPanel — the settings-page surface for managing pip overrides.
// Same manager the creator dialog uses; server page passes the user's map.
// ---------------------------------------------------------------------------

export function CustomPipsPanel({ overrides }: { overrides: PipOverrides }) {
  return (
    <SurfaceCard as="section" className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
          Custom pips
        </h2>
        <p className="text-xs leading-5 text-muted">
          Replace the standard mana symbols with your own icons. They apply to
          every card you own — live previews, gallery thumbnails, and exports —
          while costs and rules keep working exactly the same.
        </p>
      </header>
      <CustomPipsManager overrides={overrides} />
      <p className="text-[11px] leading-4 text-subtle">
        Square images work best — they&apos;re cropped to a circle at 256×256.
        PNG, JPEG, or WebP up to 4 MB.
      </p>
    </SurfaceCard>
  );
}
