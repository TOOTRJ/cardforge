import Link from "next/link";
import {
  ADMIN_FILTER_TABS,
  ANALYTICS_RANGES,
  ANALYTICS_TABS,
  analyticsHref,
  type AnalyticsParams,
} from "@/lib/admin/analytics/params";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/analytics — the tab strip and, under it, ONE filter row that scopes
// everything below: the period (7 / 30 / 90 days) and, on the tabs it means
// something for, whether admins' own activity is counted. All plain links:
// the address is the state.
// ---------------------------------------------------------------------------

export function AnalyticsNav({ params }: { params: AnalyticsParams }) {
  const adminFilter = ADMIN_FILTER_TABS.includes(params.tab);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Analytics sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {ANALYTICS_TABS.map((tab) => {
          const current = tab.id === params.tab;
          return (
            <Link
              key={tab.id}
              href={analyticsHref(params, { tab: tab.id })}
              aria-current={current ? "page" : undefined}
              scroll={false}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                current ? "border-primary-bright text-foreground" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Period" className="flex rounded-lg border border-border p-0.5">
          {ANALYTICS_RANGES.map((range) => (
            <Link
              key={range}
              href={analyticsHref(params, { days: range, page: 1 })}
              aria-current={range === params.days ? "page" : undefined}
              scroll={false}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                range === params.days ? "bg-elevated text-foreground" : "text-muted hover:text-foreground",
              )}
            >
              {range} days
            </Link>
          ))}
        </nav>
        {adminFilter ? (
          <Link
            href={analyticsHref(params, { admins: !params.admins, page: 1 })}
            aria-label={
              params.admins
                ? "Include admins: on. Leave the team's own accounts out"
                : "Include admins: off. Count the team's own accounts too"
            }
            scroll={false}
            className="group inline-flex items-center gap-2 rounded-md px-1 py-1 text-xs font-medium text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            <span
              aria-hidden
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 rounded-full border transition-colors",
                params.admins ? "border-primary-bright bg-primary" : "border-border bg-surface",
              )}
            >
              <span
                className={cn(
                  "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-foreground transition-[left]",
                  params.admins ? "left-[0.9rem]" : "left-0.5",
                )}
              />
            </span>
            Include admins
          </Link>
        ) : null}
        <p className="text-xs text-subtle">
          {adminFilter
            ? params.admins
              ? "Counting the team's own accounts too."
              : "The team's own accounts are left out."
            : "This tab counts everyone."}{" "}
          Days are UTC.
        </p>
      </div>
    </div>
  );
}
