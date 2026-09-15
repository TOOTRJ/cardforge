import { getBannerContent } from "@/lib/updates/queries";
import { UpdatesBannerShell, type BannerSliceProps } from "./updates-banner-shell";

// The what's-new ribbon under the site header (rendered by AppShell on every
// page). Server component over the cached public feed, so static pages stay
// static; the client shell picks the homepage slice on "/" and the site-wide
// slice everywhere else, and handles per-browser dismissal. The admin's
// global switch (site_settings) hides it everywhere.
export async function UpdatesBanner() {
  const { enabled, home, site } = await getBannerContent();
  if (!enabled) return null;
  const toProps = (s: typeof home): BannerSliceProps | null =>
    !s.headline && s.upcoming.length === 0
      ? null
      : {
          dismissKey: `${s.headline?.id ?? "none"}:${s.upcoming.map((u) => u.id).join(",")}`,
          headline: s.headline
            ? { title: s.headline.title, summary: s.headline.summary, href: s.headline.link_href ?? "/news" }
            : null,
          upcoming: s.upcoming.map((u) => u.title),
        };
  const homeProps = toProps(home);
  const siteProps = toProps(site);
  if (!homeProps && !siteProps) return null;
  return <UpdatesBannerShell home={homeProps} site={siteProps} />;
}
