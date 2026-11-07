-- 0183_exact_copy_unlisted.sql — exact copies of real cards stay out of the
-- public gallery (owner 2026-11-06: "the public gallery should only show
-- cards that have been customized").
--
-- A card that still prints exactly what a Scryfall import gave it (its
-- stored `import_fingerprint`, 0144, still matches its columns) is the real
-- card, not a PipGlyph card. The creator no longer saves a new one
-- (createCardAction's EXACT_COPY refusal), an edit that leaves one exact is
-- stored at most unlisted, My Cards' bulk publish skips one, and the hourly
-- /api/cron/exact-copies moves any public one to UNLISTED and tells its
-- owner once (lib/cards/exact-copy-sweep.ts). SQL can't compute the
-- fingerprint (the canonical text is lib/cards/import-fingerprint.ts's
-- JSON), so the app makes every judgment; this migration only adds the
-- notification kind that tells the owner.
--
-- No new table, function or column: no grants to state.

alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'like', 'comment', 'remix', 'follow', 'feedback', 'moderation', 'message',
      'credit_grant', 'comp_plan', 'card_limit', 'render_update', 'site_update',
      'deck_generated', 'trial_ending', 'payment_received', 'checkout_reminder',
      'trial_lapsed', 'render_sweep_paused', 'credit_refill_failed',
      'deck_like', 'deck_card_added', 'moderation_unhidden', 'comp_ending',
      'deck_cloned', 'challenge_winner',
      'payment_failed', 'billing_alert',
      'referral_signup', 'referral_reward',
      'banked_days',
      'tool_access',
      -- EXACT COPIES
      'exact_copy_unlisted'
    )
  );
