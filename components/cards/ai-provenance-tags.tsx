import { WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { aiProvenanceLabels, type AiProvenance } from "@/lib/cards/ai-provenance";

// ---------------------------------------------------------------------------
// The card page's AI tags (TODO CP1): "Card generated with AI" / "AI helped
// with parts of this card" and "Art generated with AI" — from the stored
// parts (lib/cards/ai-provenance.ts aiProvenanceOf), so a label leaves the
// page the moment the maker replaces what it names. A card made by hand
// renders nothing. Page data only: the card image is never touched.
// ---------------------------------------------------------------------------

export function AiProvenanceTags({ provenance, className }: { provenance: AiProvenance; className?: string }) {
  const labels = aiProvenanceLabels(provenance);
  if (labels.length === 0) return null;
  return (
    <ul aria-label="AI use" className={className ?? "flex flex-wrap gap-2 pt-1"} data-testid="ai-provenance-tags">
      {labels.map((label) => (
        <li key={label}>
          <Badge variant="outline" className="gap-1.5">
            <WandSparkles className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
