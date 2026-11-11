"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useCreditConfirm } from "@/components/billing/credit-confirm-provider";
import { publishCredits } from "@/components/billing/credits-bus";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { AI_FILL_NO_ANSWER_MESSAGE, AI_PLAN_NO_ANSWER_MESSAGE, failedStepMessage, isAiFailureKind } from "@/lib/ai/failure";
import { uploadCardArtFile } from "@/lib/cards/art-upload-client";
import {
  CARD_ART_NOT_IMAGE_MESSAGE,
  CARD_ART_TOO_LARGE_MESSAGE,
  CARD_ART_TYPE_MESSAGE,
  CARD_ART_UPLOAD_FAILED_MESSAGE,
} from "@/lib/cards/art-upload-limits";
import { trackToolEvent } from "@/lib/tools/track-client";
import { kitCardFields, type KitFace, type KitSettings } from "@/lib/tools/token-kit/model";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// A kit token's picture: the maker's own upload (the creator's staged
// card-art upload — upright, no camera metadata, rate limited, the
// owner's folder) or an AI picture through the creator's OWN fill job
// (`card_fill`, `want: ["art"]` — one credit, confirmed first, refunded by
// the step when it fails), named as the Token Kit's (`tool`: the beta gate
// and the tool's analytics). Never a new AI path.
//
// Both are seen by the Token Kit only here (the upload is the creator's, the
// paint's outcome arrives in the browser), so the browser records them —
// codes, sizes and counts only, never the token's words or the file's name:
//   - `art_uploaded` / `art_upload_failed` (a `reason` code, the file's kB);
//   - `ai_art_done` (the credit spent) / `ai_art_failed` with a `reason`
//     code and whether the credit came back. The jobs route records the
//     picture ASKED for (`ai_art`).
// ---------------------------------------------------------------------------

type KitArtEvent = "art_uploaded" | "art_upload_failed" | "ai_art_done" | "ai_art_failed";

/** Best effort, never in the picture's way (and never able to throw into it). */
function track(event: KitArtEvent, props: Record<string, string | number | boolean>) {
  trackToolEvent("token-kit", event, props);
}

/** Why an upload was refused, from the upload's own sentences. */
function uploadFailureReason(message: string): string {
  if (message === CARD_ART_TOO_LARGE_MESSAGE) return "too_large";
  if (message === CARD_ART_TYPE_MESSAGE || message === CARD_ART_NOT_IMAGE_MESSAGE) return "wrong_type";
  if (message === CARD_ART_UPLOAD_FAILED_MESSAGE) return "upload_failed";
  return "refused";
}

export type KitArt = { artUrl: string; artistCredit: string | null };

type FillStep = {
  key?: string;
  status?: string;
  error?: string;
  failure?: string | null;
  refunded?: number | null;
  refund_pending?: boolean | null;
  /** Set on a done step whose credit was really charged (null for an admin
   *  or with billing off). */
  spend_ref?: string | null;
  fill?: { art_url?: string; artist_credit?: string };
};

