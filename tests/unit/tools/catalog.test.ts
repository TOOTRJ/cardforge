import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_CATALOG, TOOL_EVENT_RE, isToolSlug, toolBySlug, toolHref } from "@/lib/tools/catalog";
import { TOOL_ICONS } from "@/components/tools/tool-icon";
import { sanitizeToolEventProps } from "@/lib/tools/events";
import { niceTicks } from "@/components/admin/tools/usage-chart";

// ---------------------------------------------------------------------------
// The beta tools catalog (lib/tools/catalog.ts): every slug fits the
// database's CHECK (0182) and is unique, every tool has an icon, and a BUILT
// tool has its page — the hub links to it, so a `built: true` without a page
// would be a 404 for every tester.
// ---------------------------------------------------------------------------

const SLUG_CHECK = /^[a-z][a-z0-9-]{1,47}$/;

describe("TOOL_CATALOG", () => {
  it("has unique slugs that fit the database CHECK", () => {
    const slugs = TOOL_CATALOG.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(SLUG_CHECK);
  });

  it("gives every tool words, highlights and an icon", () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.name.trim()).not.toBe("");
      expect(tool.tagline.length).toBeLessThanOrEqual(80);
      expect(tool.highlights.length).toBeGreaterThanOrEqual(2);
      expect(TOOL_ICONS[tool.icon]).toBeTruthy();
    }
  });

  it("gives every BUILT tool its page, opened through openTool", () => {
    for (const tool of TOOL_CATALOG.filter((t) => t.built)) {
      const page = join(process.cwd(), "app/(app)/dashboard/tools", tool.slug, "page.tsx");
      const source = readFileSync(page, "utf8");
      expect(source, tool.slug).toContain(`openTool("${tool.slug}")`);
    }
  });

  it("looks tools up by slug", () => {
    const first = TOOL_CATALOG[0];
    expect(isToolSlug(first.slug)).toBe(true);
    expect(isToolSlug("nope")).toBe(false);
    expect(isToolSlug(42)).toBe(false);
    expect(toolBySlug(first.slug)?.name).toBe(first.name);
    expect(toolHref(first.slug)).toBe(`/dashboard/tools/${first.slug}`);
  });

  it("matches tool_events' event CHECK", () => {
    expect(TOOL_EVENT_RE.test("open")).toBe(true);
    expect(TOOL_EVENT_RE.test("import_csv")).toBe(true);
    expect(TOOL_EVENT_RE.test("Open")).toBe(false);
    expect(TOOL_EVENT_RE.test("x")).toBe(false);
    expect(TOOL_EVENT_RE.test("drop table")).toBe(false);
  });
});

describe("sanitizeToolEventProps", () => {
  it("keeps short scalar props and drops everything else", () => {
    expect(
      sanitizeToolEventProps({
        rows: 120,
        format: "manabox",
        ok: true,
        none: null,
        nested: { a: 1 },
        list: [1],
        Bad: "x",
        nan: Number.NaN,
        long: "x".repeat(500),
      }),
    ).toEqual({ rows: 120, format: "manabox", ok: true, none: null, long: "x".repeat(120) });
    expect(sanitizeToolEventProps(null)).toEqual({});
    expect(sanitizeToolEventProps([1, 2])).toEqual({});
  });

  it("keeps at most twelve keys", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeToolEventProps(many))).toHaveLength(12);
  });
});

describe("niceTicks", () => {
  it("tops the axis on a round number at or above the max", () => {
    expect(niceTicks(1)).toEqual([0, 1, 2]);
    expect(niceTicks(3)).toEqual([0, 2, 4]);
    expect(niceTicks(7)).toEqual([0, 5, 10]);
    expect(niceTicks(36)).toEqual([0, 20, 40]);
    expect(niceTicks(180)).toEqual([0, 100, 200]);
  });
});
