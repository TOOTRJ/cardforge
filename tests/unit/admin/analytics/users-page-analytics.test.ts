import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The admin Users page after the analytics page (2026-11): the directory and
// an account's tools stay; the product's NUMBERS — the funnel, referrals,
// credit grants, revenue — moved to /admin/analytics and are no longer read
// on every visit to the user list. The billing health check stays: it is an
// on-demand check about accounts, not a number about the product.
// The two admin Tools pages each link to the matching analytics view.
// ---------------------------------------------------------------------------

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");
const users = read("app/(app)/admin/users/page.tsx");
/** The page without its comments (they may name what moved). */
const code = users
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
  .join("\n");

describe("/admin/users — the list", () => {
  it.each([
    ["FunnelPanel", "getFunnelSummary", "@/lib/admin/funnel-queries"],
    ["ReferralPanel", "getReferralStats", "@/lib/admin/referral-queries"],
    ["ReferralPanel", "readReferralSettings", "@/lib/referrals/settings-server"],
    ["CreditGrantsPanel", "getCreditGrantStats", "@/lib/admin/credit-grant-stats"],
    ["RevenuePanel", "getRevenueSummary", "@/lib/admin/revenue-queries"],
  ])("no longer draws %s or runs %s", (panel, reader, module) => {
    expect(code).not.toContain(panel);
    expect(code).not.toContain(reader);
    expect(code).not.toContain(module);
  });

  it("reads the directory alone", () => {
    expect(code).toMatch(/const page = await listAdminUsers\(params\);/);
    // the list view's only await besides the viewer and the address
    const list = code.slice(code.indexOf("export default async function AdminUsersPage"), code.indexOf("function UserFilters"));
    expect(list.match(/await /g)).toHaveLength(3);
  });

  it("keeps the billing health check, the filters and the directory", () => {
    expect(code).toContain("<BillingHealthPanel />");
    expect(code).toContain("<UserFilters params={params} />");
    expect(code).toContain('<AdminLoadError what="the user directory"');
    expect(code).toContain("<Pagination params={params}");
  });

  it("links to Analytics from the header, and says in one line that the numbers moved there", () => {
    expect(code).toMatch(/import \{ ANALYTICS_PATH \} from "@\/lib\/admin\/analytics\/params";/);
    expect(code).toMatch(/<Link href=\{ANALYTICS_PATH\}>\s*<BarChart3[^>]*\/> Analytics\s*<\/Link>/);
    expect(code).toMatch(/The funnel, revenue, credit and referral numbers have moved to/);
    // the count badge is still there beside it
    expect(code).toContain("{page.loadError ? null : <Badge variant=\"primary\">{page.total.toLocaleString()} total</Badge>}");
  });
});

describe("/admin/users?u=… — one account", () => {
  it("reads the account's tools with its other reads, in the one Promise.all", () => {
    const detail = code.slice(code.indexOf("async function UserDetail"));
    const all = detail.slice(detail.indexOf("await Promise.all(["), detail.indexOf("]);"));
    expect(all).toContain("getAdminUserStats(userId)");
    expect(all).toContain("listBankEntriesForAdmin(admin, userId)");
    expect(all).toContain("getUserToolUsage(admin, userId)");
    expect(detail).toMatch(/grants, bank, toolUsage\] =/);
  });

  it("draws “Tools used” from that read (its failure and its empty state are the component's)", () => {
    expect(code).toContain('title="Tools used"');
    expect(code).toContain("<UserToolsUsed userId={user.id} usage={toolUsage}");
  });

  it("still prints its billing dates through the labelled UTC helpers", () => {
    expect(users).toMatch(/formatUtcDateTime\(user\.current_period_end\)/);
    expect(users).toMatch(/formatUtcDateTime\(user\.comp_expires_at\)/);
    expect(users).toMatch(/formatUtcDateTime\(entry\.created_at\)/);
  });
});

describe("the admin Tools pages link to the analytics", () => {
  it("/admin/tools → the Tools tab", () => {
    const page = read("app/(app)/admin/tools/page.tsx");
    expect(page).toMatch(/href=\{toolsAnalyticsHref\(\)\}/);
    expect(page).toContain("See who used each tool →");
  });

  it("/admin/tools/[slug] → that tool's view, for the period the page is showing", () => {
    const page = read("app/(app)/admin/tools/[slug]/page.tsx");
    expect(page).toMatch(/href=\{toolAnalyticsHref\(tool\.slug, days\)\}/);
    expect(page).toContain("See who used it →");
    // nothing else left: the tool's own link and its usage panel are still there
    expect(page).toContain("Open the tool");
    expect(page).toContain("<Analytics detail={detail} />");
  });
});
