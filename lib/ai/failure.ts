import { isSafetyBlockError } from "@/lib/ai/art-prompt-safety";

// ---------------------------------------------------------------------------
// What a user is told when an AI generation fails — ONE sentence per kind of
// failure, never the provider's own text (2026-10-28).
//
// Before this, a failed picture said "Image generation failed: <whatever
// the gateway answered>", a failed design "AI card design failed: <SDK
// message>", a storage hiccup the storage error, and a provider credential
// or quota problem told the user to "check the AI keys on the server". The
// raw detail now goes to the server log ([ai:image] / [ai:design] /
// [ai:step]), keyed by the job, and the user gets a plain sentence: what
// happened, what to try next. The CREDIT sentence is separate
// (`creditOutcome`) so it is always true: a plan-time failure never reserved
// anything; a failed step says what its own refund returned.
//
// Pure and client-safe: the creator imports the copy and the credit sentence.
// ---------------------------------------------------------------------------

export const AI_FAILURE_KINDS = [
  /** The design model's answer could not be read twice. */
  "design_unreadable",
  /** The design model is rate-limited or overloaded. */
  "design_busy",
  /** The design call failed for another reason (network, provider error). */
  "design_failed",
  /** AI is not usable on this deployment (credentials, quota). */
  "ai_unavailable",
  /** The design came back as a card type with no published frame yet. */
  "type_unavailable",
  /** The image provider's safety filter refused every prompt we tried. */
  "art_blocked",
  /** The picture took too long (a quiet refusal looks the same). */
  "art_timeout",
  /** The image provider is rate-limited or overloaded. */
  "art_busy",
  /** The image provider failed for another reason. */
  "art_failed",
  /** The picture was made but could not be stored. */
  "art_store",
  /** The card row could not be saved (validation, a gate). */
  "save_failed",
  /** Anything unexpected inside a step. */
  "step_failed",
] as const;

export type AiFailureKind = (typeof AI_FAILURE_KINDS)[number];

export function isAiFailureKind(value: unknown): value is AiFailureKind {
  return typeof value === "string" && (AI_FAILURE_KINDS as readonly string[]).includes(value);
}

/** What happened and what to try next — no credit words (see creditOutcome). */
export const AI_FAILURE_COPY: Record<AiFailureKind, string> = {
  design_unreadable: "The AI's answer came back in a shape we couldn't use. Try again.",
  design_busy: "The AI service is busy right now. Wait a minute, then try again.",
  design_failed: "The AI couldn't write this card. Try again, or add a theme to steer it.",
  ai_unavailable: "AI generation isn't available right now. Please try again later.",
  type_unavailable:
    "The AI picked a card type that can't be made here yet. Try again, or choose a card type in the options.",
  art_blocked:
    "The image service's safety filter declined this artwork. Try again — each try rewords the art prompt — or change the theme.",
  art_timeout: "The artwork took too long to paint. Try again — each try rewords the art prompt.",
  art_busy: "The image service is busy right now. Wait a minute, then try again.",
  art_failed: "The artwork couldn't be painted. Try again.",
  art_store: "The artwork was painted but couldn't be saved. Try again.",
  save_failed: "The card couldn't be saved. Try again.",
  step_failed: "Something went wrong while making this card. Try again.",
};

/**
 * The credit half of a failure message. `refunded` is what the failed
 * attempt returned (a job step records it); null/0 means nothing was taken
 * (a plan-time failure, an admin, billing off).
 */
export function creditOutcome(refunded: number | null | undefined, refundPending?: boolean | null): string {
  if (refundPending) {
    return "The credit it took comes back to you automatically within the hour.";
  }
  if (refunded && refunded > 0) {
    return refunded === 1 ? "Your credit was returned." : `Your ${refunded} credits were returned.`;
  }
  return "No credits were used.";
}

/** The full sentence a user sees for a failure. */
export function aiFailureMessage(
  kind: AiFailureKind,
  refunded?: number | null,
  refundPending?: boolean | null,
): string {
  return `${AI_FAILURE_COPY[kind]} ${creditOutcome(refunded, refundPending)}`;
}

