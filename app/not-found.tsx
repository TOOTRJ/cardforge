import { AppShell } from "@/components/layout/app-shell";
import { NotFoundContent } from "@/components/layout/not-found-content";

// The 404 for a URL that matches NO route. Only the root layout is around
// it, so it brings the site chrome itself (the marketing AppShell).
//
// A notFound() thrown under a route group must never land here: each group
// has its own not-found.tsx — the same body, no shell — which Next draws
// INSIDE that group's layout. A group without one falls back to this file
// and Next still draws it inside the group's layout: a second header, banner
// and footer, and for a signed-in visitor a second RealtimeAlerts, which
// used to throw on the shared channel and hand every in-app 404 to the
// error boundary (2026-10). tests/unit/content/not-found-chrome.test.ts
// holds every group to it.

export default function NotFound() {
  return (
    <AppShell authMode="client">
      <NotFoundContent />
    </AppShell>
  );
}
