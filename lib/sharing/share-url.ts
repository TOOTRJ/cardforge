// ---------------------------------------------------------------------------
// The ONE place a share link is built (TODO SG1, owner 2026-11-06).
//
// Every link a share button hands out carries `via=<network>` (GA's share
// attribution, stripped from the address bar on landing by ShareParamCleanup)
// and, for a signed-in viewer while the referral program is on, `ref=<code>`
// — the viewer's referral code, the same one /dashboard/referrals shares as
// `/?ref=<code>`. AttributionCapture (the root layout) reads `ref` on ANY
// landing page, so a card link brings the friend's signup to the referrer
// exactly as the home-page link does. The page's canonical URL stays clean.
// ---------------------------------------------------------------------------

export type ShareLinkOptions = {
  /** The network the link is for — GA's `via`. */
  via: string;
  /** The viewer's referral code; null / undefined = no referral on the link. */
  ref?: string | null;
};

/** `url` with `via` (and `ref`) set, everything else untouched. An
 *  unparseable url comes back as it was. */
export function shareUrlFor(url: string, { via, ref }: ShareLinkOptions): string {
  try {
    const next = new URL(url);
    next.searchParams.set("via", via);
    if (ref) next.searchParams.set("ref", ref);
    else next.searchParams.delete("ref");
    return next.toString();
  } catch {
    return url;
  }
}

/** The url without any share tag — what the share dialog SHOWS beside Copy
 *  link (the clipboard gets the tagged one). */
export function cleanShareUrl(url: string): string {
  try {
    const next = new URL(url);
    next.searchParams.delete("via");
    next.searchParams.delete("ref");
    return next.toString();
  } catch {
    return url;
  }
}

/** The one extra sentence a referral share carries: what the FRIEND gets
 *  (the settings' words — never a hard-coded "30 days"), the reason they'll
 *  click. The share text stays about the card; this follows it. */
export function referralShareLine(friendGets: string): string {
  return `Join with my link and you get ${friendGets} toward a plan once you've saved your first cards and started one.`;
}
