-- 0037: record which renderer/layout generation baked each stored card render.
--
-- `layout_version` mirrors CARD_LAYOUT_VERSION in lib/cards/layout-version.ts
-- and is stamped by every bake (save-time and the admin re-bake sweep).
-- NULL means the render predates versioning (or the card has no render) —
-- i.e. stale by definition. The sweep (scripts/rebake-renders.mjs →
-- POST /api/admin/rebake) re-bakes rows where rendered_image_url is set and
-- layout_version is null or below the current constant.

alter table public.cards
  add column if not exists layout_version integer;

comment on column public.cards.layout_version is
  'Renderer/layout generation that baked rendered_image_url (lib/cards/layout-version.ts). NULL = pre-versioning or no render.';
