import { getBannerContent } from "@/lib/updates/queries";
import { UpdatesBannerShell } from "./updates-banner-shell";

// Homepage banner: the newest shipped update flagged for the banner plus up
// to three teased features. Server component over the cached public feed, so
// the page stays ISR; dismissal is per-browser (localStorage) in the shell.
export async function UpdatesBanner() {
  const { headline, upcoming } = await getBannerContent();
  if (!headline && upcoming.length === 0) return null;
  return (
    <UpdatesBannerShell
      dismissKey={`${headline?.id ?? "none"}:${upcoming.map((u) => u.id).join(",")}`}
      headline={
        headline
          ? { title: headline.title, summary: headline.summary, href: headline.link_href ?? "/news" }
          : null
      }
      upcoming={upcoming.map((u) => u.title)}
    />
  );
}