/** What a FAILED job step tells its user: its kind's sentence (an older
 *  step, or a plan-limit step, carries its own `error`) and the truth about
 *  its credit. */
export function failedStepMessage(step: {
  error?: string | null;
  failure?: unknown;
  refunded?: number | null;
  refund_pending?: boolean | null;
}): string {
  // A save refusal carries the save's own words (our copy: "That frame
  // isn't available in red yet — …"), which say more than the kind's.
  const own = step.error?.trim();
  const what =
    isAiFailureKind(step.failure) && !(step.failure === "save_failed" && own)
      ? AI_FAILURE_COPY[step.failure]
      : own || AI_FAILURE_COPY.step_failed;
  return `${what} ${creditOutcome(step.refunded, step.refund_pending)}`;
}

/** The provider-error buckets an image or text call falls into. */
export type ProviderErrorBucket = "blocked" | "timeout" | "busy" | "unavailable" | "failed";

/** Sort a raw provider / SDK error message into a bucket. Never shown. */
export function classifyProviderError(detail: string): ProviderErrorBucket {
  const lower = detail.toLowerCase();
  if (isSafetyBlockError(detail)) return "blocked";
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) return "timeout";
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many") ||
    lower.includes("overloaded") ||
    lower.includes("capacity") ||
    lower.includes("503")
  ) {
    return "busy";
  }
  if (
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("insufficient") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("api key") ||
    lower.includes("not configured") ||
    lower.includes("isn't configured")
  ) {
    return "unavailable";
  }
  return "failed";
}

/** The image failure kind for a provider bucket. */
export function imageFailureKind(bucket: ProviderErrorBucket): AiFailureKind {
  switch (bucket) {
    case "blocked":
      return "art_blocked";
    case "timeout":
      return "art_timeout";
    case "busy":
      return "art_busy";
    case "unavailable":
      return "ai_unavailable";
    default:
      return "art_failed";
  }
}

/** The design failure kind for a provider bucket. */
export function designFailureKind(bucket: ProviderErrorBucket): AiFailureKind {
  switch (bucket) {
    case "busy":
    case "timeout":
      return "design_busy";
    case "unavailable":
      return "ai_unavailable";
    default:
      return "design_failed";
  }
}

/** The answer never arrived (a dropped connection, a function the platform
 *  stopped). A charge that has no finished result is returned by the
 *  per-user sweep at the user's next AI action, or the hourly reconcile —
 *  never twice (lib/billing/credit-reconcile.ts). */
export const AI_NO_ANSWER_MESSAGE =
  "We lost the answer from the AI service. If a credit was taken for it, it comes back to you automatically within the hour. Try again.";

/** The per-field fill's version: a finished result is also offered back on
 *  this page (app/api/ai/card-fill). */
export const AI_FILL_NO_ANSWER_MESSAGE =
  "We lost the connection while your card was being made. If it finishes, it's offered on this page next time you open it; if it doesn't, any credit it took comes back automatically within the hour.";

/** The PLAN's answer was lost — nothing is reserved at plan time. */
export const AI_PLAN_NO_ANSWER_MESSAGE =
  "We lost the answer from the AI service. No credits were used. Try again.";

/**
 * The retry confirm's credit line for a set of FAILED steps, from their own
 * records (the deck runner; 2026-10-28 review of #632 — it said "The failed
 * attempt was refunded" whatever had happened): a refund still on its way,
 * a credit returned, or none taken. Retrying always reserves again.
 */
export function retryCreditNote(
  failed: ReadonlyArray<{ refunded?: number | null; refund_pending?: boolean | null }>,
): string {
  const many = failed.length > 1;
  if (failed.some((step) => step.refund_pending)) {
    return `A credit a failed attempt took comes back to you automatically within the hour; retrying reserves ${many ? "credits" : "the credit"} again.`;
  }
  if (failed.some((step) => (step.refunded ?? 0) > 0)) {
    return `${many ? "The failed attempts' credits were" : "The failed attempt's credit was"} returned; retrying reserves ${many ? "them" : "it"} again.`;
  }
  return `${many ? "The failed attempts" : "The failed attempt"} used no credits; retrying reserves ${many ? "credits" : "a credit"}.`;
}
