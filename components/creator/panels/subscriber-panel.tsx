"use client";

// Subscriber step — the paid perks that touch THIS card (owner decision
// 2026-09-17): the footer mark (removed by default; custom text optional,
// savable as the account default), the watermark choice on the card types
// that otherwise default to the PipGlyph Rose, and a "custom frames" veil.
// Free accounts see the same step as an upsell.

import { useState, useTransition } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Crown, Download, Frame, Save, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PremiumBadge } from "@/components/billing/premium-badge";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { FieldGroup, inputClass } from "@/components/creator/field-group";
import { ComingSoon } from "@/components/creator/coming-soon";
import { WatermarkPicker } from "@/components/creator/panels/watermark-picker";
import { updateExportWatermarkAction } from "@/lib/account/actions";
import type { FormValues } from "@/lib/creator/form-types";

type SubscriberPanelProps = {
  userId: string | null;
  /** Plus / Pro / comp / admin — the same rule downloads use. */
  isPaid: boolean;
  /** True for the card types whose watermark lives here (creature, instant,
   *  sorcery, artifact, enchantment); other types keep it under Advanced. */
  showWatermark: boolean;
};

export function SubscriberPanel({ userId, isPaid, showWatermark }: SubscriberPanelProps) {
  if (!isPaid) return <SubscriberUpsell showWatermark={showWatermark} />;
  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Crown className="h-4 w-4 text-gold-strong" aria-hidden />
          Subscriber perks for this card
        </span>
        <p className="text-xs leading-5 text-muted">
          <Download className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
          The pipglyph.com mark is <strong className="text-foreground">removed from your downloads by default</strong>.
          Anything you set here shows in the live preview and on your downloads
          only — the public card page and the gallery always keep the
          pipglyph.com mark.
        </p>
      </div>

      <FooterMarkField userId={userId} />

      {showWatermark ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-5 text-muted">
            <Stamp className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
            Creatures, instants, sorceries, artifacts and enchantments carry the
            PipGlyph Rose watermark for free accounts. As a subscriber this card
            starts with <strong className="text-foreground">none</strong> — pick one below if you like.
          </p>
          <WatermarkPicker userId={userId} />
        </div>
      ) : null}

      <ComingSoon label="Custom frames">
        <FieldGroup
          label="Custom frames"
          helper="Upload your own frame art and use it on any card."
        >
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/70 bg-elevated/30 px-4 py-6 text-sm text-muted">
            <Frame className="h-5 w-5" aria-hidden />
            Drop a frame PNG here
          </div>
        </FieldGroup>
      </ComingSoon>
    </>
  );
}

function FooterMarkField({ userId }: { userId: string | null }) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<FormValues>();
  const value = useWatch({ control, name: "footer_text" }) ?? "";
  const [pending, startTransition] = useTransition();
  const [savedDefault, setSavedDefault] = useState<string | null>(null);

  const saveAsDefault = () => {
    if (!userId) return;
    const text = value.trim();
    startTransition(async () => {
      const result = await updateExportWatermarkAction({ text });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSavedDefault(text);
      toast.success(
        text
          ? `“${text}” is now the footer mark on your future cards.`
          : "Future cards will have no footer mark.",
      );
    });
  };

  return (
    <FieldGroup
      label="Footer mark"
      helper="Prints bottom-right on your downloads, next to the artist credit. Leave it blank for no footer mark — that's the default."
      error={errors.footer_text?.message}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          {...register("footer_text")}
          maxLength={40}
          placeholder="e.g. yourname.art"
          className={`${inputClass(Boolean(errors.footer_text))} min-w-56 flex-1`}
          autoComplete="off"
          data-testid="footer-text"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={saveAsDefault}
          disabled={pending || savedDefault === value.trim()}
          title="Use this footer mark on every card you create from now on"
        >
          <Save className="h-4 w-4" aria-hidden />
          {pending ? "Saving…" : "Save as my default"}
        </Button>
      </div>
      <span className="text-[11px] leading-5 text-subtle">
        &ldquo;Save as my default&rdquo; changes the account setting that
        prefills new cards; this card keeps whatever is in the box when you save it.
      </span>
    </FieldGroup>
  );
}

function SubscriberUpsell({ showWatermark }: { showWatermark: boolean }) {
  const upgrade = useUpgradeModal();
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gold/40 bg-linear-to-br from-gold/10 to-transparent p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-display text-base font-semibold text-foreground">
          <Crown className="h-4 w-4 text-gold-strong" aria-hidden />
          Subscriber perks
        </span>
        <PremiumBadge />
      </div>
      <ul className="flex flex-col gap-2 text-sm text-muted">
        <li className="flex gap-2">
          <Download className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
          Downloads without the pipglyph.com mark — removed by default, or replaced with your own footer mark.
        </li>
        <li className="flex gap-2">
          <Stamp className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
          {showWatermark
            ? "Choose the watermark on creatures and spells — or none at all. Free cards of these types carry the PipGlyph Rose."
            : "Choose the watermark on creatures and spells — or none at all."}
        </li>
        <li className="flex gap-2">
          <Frame className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
          Custom frames — coming soon.
        </li>
      </ul>
      <p className="text-xs leading-5 text-subtle">
        These perks change your downloads only; the public card page and the
        gallery keep the pipglyph.com mark for everyone.
      </p>
      <Button
        type="button"
        onClick={() => upgrade.open("subscriber_perks")}
        className="w-fit"
      >
        <Crown className="h-4 w-4" aria-hidden />
        Unlock with Plus
      </Button>
    </div>
  );
}
