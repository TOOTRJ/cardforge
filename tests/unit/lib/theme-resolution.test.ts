import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyThemeToDocument,
  noFlashScript,
  readThemeCookieClient,
  resolveSavedTheme,
  resolveTheme,
} from "@/lib/theme-shared";

// ---------------------------------------------------------------------------
// ONE theme resolution, in two forms: the inline <head> script (a string — it
// runs before anything is loaded) and resolveSavedTheme() (what ThemeRestore
// re-applies on a document the browser rendered, and what the Settings
// control paints with).
//
// They must agree in EVERY case, not only the three real values: ThemeRestore
// runs on every page right after hydration and writes whenever <html> does
// not carry what the function answers — so one case where the function
// disagreed with the script would repaint that page in the other palette.
// (Before 2026-10 they did disagree: an unknown value followed the OS in the
// script and was "dark" in the reader, and a value that cannot be decoded
// made the reader throw.)
//
// Each case runs the REAL script in an empty context holding only a fake
// document + window, and asks the function the same question.
// ---------------------------------------------------------------------------

type Os = "light" | "dark" | "no matchMedia" | "matchMedia throws";
const OSES: Os[] = ["light", "dark", "no matchMedia", "matchMedia throws"];

function browser(cookie: string | Error, os: Os) {
  // The server's HTML always ships data-theme="dark".
  const documentElement = { dataset: { theme: "dark" } as Record<string, string> };
  const document = {
    documentElement,
    get cookie(): string {
      if (cookie instanceof Error) throw cookie;
      return cookie;
    },
  };
  const window =
    os === "no matchMedia"
      ? {}
      : {
          matchMedia(query: string) {
            if (os === "matchMedia throws") throw new Error("no media queries here");
            return { matches: query === `(prefers-color-scheme: ${os})` };
          },
        };
  return { document, window, documentElement };
}

/** What the <head> script leaves on <html data-theme>. */
function scriptTheme(cookie: string | Error, os: Os): string {
  const { document, window, documentElement } = browser(cookie, os);
  runInNewContext(noFlashScript(), { document, window });
  return documentElement.dataset.theme;
}

/** Run `read` as code in that same browser. */
function inBrowser<T>(cookie: string | Error, os: Os, read: () => T): T {
  const { document, window } = browser(cookie, os);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  try {
    return read();
  } finally {
    vi.unstubAllGlobals();
  }
}

afterEach(() => vi.unstubAllGlobals());

// [what the visitor has, document.cookie, on a light OS, on a dark OS]
const CASES: [string, string | Error, "light" | "dark", "light" | "dark"][] = [
  ["no cookie at all", "", "dark", "dark"],
  ["only other cookies", "sb-auth-token=abc; _ga=GA1.1.2", "dark", "dark"],
  ["dark", "cardforge-theme=dark", "dark", "dark"],
  ["light", "cardforge-theme=light", "light", "light"],
  ["system", "cardforge-theme=system", "light", "dark"],
  ["light among other cookies", "sb-auth-token=abc; cardforge-theme=light; _ga=GA1.1.2", "light", "light"],
  ["a percent-encoded light", "cardforge-theme=li%67ht", "light", "light"],
  ["an unknown value (follows the OS, like system)", "cardforge-theme=sepia", "light", "dark"],
  ["another letter case (an unknown value)", "cardforge-theme=LIGHT", "light", "dark"],
  ["an empty value (no cookie)", "cardforge-theme=", "dark", "dark"],
  ["a look-alike name", "xcardforge-theme=light", "dark", "dark"],
  ["the cookie twice (the first wins)", "cardforge-theme=dark; cardforge-theme=light", "dark", "dark"],
  ["a value that cannot be decoded", "cardforge-theme=%E0%A4%A", "dark", "dark"],
  ["a cookie jar that cannot be read", new Error("SecurityError"), "dark", "dark"],
];

describe("the saved theme: the <head> script and resolveSavedTheme() are one resolution", () => {
  for (const [label, cookie, onLightOs, onDarkOs] of CASES) {
    it(label, () => {
      expect(scriptTheme(cookie, "light"), "the script, light OS").toBe(onLightOs);
      expect(scriptTheme(cookie, "dark"), "the script, dark OS").toBe(onDarkOs);
      for (const os of OSES) {
        expect(inBrowser(cookie, os, resolveSavedTheme), `the function, ${os}`).toBe(
          scriptTheme(cookie, os),
        );
      }
    });
  }

  it("without matchMedia, or with one that throws, only an explicit light is light", () => {
    for (const os of ["no matchMedia", "matchMedia throws"] as const) {
      expect(scriptTheme("cardforge-theme=light", os)).toBe("light");
      expect(scriptTheme("cardforge-theme=system", os)).toBe("dark");
      expect(scriptTheme("cardforge-theme=sepia", os)).toBe("dark");
    }
  });
});

describe("readThemeCookieClient — the preference the Settings control shows", () => {
  it("names the three preferences; anything else is what it behaves as", () => {
    const read = (cookie: string | Error) => inBrowser(cookie, "light", readThemeCookieClient);
    expect(read("")).toBe("dark");
    expect(read("cardforge-theme=dark")).toBe("dark");
    expect(read("cardforge-theme=light")).toBe("light");
    expect(read("cardforge-theme=system")).toBe("system");
    // The page follows the OS for these, so the control must not claim "Dark".
    expect(read("cardforge-theme=sepia")).toBe("system");
  });

  it("never throws: it runs in the root layout of every page", () => {
    expect(inBrowser("cardforge-theme=%E0%A4%A", "light", readThemeCookieClient)).toBe("dark");
    expect(inBrowser(new Error("SecurityError"), "light", readThemeCookieClient)).toBe("dark");
  });
});

describe("outside the browser", () => {
  it("everything answers the server's dark and touches nothing", () => {
    expect(typeof document).toBe("undefined");
    expect(readThemeCookieClient()).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveSavedTheme()).toBe("dark");
    expect(() => applyThemeToDocument("light")).not.toThrow();
  });
});

describe("applyThemeToDocument", () => {
  it("writes the resolved theme on <html data-theme>", () => {
    const paint = (theme: "dark" | "light" | "system", os: Os) => {
      const { document, window, documentElement } = browser("", os);
      vi.stubGlobal("document", document);
      vi.stubGlobal("window", window);
      applyThemeToDocument(theme);
      vi.unstubAllGlobals();
      return documentElement.dataset.theme;
    };
    expect(paint("light", "dark")).toBe("light");
    expect(paint("dark", "light")).toBe("dark");
    expect(paint("system", "light")).toBe("light");
    expect(paint("system", "dark")).toBe("dark");
    expect(paint("system", "no matchMedia")).toBe("dark");
  });
});
