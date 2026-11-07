import { SurfaceCard } from "@/components/ui/surface-card";
import { CustomPipsManager } from "@/components/creator/custom-pips-manager";
import type { PipOverrides } from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// CustomPipsPanel — the custom pips manager on its Tools page
// (/dashboard/tools/pips, owner 2026-11-06: moved from Settings). Same
// manager the creator's dialog uses; the server page passes the user's map
// and names it with its own heading.
// ---------------------------------------------------------------------------

export function CustomPipsPanel({ overrides }: { overrides: PipOverrides }) {
  return (
    <SurfaceCard as="section" aria-label="Your pips" className="flex flex-col gap-4 p-6">
      <CustomPipsManager overrides={overrides} />
      <p className="text-[11px] leading-4 text-subtle">
        Square images work best — they&apos;re cropped to a circle at 256×256.
        PNG, JPEG, or WebP up to 4 MB.
      </p>
    </SurfaceCard>
  );
}
