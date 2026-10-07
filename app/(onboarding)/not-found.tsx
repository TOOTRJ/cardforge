import { NotFoundContent } from "@/components/layout/not-found-content";

// notFound() under (onboarding). Next draws this inside the group's layout —
// its own quiet header and column — so the body only (see app/not-found.tsx).

export default function OnboardingNotFound() {
  return <NotFoundContent />;
}
