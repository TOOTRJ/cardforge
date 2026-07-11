-- 0063_profile_export_watermark.sql — per-user custom card watermark text.
--
-- Paid users can print their own short mark in the card footer (where the
-- hardcoded "PipGlyph" text used to sit — that text is removed entirely);
-- unset = a blank footer slot. Free users keep the pipglyph.com brand-mark
-- overlay on exports and can't customize the footer (paid perk, enforced at
-- read time by ownerExportStamp in lib/billing/entitlements.ts).
--
-- Deliberately NOT a protect_billing_columns-pinned column: it's a user
-- preference the owner edits through their own client (the "update own
-- profile" RLS policy); whether it APPLIES is the entitlement check.
-- (0062 is reserved by the in-flight card-remix jobs migration.)

alter table public.profiles
  add column if not exists export_watermark_text text
    check (
      export_watermark_text is null
      or char_length(export_watermark_text) between 1 and 40
    );

comment on column public.profiles.export_watermark_text is
  'Optional custom mark printed in the card footer on renders/exports. Applied only while the owner''s plan removes the brand mark; blank otherwise. Max 40 chars.';
