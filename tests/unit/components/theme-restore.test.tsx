// @vitest-environment happy-dom
import { useLayoutEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ThemeRestore } from "@/components/layout/theme-restore";
import { noFlashScript } from "@/lib/theme-shared";

// ---------------------------------------------------------------------------
// <ThemeRestore>: the saved theme on a document the BROWSER rendered.
//
// The <head> no-flash script only runs in HTML the server sent. A notFound()
// thrown above the Suspense boundaries is answered with Next's empty
// <html id="__next_error__"> shell and React renders the whole document on
// the client: it never executes the script it creates there, and it writes
// <html data-theme="dark"> from the root layout's props. A light-theme
// visitor got a dark 404 (2026-10).
//
// The last block renders a root layout's document the way Next's client does
// for that shell — createRoot(document) — with the real React: what it holds
// is the order inside that commit (React's write, then the restore). That a
// browser does not run the script is tests/e2e/marketing-auth-chrome.spec.ts,
// frame by frame; happy-dom runs no script at all.
// ---------------------------------------------------------------------------

const html = () => document.documentElement;

function visitor({ cookie = "", os = "dark" }: { cookie?: string; os?: "light" | "dark" }) {
  vi.spyOn(document, "cookie", "get").mockReturnValue(cookie);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === `(prefers-color-scheme: ${os})`,
  }));
}

/** Every write to <html data-theme> from now on, same value or not. */
function themeWrites() {
  const observer = new MutationObserver(() => {});
  observer.observe(html(), { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.takeRecords().length;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const attribute of [...html().attributes]) html().removeAttribute(attribute.name);
});

describe("ThemeRestore", () => {
  it("puts the saved light theme back on a document that carries the layout's dark", () => {
    html().dataset.theme = "dark";
    visitor({ cookie: "cardforge-theme=light" });
    const writes = themeWrites();
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("light");
    expect(writes()).toBe(1);
  });

  it("writes nothing where the <head> script already did it (every server-rendered page)", () => {
    html().dataset.theme = "light";
    visitor({ cookie: "cardforge-theme=light" });
    const writes = themeWrites();
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("light");
    expect(writes()).toBe(0);
  });

  it("no saved theme is dark, whatever the OS prefers — it writes nothing", () => {
    html().dataset.theme = "dark";
    visitor({ os: "light" });
    const writes = themeWrites();
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("dark");
    expect(writes()).toBe(0);
  });

  it("\"system\" follows the OS", () => {
    html().dataset.theme = "dark";
    visitor({ cookie: "cardforge-theme=system", os: "light" });
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("light");

    cleanup();
    vi.restoreAllMocks();
    visitor({ cookie: "cardforge-theme=system", os: "dark" });
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("dark");
  });

  it("a saved dark wins over a light OS, and over a stale light on the document", () => {
    html().dataset.theme = "light";
    visitor({ cookie: "cardforge-theme=dark", os: "light" });
    render(<ThemeRestore />);
    expect(html().dataset.theme).toBe("dark");
  });

  it("a cookie that cannot be decoded does not take the page down — it is the default dark", () => {
    html().dataset.theme = "dark";
    visitor({ cookie: "cardforge-theme=%E0%A4%A", os: "light" });
    expect(() => render(<ThemeRestore />)).not.toThrow();
    expect(html().dataset.theme).toBe("dark");
  });

  it("renders nothing, on the server and in the browser", () => {
    expect(renderToString(<ThemeRestore />)).toBe("");
    visitor({});
    const { container } = render(<ThemeRestore />);
    expect(container.innerHTML).toBe("");
  });
});

describe("a document React renders in the browser (Next's client on a notFound() shell)", () => {
  /** The root layout's skeleton: app/layout.tsx. */
  function RootLayout({ restore, children }: { restore: boolean; children?: ReactNode }) {
    return (
      <html lang="en" data-theme="dark">
        {/* eslint-disable-next-line @next/next/no-head-element -- an App Router root layout's own <head> */}
        <head>
          <script dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
          {restore ? <ThemeRestore /> : null}
        </head>
        <body>
          <h1>404 — That card isn&apos;t in the forge.</h1>
          {children}
        </body>
      </html>
    );
  }

  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
  });

  /** What the server sent: `<html id="__next_error__">`, no theme anywhere. */
  function errorShell() {
    html().id = "__next_error__";
    expect(html().hasAttribute("data-theme")).toBe(false);
  }

  it("without ThemeRestore, <html> is left with the layout's dark — the bug", async () => {
    errorShell();
    visitor({ cookie: "cardforge-theme=light" });
    root = createRoot(document);
    await act(async () => root!.render(<RootLayout restore={false} />));

    // React took <html> over: the shell's id is gone, the props are on it.
    expect(html().id).toBe("");
    expect(document.querySelector("h1")?.textContent).toMatch(/^404/);
    expect(html().dataset.theme).toBe("dark");
  });

  it("with ThemeRestore, the saved theme is on <html> when that commit is done", async () => {
    errorShell();
    visitor({ cookie: "cardforge-theme=light" });
    root = createRoot(document);
    await act(async () => root!.render(<RootLayout restore />));

    expect(html().id).toBe("");
    expect(document.querySelector("h1")?.textContent).toMatch(/^404/);
    expect(html().dataset.theme).toBe("light");
  });

  it("…before the browser can paint: the page's own layout effects already see it", async () => {
    // A passive effect would run after the frame was painted dark; this is
    // what tells the two apart without a browser.
    const seen: (string | undefined)[] = [];
    function Page() {
      useLayoutEffect(() => {
        seen.push(html().dataset.theme);
      }, []);
      return null;
    }
    errorShell();
    visitor({ cookie: "cardforge-theme=light" });
    root = createRoot(document);
    await act(async () =>
      root!.render(
        <RootLayout restore>
          <Page />
        </RootLayout>,
      ),
    );
    expect(seen).toEqual(["light"]);
  });

  it("…and again when React takes <html> over again", async () => {
    errorShell();
    visitor({ cookie: "cardforge-theme=light" });
    root = createRoot(document);
    await act(async () => root!.render(<RootLayout restore />));
    expect(html().dataset.theme).toBe("light");

    // The root layout unmounts (React hands <html> back, bare) and mounts again.
    await act(async () => root!.unmount());
    expect(html().hasAttribute("data-theme")).toBe(false);
    root = createRoot(document);
    await act(async () => root!.render(<RootLayout restore />));
    expect(html().dataset.theme).toBe("light");
  });

  it("a visitor with no saved theme gets the layout's dark there, on a light OS too", async () => {
    errorShell();
    visitor({ os: "light" });
    root = createRoot(document);
    await act(async () => root!.render(<RootLayout restore />));
    expect(html().dataset.theme).toBe("dark");
  });
});
