import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { breakerAfterBatch, breakerForPoison, POISON_MAX } from "@/lib/cards/auto-rebake-state";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { FAQ_TOPICS } from "@/lib/content/faq";
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

/** The text of one `### ` subsection, up to the next `## ` or `### `. */
function subsection(title: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => l === `### ${title}`);
  expect(start, `### ${title}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^#{2,3} /.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/** A markdown table's body rows (header and separator dropped), as cells. */
function tableRows(markdown: string): string[][] {
  const rows = markdown.split("\n").filter((l) => l.startsWith("|"));
  expect(rows.length, "a table").toBeGreaterThan(2);
  return rows.slice(2).map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every page and route handler under app/, as a pattern over its URL path:
 *  route groups and parallel slots dropped, a dynamic segment matching any
 *  one segment (a catch-all, anything). */
function appRoutes(): RegExp[] {
  const appDir = path.join(root, "app");
  const routes: RegExp[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^(page|route)\.[jt]sx?$/.test(entry.name)) {
        const segments = path
          .relative(appDir, dir)
          .split(path.sep)
          .filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"))
          .map((s) => (/^\[\[?\.\.\./.test(s) ? ".*" : /^\[.*\]$/.test(s) ? "[^/]+" : escapeRegExp(s)));
        routes.push(new RegExp(`^/${segments.join("/")}$`));
      }
    }
  };
  walk(appDir);
  return routes;
}

/** File names under the repo's source folders and its root. */
function repoFileNames(): Set<string> {
  const names = new Set(readdirSync(root));
  for (const dir of ["app", "components", "content", "docs", "lib", "scripts", "supabase", "tests", "types"]) {
    for (const file of readdirSync(path.join(root, dir), { recursive: true }) as string[]) {
      names.add(path.basename(file));
    }
  }
  return names;
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
      .filter((p) => /^(\.github|app|components|content|docs|lib|public|scripts|supabase|tests|types)\//.test(p))
      .filter((p) => !/[<>{}*…]/.test(p));
    expect(paths.length).toBeGreaterThan(50);
    for (const p of new Set(paths)) expect(existsSync(path.join(root, p)), p).toBe(true);
  });

  it("names only files that exist when it gives a bare file name", () => {
    const names = [...doc.matchAll(/`([^`\s/]+)`/g)]
      .map((m) => m[1])
      .filter((n) => /^[\w-]+(\.[\w-]+)*\.(tsx?|mjs|js|json|md|sql|ya?ml)$/.test(n));
    expect(names.length).toBeGreaterThan(10);
    const files = repoFileNames();
    for (const name of new Set(names)) expect(files.has(name), name).toBe(true);
  });

  it("names only site routes that exist", () => {
    const routes = appRoutes();
    const urls = [...doc.matchAll(/`(?:(?:GET|POST) )?(\/[^`\s]*)`/g)]
      .map((m) => m[1].replace(/[?#].*$/, "").replace(/<[^>]+>/g, "x"))
      .filter((u) => u.length > 1);
    expect(urls.length).toBeGreaterThan(10);
    for (const url of new Set(urls)) {
      // A public asset (`/frames/<template>/<file>`): its folder exists.
      const asset = existsSync(path.join(root, "public", url.split("/")[1]));
      expect(asset || routes.some((r) => r.test(url)), url).toBe(true);
    }
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
    // The table itself: one row per label, quoted exactly, each with advice.
    // (The labels are quoted elsewhere in the runbook too, so a check over
    // the whole section would miss a dropped row.)
    const rows = tableRows(subsection("Why the last run stopped"));
    const quoted = rows.map(([said]) => /^"([^"]+)"$/.exec(said)?.[1] ?? said);
    expect([...quoted].sort()).toEqual([...labels].sort());
    for (const [said, todo] of rows) expect(todo, said).toMatch(/\w/);
  });

  it("quotes the breaker's reasons the way the code writes them", () => {
    const rows = tableRows(subsection("When the breaker trips"));
    const quotes = rows.map(([said]) => /^"([^"]+)"$/.exec(said)?.[1]);
    expect(quotes.every(Boolean), "each row quotes one reason").toBe(true);
    // Each quote, less its placeholders (N, a number, "…", "@…"), is text the
    // code writes: a reworded reason turns this red.
    const source = ["lib/cards/auto-rebake.ts", "lib/cards/auto-rebake-state.ts", "lib/cards/auto-rebake-actions.ts"]
      .map(read)
      .join("\n");
    for (const quote of quotes as string[]) {
      const fragments = quote
        .split(/@…|…|\bN\b|\d+/)
        .map((f) => f.trim())
        .filter((f) => f.length >= 6);
      expect(fragments.length, quote).toBeGreaterThan(0);
      for (const fragment of fragments) expect(source, `${quote} → "${fragment}"`).toContain(fragment);
    }
    // And what the pure breaker checks return matches a row.
    const patterns = (quotes as string[]).map(
      (quote) =>
        new RegExp(
          `^${quote
            .split(/(@…|…|\bN\b)/)
            .map((part) => (part === "N" ? "\\d+" : part === "…" ? "[\\s\\S]*" : part === "@…" ? "@\\S+" : escapeRegExp(part)))
            .join("")}$`,
        ),
    );
    const fail = (id: string) => ({ id, error: "Art unavailable" });
    const reasons = [
      breakerAfterBatch({ processed: 0, superseded: 0, failed: [fail("a"), fail("b"), fail("c")] }, { newFailures: 3 }, new Set()),
      breakerAfterBatch({ processed: 4, superseded: 0, failed: [fail("d")] }, { newFailures: 10 }, new Set()),
      breakerForPoison(POISON_MAX, Array.from({ length: POISON_MAX + 1 }, (_, i) => ({ ...fail(`p${i}`), failures: 3, at: "" }))),
    ];
    for (const reason of reasons) {
      expect(reason).toBeTruthy();
      expect(patterns.some((p) => p.test(reason!)), reason!).toBe(true);
    }
  });

  it("keeps its /news templates within the site-update form's limits", () => {
    const actions = read("lib/updates/actions.ts");
    const max = (field: string) => Number(new RegExp(`\\b${field}: z\\.string\\(\\)[^\\n]*?\\.max\\((\\d+)\\)`).exec(actions)?.[1]);
    const limits = { title: max("title"), summary: max("summary"), body: max("body") };
    for (const [field, limit] of Object.entries(limits)) expect(limit, field).toBeGreaterThan(0);
    const text = section("Announcing a change");
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain(`title ≤ ${limits.title} characters, summary ≤ ${limits.summary}`);
    expect(flat).toContain(`body ≤ ${limits.body}`);
    // Title, summary, body — for a correction, then for an addition. The
    // page keeps the body's line breaks and the summary is a one-line input.
    const blocks = [...text.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    expect(blocks).toHaveLength(6);
    for (let i = 0; i < blocks.length; i += 3) {
      const [title, summary, body] = blocks.slice(i, i + 3);
      expect(title, "title").not.toContain("\n");
      expect(title.length, title).toBeLessThanOrEqual(limits.title);
      expect(summary, "summary").not.toContain("\n");
      expect(summary.length, summary).toBeLessThanOrEqual(limits.summary);
      expect(body.length, "body").toBeLessThanOrEqual(limits.body);
    }
  });

  it("runs the manual script against production with the script's own hidden prompt, never a secret on the command line", () => {
    const text = subsection("The manual script");
    const commands = [...text.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
    const production = commands.filter((c) => c.includes("REBAKE_URL=https://www.pipglyph.com/"));
    expect(production, "a production command").toHaveLength(1);
    expect(production[0]).toMatch(/node scripts\/rebake-renders\.mjs$/);
    // The secret is asked for by the script (scripts/lib/rebake-secret.mjs);
    // the old `read -rs` + `CRON_SECRET="$CRON_SECRET"` dance is gone.
    for (const command of commands) expect(command, command).not.toMatch(/CRON_SECRET|read -rs/);
    expect(text).not.toMatch(/read -rs|unset CRON_SECRET/);
    expect(text.replace(/\s+/g, " ")).toMatch(/asks for production's `CRON_SECRET` .*at a hidden prompt/);
    expect(read("scripts/rebake-renders.mjs")).toMatch(/resolveRebakeSecret\(URL_/);
  });

  it("points at a FAQ entry that exists, under the anchor it gives", () => {
    const text = section("Announcing a change").replace(/\s+/g, " ");
    const question = /The FAQ entry "([^"]+)"/.exec(text)?.[1];
    const anchor = /`\/faq#([\w-]+)`/.exec(text)?.[1];
    const topic = FAQ_TOPICS.find((t) => t.slug === anchor);
    expect(topic, `/faq#${anchor}`).toBeDefined();
    expect(topic!.entries.map((e) => e.q)).toContain(question);
  });
});
