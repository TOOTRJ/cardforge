import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Tools used" on an account's admin page (/admin/users?u=…): one row per
// beta tool the account has an event of, all time. A tool's name opens that
// account's event log in the tool on the analytics page — 90 days and
// admins included, so the account is on the list whoever it is. A tool the
// catalog no longer lists keeps its row as plain text (there is no page to
// open). The table is named for a screen reader and scrolls in its own box.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));

import { UserToolsUsed } from "@/components/admin/analytics/tools-user-usage";

const USER = "d0000000-0000-4000-a000-000000000003";
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const cells = (markup: string) =>
  [...markup.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => cell[1].replace(/<[^>]+>/g, "").trim()),
  );

describe("UserToolsUsed", () => {
  const out = html(
    <UserToolsUsed
      userId={USER}
      usage={[
        { slug: "rule0-sheet", opens: 1, uses: 2, failures: 1, lastAt: "2026-11-09T08:13:00+00:00" },
        { slug: "collection-builder", opens: 1284, uses: 0, failures: 0, lastAt: null },
        { slug: "retired-tool", opens: 3, uses: 1, failures: 0, lastAt: "2026-10-01T10:00:00+00:00" },
      ]}
    />,
  );

  it("lists each tool by name with its opens, uses, failures and when it was last touched (UTC, labelled)", () => {
    expect(cells(out)).toEqual([
      ["Tool", "Opens", "Uses", "Failures", "Last activity"],
      ["Rule 0 Table Sheet", "1", "2", "1", "Nov 9, 2026, 8:13 AM UTC"],
      ["Collection Deck Builder", "1,284", "0", "0", "—"],
      // a tool the catalog no longer lists keeps its numbers, under its slug
      ["retired-tool", "3", "1", "0", "Oct 1, 2026, 10:00 AM UTC"],
    ]);
  });

  it("links a tool to this account's event log in it: the Tools tab, 90 days, admins included", () => {
    expect(out).toContain(`href="/admin/analytics?tab=tools&amp;days=90&amp;admins=1&amp;tool=rule0-sheet&amp;user=${USER}#event-log"`);
    expect(out).toContain(`href="/admin/analytics?tab=tools&amp;days=90&amp;admins=1&amp;tool=collection-builder&amp;user=${USER}#event-log"`);
  });

  it("a tool the catalog no longer lists is plain text that says so — never a link to a page that isn't there", () => {
    expect(out).toContain('<span title="No longer in the tools catalog">retired-tool</span>');
    expect(out).not.toContain("tool=retired-tool");
    // the two tools the catalog lists are the only links
    expect(out.split("<a ").length - 1).toBe(2);
    // …and a listed tool carries no such note
    expect(out.split("No longer in the tools catalog").length - 1).toBe(1);
  });

  it("names the table for a screen reader, and scrolls it in a box of its own", () => {
    // one caption, the table's first child, read but not drawn
    expect(out).toContain('<table class="w-full text-sm"><caption class="sr-only">Tools this account has used, all time</caption><thead>');
    expect(out.split("<caption").length - 1).toBe(1);
    // the box scrolls sideways (never the page) and is `relative`: an
    // sr-only element inside a scroller needs a positioned ancestor in it
    const box = /^<div class="([^"]*)"><table/.exec(out)?.[1].split(" ") ?? [];
    expect(box).toEqual(expect.arrayContaining(["relative", "overflow-x-auto"]));
    // a caller's own classes join the box's, they do not replace them
    const spaced = html(<UserToolsUsed userId={USER} usage={[{ slug: "rule0-sheet", opens: 1, uses: 2, failures: 1, lastAt: null }]} className="mt-3" />);
    expect(/^<div class="([^"]*)"><table/.exec(spaced)?.[1].split(" ")).toEqual(expect.arrayContaining(["relative", "overflow-x-auto", "mt-3"]));
  });

  it("an account with no tool events says so in a sentence", () => {
    const none = html(<UserToolsUsed userId={USER} usage={[]} />);
    expect(none).toContain("Hasn’t opened a tool yet.");
    expect(none).not.toContain("<table");
  });

  it("a read that failed says so — never “hasn't opened a tool”", () => {
    const failed = html(<UserToolsUsed userId={USER} usage={null} />);
    expect(failed).toContain('data-testid="admin-load-error"');
    expect(failed).toContain("the tools this account used");
    expect(failed).not.toContain("opened a tool yet");
    // null is also what a database 0204 has not reached answers (getUserToolUsage):
    // nothing was read, so nothing is claimed about the account
    expect(failed).not.toContain("<table");
  });
});
