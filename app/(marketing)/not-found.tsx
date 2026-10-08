import { NotFoundContent } from "@/components/layout/not-found-content";

// notFound() anywhere under (marketing): a missing or unreadable card,
// profile, deck, challenge, guide or hub. Next draws this inside the group's
// layout, which already has the site chrome — so the body only, never a
// second AppShell (see app/not-found.tsx).

export default function MarketingNotFound() {
  return <NotFoundContent />;
}
