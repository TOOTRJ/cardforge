# Production Stripe changes — the log

Every change to the PRODUCTION Stripe account or its settings is recorded
here (owner rule, 2026-11-05): how it worked before, exactly what changed,
how it works now, and how the owner verifies it by hand. Newest first.
Sandbox (test-mode) changes are not logged here.

## 2026-11-05 — the live webhook endpoint subscribes to refunds, disputes and fraud warnings

**Context.** PR #759 (migration 0174) makes the app handle money going back:
`charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` and
`radar.early_fraud_warning.created` (see docs/BILLING.md "Refunds, disputes
and fraud warnings"). A webhook endpoint only receives the events it
subscribes to, so the live endpoint had to be told.

**Before.** The one live endpoint, `we_1TrupnQFLEpCg9s2bSILz13V`
(`https://www.pipglyph.com/api/stripe/webhook`, API version
`2026-05-27.dahlia`, status `enabled`), subscribed to NINE events:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.expired`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`customer.subscription.trial_will_end`, `invoice.paid`,
`invoice.payment_failed`. A refund, a dispute or a fraud warning on a live
charge was never delivered to the app: a charged-back credit pack kept its
credits, a refunded invoice stayed "paid" in the admin Revenue panel, and
nobody was told.

**What changed** (one API call, `POST /v1/webhook_endpoints/we_1TrupnQFLEpCg9s2bSILz13V`,
through the Stripe connector at about 21:55 UTC): `enabled_events` went
from the nine above to THIRTEEN — the nine plus `charge.refunded`,
`charge.dispute.created`, `charge.dispute.closed`,
`radar.early_fraud_warning.created`. Nothing else on the endpoint changed
(same URL, same API version, same signing secret, still enabled). Read back
after the write: the thirteen events are in place.

**How it works now.** Stripe delivers the four new events to the live
endpoint. Until PR #759 is deployed the webhook answers them with a 200 and
does nothing (the handler's `default` branch), which is what happened to
every unsubscribed event before. Once #759 is live: a refund marks the sale
in `billing_payments` / `billing_pack_payments` and takes back a credit
pack's unspent credits; a dispute marks the sale and takes the pack's
credits back while it is open, giving them back if it is won; every admin
gets one `billing_alert` bell row per event; the Revenue panel labels
refunded and disputed rows. No user-facing email is sent by the app for
these (Stripe's own refund receipt covers that).

**Verify it yourself.**
1. Stripe Dashboard → Developers → Webhooks (Workbench → Event destinations)
   → the endpoint for `https://www.pipglyph.com/api/stripe/webhook`. "Listening
   for 13 events"; the list includes the four new ones. API version
   `2026-05-27.dahlia`, status Enabled.
2. After #759 is deployed, send a test event from that page ("Send test
   event" → `charge.refunded`): the endpoint answers 200 within a second.
   The test event's charge matches no sale, so `/admin/users` → the bell
   shows one "Refund … on an unmatched charge (no account matched — see
   Stripe)" alert for every admin, once. (A test event before the deploy
   answers 200 and shows nothing — expected.)
3. Real proof, when a refund happens: refund a credit pack from the
   Dashboard → within seconds the buyer's credits drop by the refunded share
   (`/dashboard/usage` shows "Credit pack refunded"), the admin bell has the
   alert, and the Revenue panel's row reads "· refunded $X".

**Still yours (not readable through the API).** Dashboard → Settings →
Billing → Subscriptions and emails: confirm **Smart Retries** are on (the
app's 14-day dunning grace, #759, is sized to Stripe's retry window). The
app sends its own payment-failed email, so Stripe's "failed payment" email
can stay off or on as you prefer (on = two emails).
