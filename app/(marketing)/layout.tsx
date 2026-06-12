import { AppShell } from "@/components/layout/app-shell";

// Marketing layout — a sync, cookie-free passthrough so every page in
// this group is eligible for static rendering / CDN caching. Auth-aware
// header chrome comes from the SiteHeaderClient island (authMode
// "client"), which fetches /api/me post-hydration only when a Supabase
// session cookie is present. Pages that genuinely depend on the viewer
// (gallery like-state, card detail, etc.) opt into dynamic rendering
// themselves by reading cookies in their own loaders.

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell variant="marketing" authMode="client">
      {children}
    </AppShell>
  );
}
