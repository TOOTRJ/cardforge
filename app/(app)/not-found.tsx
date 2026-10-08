import { NotFoundContent } from "@/components/layout/not-found-content";

// notFound() anywhere under (app): a card or thread that isn't the viewer's,
// an admin page for a non-admin. Next draws this inside the group's layout,
// which already has the signed-in chrome — so the body only, never a second
// AppShell (see app/not-found.tsx).

export default function AppNotFound() {
  return <NotFoundContent />;
}
