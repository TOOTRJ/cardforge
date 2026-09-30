import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { CC_TEMPLATES } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// docs/FRAMES.md is the frames runbook (TODO 7.3, 7.5): how a frame is built,
// added, shipped and verified, and what an admin does around a re-bake. It
// grew section by section and went stale in places (the importer's template
// list, the M15 family's size, builders already fixed), so these checks hold
// the parts that can drift silently: its contents list and links, the
// section titles CLAUDE.md sends readers to, every repo path it names, the
// counts it states, and the runbook's coverage of the admin page's stop
// reasons.
// ---------------------------------------------------------------------------

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const doc = read("docs/FRAMES.md");

/** The doc's lines outside ``` fences. */
function proseLines(markdown: string): string[] {
  let fenced = false;
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push(line);
  }
  return out;
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces → "-". */
function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

type Heading = { level: number; text: string; slug: string };

const headings: Heading[] = proseLines(doc).flatMap((line) => {
  const m = /^(#{1,6}) (.+)$/.exec(line);
  return m ? [{ level: m[1].length, text: m[2].trim(), slug: anchor(m[2]) }] : [];
});

/** The text of one `## ` section, up to the next `## `. */
function section(title: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l === `## ${title}`);
  expect(start, `## ${title}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("docs/FRAMES.md", () => {
  it("lists every section in its contents, in order", () => {
    const sections = headings.filter((h) => h.level === 2 && h.text !== "Contents").map((h) => h.slug);
    const contents = section("Contents");
    const listed = [...contents.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(sections.length).toBeGreaterThan(10);
    expect(listed).toEqual(sections);
  });

  it("has unique anchors, and every in-page link lands on one", () => {
    const slugs = headings.map((h) => h.slug);
    expect(new Set(slugs).size, "duplicate headings get -1 anchors").toBe(slugs.length);
    const links = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    for (const link of links) expect(slugs, `#${link}`).toContain(link);
  });

  it("keeps the section titles CLAUDE.md sends readers to", () => {
    const claude = read("CLAUDE.md").replace(/\s+/g, " ");
    const quoted = [
      ...claude.matchAll(/docs\/FRAMES\.md`?,?[^"()`]{0,40}"([^"]+)"(?: \+ "([^"]+)")?/g),
    ].flatMap((m) => [m[1], m[2]].filter((t): t is string => Boolean(t)));
    expect(quoted).toEqual(
      expect.arrayContaining(["Adding a frame", "Re-bakes after a deploy", "Re-bake runbook", "Tokens"]),
    );
    for (const title of quoted) {
      expect(
        headings.some((h) => h.text.startsWith(title)),
        `CLAUDE.md quotes "${title}"`,
      ).toBe(true);
    }
  });

  it("names only repo paths that exist", () => {
    const paths = [...doc.matchAll(/`([^`\s]+)`/g)]
      .map((m) => m[1].replace(/:\d+(-\d+)?$/, ""))
      .filter((p) => /^(app|components|content|docs|lib|public|scripts|supabase|tests|types)\//.test(p))
      .filter((p) => !/[<>{}*…]/.test(p));
    expect(paths.length).toBeGreaterThan(50);
    for (const p of new Set(paths)) expect(existsSync(path.join(root, p)), p).toBe(true);
  });

  it("names every template the Card Conjurer importer builds", () => {
    const text = section("Card Conjurer frames");
    const templates = Object.keys(CC_TEMPLATES);
    expect(text).toContain(`${templates.length} templates`);
    for (const template of templates) {
      expect(new RegExp(`\\b${template}\\b`).test(text), template).toBe(true);
    }
  });

  it("states the M15-era family's current size", () => {
    expect(section("Text sizes on the M15-era family")).toContain(`${M15_FAMILY_TEMPLATES.length} templates`);
  });

  it("tells an admin what to do for every way an automatic run can stop", () => {
    const panel = read("components/admin/auto-rebake-panel.tsx");
    const block = /const STOP_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(panel)?.[1] ?? "";
    const labels = [...block.matchAll(/:\s*"([^"]+)",?\s*$/gm)].map((m) => m[1]);
    const stops = /export type AutoRebakeStop =([\s\S]*?);/.exec(read("lib/cards/auto-rebake-state.ts"))?.[1] ?? "";
    expect(labels.length, "one label per stop reason").toBe([...stops.matchAll(/\| "/g)].length);
    const runbook = section("Re-bake runbook");
    for (const label of labels) expect(runbook, label).toContain(`"${label}"`);
  });
});
