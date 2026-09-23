/**
 * Full-page navigation to an external URL (Stripe Checkout, the Customer
 * Portal). One function so the buttons that redirect can be unit-tested by
 * stubbing this module instead of the browser's Location.
 */
export function navigateTo(url: string): void {
  window.location.assign(url);
}
