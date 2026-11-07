"use client";

import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { SetSymbol } from "@/components/cards/set-symbol";
import { PRESET_SET_CODES } from "@/components/creator/panels/set-icon-panel";
import { STYLE_PRESETS } from "@/lib/ai/presets";
import {
  KIT_DESIGN_LABELS,
  KIT_DESIGNS,
  KIT_WATERMARK_OPTIONS,
  type KitDesign,
  type KitSettings,
  type KitWatermark,
} from "@/lib/tools/token-kit/model";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The kit's ONE look: every token wears it (lib/tools/token-kit/model.ts).
// ---------------------------------------------------------------------------

const DESIGN_OPTIONS: ChipOption<KitDesign>[] = KIT_DESIGNS.map((design) => ({ value: design, label: KIT_DESIGN_LABELS[design] }));

const ALIGN_OPTIONS: ChipOption<"left" | "center">[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centred" },
];

const selectClass =
  "h-10 w-full rounded-md border border-border bg-background/60 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

function Field({ label, id, children, hint }: { label: string; id?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {id ? (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-subtle">
          {label}
        </label>
      ) : (
        <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}

export function KitSettingsPanel({
  settings,
  onChange,
}: {
  settings: KitSettings;
  onChange: (patch: Partial<KitSettings>) => void;
}) {
  const symbols: Array<{ code: string | null; label: string }> = [
    { code: null, label: "PipGlyph mark" },
    ...PRESET_SET_CODES.map((code) => ({ code, label: code.toUpperCase() })),
  ];
  return (
    <div className="flex flex-col gap-5" data-testid="kit-settings">
      <Field label="Design" hint="Tokens follow their text: a short or tall box only where they have words.">
        <ChipGroup ariaLabel="Design" options={DESIGN_OPTIONS} value={settings.design} onChange={(design) => onChange({ design })} />
      </Field>

      {settings.design === "fullart" ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-elevated/30 px-3 py-2.5 text-sm text-foreground has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            checked={settings.nyx}
            onChange={(event) => onChange({ nyx: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">Nyx starfield on enchantments</span>
            <span className="text-xs leading-5 text-muted">One-colour Enchantment tokens, where the dress is verified.</span>
          </span>
        </label>
      ) : null}

      <Field label="Set symbol">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Set symbol">
          {symbols.map((symbol) => {
            const active = settings.setIconCode === symbol.code;
            return (
              <button
                key={symbol.code ?? "pipglyph"}
                type="button"
                aria-pressed={active}
                aria-label={symbol.label}
                title={symbol.label}
                onClick={() => onChange({ setIconCode: symbol.code })}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md border bg-elevated/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                  active ? "border-primary bg-primary/10" : "border-border hover:border-border-strong",
                )}
              >
                <SetSymbol rarity="common" setCode={symbol.code} iconUrl={null} size={20} namesRarity={false} />
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Watermark" id="kit-watermark" hint="Printed behind a token's rules text; a textless token has none.">
        <select
          id="kit-watermark"
          className={selectClass}
          value={settings.watermark}
          onChange={(event) => onChange({ watermark: event.target.value as KitWatermark })}
        >
          {KIT_WATERMARK_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Rules text">
        <ChipGroup
          ariaLabel="Rules text alignment"
          options={ALIGN_OPTIONS}
          value={settings.rulesAlign}
          onChange={(rulesAlign) => onChange({ rulesAlign })}
        />
      </Field>

      <Field label="AI art style" id="kit-art-style" hint="For pictures you paint with AI — one credit each.">
        <select
          id="kit-art-style"
          className={selectClass}
          value={settings.artStyle}
          onChange={(event) => onChange({ artStyle: event.target.value })}
        >
          {STYLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
