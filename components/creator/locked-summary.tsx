"use client";

// LockedSummary — the read-only header of an edit / remix. What a saved card
// structurally IS (type line, frame, colour, finish) can't be changed after
// the fact (owner decision 2026-09-16: that is how mismatched cards got
// made), so instead of the Card step the user sees these facts pinned at
// the top of the Identity step.

import { Lock } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { KIND_DEFS, kindFromCard } from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { parseSubtypes } from "@/lib/creator/card-fields";
import type { FormValues } from "@/lib/creator/form-types";
import {
  FRAME_ERA_LABELS,
  FRAME_TEMPLATE_LABELS,
  type FrameTemplate,
  COLOR_IDENTITY_LABELS,
} from "@/types/card";


export function LockedSummary({ mode }: { mode: "edit" | "remix" }) {
  const { control } = useFormContext<FormValues>();
  const cardType = useWatch({ control, name: "card_type" });
  const supertype = useWatch({ control, name: "supertype" }) ?? "";
  const subtypesText = useWatch({ control, name: "subtypes_text" }) ?? "";
  const colors = useWatch({ control, name: "color_identity" }) ?? [];
  const frameStyle = useWatch({ control, name: "frame_style" });

  const template = normalizeFrameTemplate(frameStyle?.template) as FrameTemplate;
  const kind = kindFromCard(cardType, template);
  const subtypes = parseSubtypes(subtypesText);
  const typeLine = [
    supertype.trim(),
    KIND_DEFS[kind].label,
    subtypes.length > 0 ? `— ${subtypes.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const frameLabel = FRAME_TEMPLATE_LABELS[template] ?? template;
  const eraLabel = FRAME_ERA_LABELS[eraForTemplate(template)];
  const colorLabel =
    colors.length === 0
      ? "Colorless"
      : colors.map((c) => (COLOR_IDENTITY_LABELS as Record<string, string>)[c] ?? c).join(" / ");
  const finish = frameStyle?.finish ?? "regular";

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border/60 bg-elevated/30 px-4 py-3"
      data-testid="locked-summary"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-subtle">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {mode === "remix" ? "Kept from the original" : "Fixed for this card"}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Fact label="Type" value={typeLine} />
        <Fact label="Frame" value={`${frameLabel} · ${eraLabel}`} />
        <Fact label="Color" value={colorLabel} />
        <Fact
          label="Finish"
          value={finish.charAt(0).toUpperCase() + finish.slice(1)}
        />
      </dl>
      <p className="text-[11px] leading-5 text-muted">
        {mode === "remix"
          ? "A remix keeps the original's type, frame, colour and finish. Want a different one? Forge a new card instead."
          : "The type, frame, colour and finish are set when a card is created. To change them, forge a new card."}
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-14 shrink-0 text-xs uppercase tracking-wider text-subtle">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-foreground">{value}</dd>
    </div>
  );
}
