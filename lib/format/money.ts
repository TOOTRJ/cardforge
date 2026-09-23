/** "$6" / "$6.50" — a Stripe minor-unit amount as a display string.
 *  Client-safe (no Stripe import): the notification copy uses it too. */
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