export function useKitArt() {
  const confirmSpend = useCreditConfirm();
  const upgrade = useUpgradeModal();
  /** Keys whose picture is being made, and how. */
  const [busy, setBusy] = useState<Record<string, "upload" | "paint">>({});
  const mark = (key: string, what: "upload" | "paint" | null) =>
    setBusy((prev) => {
      const next = { ...prev };
      if (what) next[key] = what;
      else delete next[key];
      return next;
    });

  const upload = useCallback(async (key: string, file: File): Promise<KitArt | null> => {
    mark(key, "upload");
    try {
      const result = await uploadCardArtFile(file);
      const kb = Math.round(file.size / 1024);
      if (!result.ok) {
        track("art_upload_failed", { reason: uploadFailureReason(result.error), kb });
        toast.error(result.error);
        return null;
      }
      track("art_uploaded", { kb });
      return { artUrl: result.publicUrl, artistCredit: null };
    } finally {
      mark(key, null);
    }
  }, []);

  const paint = useCallback(
    async (key: string, face: KitFace, template: FrameTemplate, settings: KitSettings): Promise<KitArt | null> => {
      const ok = await confirmSpend({
        cost: 1,
        title: `Paint ${face.title}?`,
        description: "Paints a picture for this token in the kit's art style. It goes into the kit; nothing is saved as a card.",
      });
      if (!ok) return null;
      mark(key, "paint");
      const startedAt = Date.now();
      const failed = (reason: string, props: Record<string, string | number | boolean> = {}) =>
        track("ai_art_failed", { reason, kind: face.kind, style: settings.artStyle, ms: Date.now() - startedAt, ...props });
      try {
        const fields = kitCardFields(face);
        const planResponse = await fetch("/api/ai/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "card_fill",
            tool: "token-kit",
            want: ["art"],
            locked: {
              title: fields.title,
              card_type: fields.cardType,
              ...(fields.supertype ? { supertype: fields.supertype } : {}),
              ...(fields.subtypes.length ? { subtypes: fields.subtypes } : {}),
              color_identity: fields.colorIdentity,
              ...(fields.rulesText ? { rules_text: fields.rulesText } : {}),
              ...(fields.power ? { power: fields.power } : {}),
              ...(fields.toughness ? { toughness: fields.toughness } : {}),
            },
            style_preset: settings.artStyle,
            // The picture is painted in the shape of the token's window.
            art_frame: template,
            scope: "token-kit",
          }),
        });
        const plan = await planResponse.json().catch(() => null);
        if (!planResponse.ok || !plan?.ok) {
          const outOfCredits = planResponse.status === 402 || plan?.code === "INSUFFICIENT_CREDITS";
          // Nothing was charged: the job was never planned.
          failed(outOfCredits ? "insufficient_credits" : planResponse.status === 429 ? "rate_limited" : "plan_refused", {
            status: planResponse.status,
            refunded: false,
          });
          if (outOfCredits) upgrade.open("credits", "token_kit");
          else toast.error(plan?.error ?? AI_PLAN_NO_ANSWER_MESSAGE);
          return null;
        }
        if (typeof plan.credits === "number") publishCredits(plan.credits - 1);
        const jobId: string = plan.job.id;
        let step: FillStep | undefined;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const response = await fetch(`/api/ai/jobs/${jobId}/step`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.ok) {
            failed(response.status === 429 ? "rate_limited" : "step_refused", { status: response.status });
            toast.error(payload?.error ?? AI_FILL_NO_ANSWER_MESSAGE);
            return null;
          }
          if (typeof payload.credits === "number") publishCredits(payload.credits);
          const steps = (payload.job?.steps ?? []) as FillStep[];
          step = steps.find((candidate) => candidate.key === "fill:0") ?? steps[0];
          if (payload.inFlight || step?.status === "running") {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          break;
        }
        if (!step || step.status !== "done" || !step.fill?.art_url) {
          // The step's own failure kind (lib/ai/failure.ts) and what it says
          // about the credit; a step that never answered has neither.
          if (step?.status === "failed") {
            failed(isAiFailureKind(step.failure) ? step.failure : "step_failed", {
              refunded: Boolean(step.refunded),
              refund_pending: Boolean(step.refund_pending),
            });
          } else {
            failed("no_answer");
          }
          toast.error(step?.status === "failed" ? failedStepMessage(step) : AI_FILL_NO_ANSWER_MESSAGE);
          return null;
        }
        // The credit really charged: none for an admin or with billing off.
        track("ai_art_done", { kind: face.kind, style: settings.artStyle, credits: step.spend_ref ? 1 : 0, ms: Date.now() - startedAt });
        return { artUrl: step.fill.art_url, artistCredit: step.fill.artist_credit ?? null };
      } catch {
        failed("no_connection");
        toast.error(AI_FILL_NO_ANSWER_MESSAGE);
        return null;
      } finally {
        mark(key, null);
      }
    },
    [confirmSpend, upgrade],
  );

  return { busy, upload, paint };
}
