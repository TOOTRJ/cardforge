// The `cancellation_details.comment` the app writes when IT cancels a
// subscription for an account deletion (lib/account/actions.ts). The
// webhook reads it to skip the cancelled payer's win-back offer: the user is
// leaving, and their rows may already be gone (lib/stripe/webhook-handlers.ts
// `winbackForCancelledPayer`). Its own module: both callers are server
// modules of different kinds ("use server" actions vs the route).
export const ACCOUNT_DELETED_CANCEL_COMMENT = "pipglyph:account_deleted";
