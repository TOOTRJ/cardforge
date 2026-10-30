import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// TODO WD1: the page frame is ONE component — PageContainer
// (components/layout/page-container.tsx: standard 1280 px, wide 1920 px,
// full). The site had 36 hand-written copies of `mx-auto w-full max-w-7xl
// px-4 sm:px-6 lg:px-8`, so no page could change its width without someone
// finding every copy. Two scans hold it:
//
//   * no class list in app/ or components/ is a page frame of its own: one
//     that centres itself (`mx-auto`), pads its sides (`px-*`) and caps
//     itself at a PAGE width (7xl, 6xl, 1920 px, a screen size) at once. A
//     narrower centred block — a 2xl notice, the homepage's 5xl bands, the
//     reading measure — is content inside a frame, not a frame;
//   * every page (app/**/page.tsx) gets its frame from PageContainer: in its
//     own source, or through the shell or view it renders (DashboardShell,
//     LegalPageShell, the gallery's and decks' views…), or from its route
//     group's layout — else it is listed in FRAMELESS_PAGES with the reason
//     it draws none.
// ---------------------------------------------------------------------------

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(path)) files.push(path);
  }
};
walk("app");
walk("components");
const read = (path: string) => readFileSync(path, "utf8");

/** Every string literal of a source that holds a class list. */
function classLists(source: string): string[] {
  return source.match(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g) ?? [];
}

const PAGE_CAP = /(?:^|[\s"'`])max-w-(?:7xl|6xl|\[1920px\]|screen-[a-z0-9]+)(?=[\s"'`])/;
const SIDE_PADDING = /(?:^|[\s"'`])(?:[a-z0-9]+:)*px-/;
const CENTRED = /(?:^|[\s"'`])mx-auto(?=[\s"'`])/;

function handFrames(source: string): string[] {
  return classLists(source).filter((s) => CENTRED.test(s) && PAGE_CAP.test(s) && SIDE_PADDING.test(s));
}

/** Hand-written frames that stay, and why. */
const HAND_FRAMES_ALLOWED: Record<string, string> = {
  // The card page's 1152 px (6xl) frame; the modal draws the same content
  // unframed. The plan moves it up to standard — a visual change of its
  // own, never part of WD1's "nothing moves".
  "components/cards/card-detail-content.tsx": "the card page's 6xl frame",
};

/** Pages that draw no frame of their own, and why. */
const FRAMELESS_PAGES: Record<string, string> = {
  "app/(app)/admin/messages/[threadId]/page.tsx": "framed by admin/messages/layout.tsx (DashboardShell)",
  "app/(app)/admin/messages/page.tsx": "framed by admin/messages/layout.tsx (DashboardShell)",
  "app/(app)/messages/[threadId]/page.tsx": "framed by messages/layout.tsx (DashboardShell)",
  "app/(app)/messages/page.tsx": "framed by messages/layout.tsx (DashboardShell)",
  "app/(app)/deck/[slug]/edit/page.tsx": "a redirect",
  "app/(auth)/auth/confirm/page.tsx": "the auth layout's centred column",
  "app/(auth)/forgot-password/page.tsx": "the auth layout's centred column",
  "app/(auth)/login/page.tsx": "the auth layout's centred column",
  "app/(auth)/reset-password/page.tsx": "the auth layout's centred column",
  "app/(auth)/signup/page.tsx": "the auth layout's centred column",
  "app/(onboarding)/onboarding/page.tsx": "framed by the onboarding layout",
  "app/(marketing)/card/[username]/[slug]/page.tsx": "CardDetailContent's 6xl frame (HAND_FRAMES_ALLOWED)",
  "app/(marketing)/card/[username]/page.tsx": "a redirect",
};

const FRAME_OWNER = /<(?:PageContainer|DashboardShell|LegalPageShell)\b/;

/** The modules a source imports from app/ or components/, as file paths. */
function importsOf(path: string): string[] {
  const out: string[] = [];
  for (const [, spec] of read(path).matchAll(/from\s+"([^"]+)"/g)) {
    const base = spec.startsWith("@/")
      ? spec.slice(2)
      : spec.startsWith(".")
        ? normalize(join(dirname(path), spec))
        : null;
    if (!base || !/^(app|components)\//.test(base)) continue;
    const found = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`].find((p) => existsSync(p));
    if (found) out.push(found);
  }
  return out;
}

/** Whether a module draws a frame — itself or through what it imports. */
function drawsFrame(path: string, depth = 0, seen = new Set<string>()): boolean {
  if (seen.has(path)) return false;
  seen.add(path);
  if (FRAME_OWNER.test(read(path))) return true;
  if (depth >= 3) return false;
  return importsOf(path).some((dep) => drawsFrame(dep, depth + 1, seen));
}

describe("PageContainer is the one page frame (TODO WD1)", () => {
  it("no class list outside PageContainer is a hand-written page frame", () => {
    const offenders = files
      .filter((path) => path !== "components/layout/page-container.tsx" && !(path in HAND_FRAMES_ALLOWED))
      .flatMap((path) => handFrames(read(path)).map((list) => `${path}: ${list}`));
    expect(offenders).toEqual([]);
  });

  it("the allowed hand-written frames still are (no stale entry)", () => {
    for (const path of Object.keys(HAND_FRAMES_ALLOWED)) {
      expect(handFrames(read(path)).length, path).toBeGreaterThan(0);
    }
  });

  it("the frame scan recognises a hand-written frame in any order, and nothing narrower", () => {
    expect(handFrames(`<div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">`)).toHaveLength(1);
    expect(handFrames(`const FRAME = "py-12 lg:px-8 max-w-[1920px] mx-auto w-full";`)).toHaveLength(1);
    expect(handFrames(`<div className="mx-auto w-full max-w-2xl px-4 py-16">`)).toEqual([]);
    expect(handFrames(`<section className="mt-14 flex max-w-7xl flex-col gap-6">`)).toEqual([]);
  });

  it("every page gets its frame from PageContainer, or is listed with the reason it draws none", () => {
    const pages = files.filter((path) => path.endsWith("/page.tsx"));
    const unframed = pages.filter((path) => !drawsFrame(path) && !(path in FRAMELESS_PAGES));
    expect(unframed).toEqual([]);
    // A page that gained a frame leaves the list.
    const stale = Object.keys(FRAMELESS_PAGES).filter((path) => !existsSync(path) || drawsFrame(path));
    expect(stale).toEqual([]);
  });

  it("the site header and footer are always wide (owner decision D7)", () => {
    for (const path of ["components/layout/site-header.tsx", "components/layout/site-footer.tsx"]) {
      expect(read(path), path).toMatch(/<PageContainer\s+size="wide"/);
    }
  });
});
