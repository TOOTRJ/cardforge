// The browser's one read of /api/referrals/share per page (TODO SG1): the
// share dialog asks when it opens, the card page's landing note when the
// address carries `?ref`. One in-flight promise is shared; a failure reads
// as "no referral" and is retried on the next ask.

import type { ReferralShareInfo } from "@/app/api/referrals/share/route";

export type { ReferralShareInfo };

let pending: Promise<ReferralShareInfo | null> | null = null;

export function readReferralShareInfo(): Promise<ReferralShareInfo | null> {
  if (!pending) {
    pending = fetch("/api/referrals/share", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ReferralShareInfo) : null))
      .catch(() => null)
      .then((info) => {
        if (!info) pending = null;
        return info;
      });
  }
  return pending;
}

/** Tests only. */
export function resetReferralShareInfo(): void {
  pending = null;
}
