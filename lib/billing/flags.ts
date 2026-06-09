// Master switch for the whole paid layer. While false (the default), all billing
// UI is hidden and every entitlement is unlocked — the app behaves as a fully
// free tool, but all the subscription infrastructure stays in place. Flip
// NEXT_PUBLIC_BILLING_ENABLED to "true" (with Stripe configured) to go live.
//
// Client-safe: NEXT_PUBLIC_* is inlined at build, so this reads correctly in
// both server and client components.
export function isBillingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
}
