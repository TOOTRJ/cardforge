"use client";

import {
  LINK_GROUP_LABELS,
  LINK_KINDS,
  PROFILE_LINK_LABEL_MAX,
  PROFILE_LINKS_MAX,
  profileLinksSchema,
} from "@/lib/profile/link-kinds";
import {
  PROFILE_STORES_MAX,
  STORE_PLATFORMS,
  STORE_TITLE_MAX,
  profileStoresSchema,
  storePlatformOf,
} from "@/lib/profile/store-platforms";
import { saveProfileLinksAction, saveProfileStoresAction } from "@/app/(app)/settings/link-actions";
import { ProfileListEditor, type ListRow } from "@/components/settings/profile-list-editor";

// ---------------------------------------------------------------------------
// The two Settings editors of migration 0153 — "More links" and "Store
// cards" — as client islands over ProfileListEditor (its schema and save
// are functions, so they are bound here, on the client).
// ---------------------------------------------------------------------------

const LINK_CHOICES = LINK_KINDS.map((kind) => ({
  value: kind.key,
  label: kind.label,
  group: LINK_GROUP_LABELS[kind.group],
  placeholder: kind.placeholder,
}));

const STORE_CHOICES = STORE_PLATFORMS.map((platform) => ({
  value: platform.key,
  label: platform.label,
  placeholder: platform.placeholder,
}));

export function ProfileLinksEditor({ initialRows }: { initialRows: ListRow[] }) {
  return (
    <ProfileListEditor
      noun="link"
      initialRows={initialRows}
      max={PROFILE_LINKS_MAX}
      choices={LINK_CHOICES}
      choiceLabel="Site"
      choiceKey="kind"
      textLabel={(kind) => (kind === "other" ? "Name" : "Label (optional)")}
      textKey="label"
      textMax={PROFILE_LINK_LABEL_MAX}
      textPlaceholder={(kind) => (kind === "other" ? "e.g. My blog" : "")}
      schema={profileLinksSchema}
      save={saveProfileLinksAction}
      addLabel="Add a link"
      emptyText="No extra links yet — add your Moxfield, Twitch, Patreon and more."
      savedText="Links saved — they're on your profile now."
    />
  );
}

export function ProfileStoresEditor({ initialRows }: { initialRows: ListRow[] }) {
  return (
    <ProfileListEditor
      noun="store"
      initialRows={initialRows}
      max={PROFILE_STORES_MAX}
      choices={STORE_CHOICES}
      choiceLabel="Platform"
      choiceKey="platform"
      textLabel={() => "Card title (optional)"}
      textKey="title"
      textMax={STORE_TITLE_MAX}
      textPlaceholder={(platform) => storePlatformOf(platform)?.blurb ?? "e.g. Singles and sealed"}
      schema={profileStoresSchema}
      save={saveProfileStoresAction}
      addLabel="Add a store"
      emptyText="No stores yet — add where you sell cards and your profile shows a “Visit store” card for each."
      savedText="Stores saved — they're on your profile now."
    />
  );
}
