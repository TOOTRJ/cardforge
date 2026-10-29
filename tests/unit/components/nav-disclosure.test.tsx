// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The header's panels are a WAI-ARIA DISCLOSURE (TODO NV1), never a
// role="menu": a button with aria-expanded / aria-controls, its panel right
// after it, click to open (no hover), one open at a time, Escape closes and
// hands focus back to the button, a press outside or focus leaving closes it.
// A closed panel is `hidden` but still in the DOM — its links are in the
// static HTML.
// ---------------------------------------------------------------------------

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { HeaderDisclosures, NavDisclosure } from "@/components/layout/nav-disclosure";

afterEach(() => {
  cleanup();
  pathname = "/";
});

function Header() {
  return (
    <HeaderDisclosures>
      <NavDisclosure id="community" label="Community">
        <a href="/t/gallery">Card gallery</a>
        <a href="/t/decks">Community decks</a>
      </NavDisclosure>
      <NavDisclosure id="learn" label="Learn">
        <a href="/t/articles">All articles</a>
      </NavDisclosure>
      <button type="button">Elsewhere</button>
    </HeaderDisclosures>
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const panelOf = (name: string) => document.getElementById(button(name).getAttribute("aria-controls")!)!;

describe("NavDisclosure", () => {
  it("is a button that controls a hidden panel — no menu roles — and the links stay in the DOM", () => {
    render(<Header />);
    const community = button("Community");
    expect(community.getAttribute("aria-expanded")).toBe("false");
    const panel = panelOf("Community");
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(true);
    // Hidden, still rendered: crawlers and a no-JS reader get the links.
    expect(panel.querySelector('a[href="/t/gallery"]')).toBeTruthy();
    // The panel follows its button in the DOM (Tab walks into it).
    expect(community.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
  });

  it("opens on click, and only one panel is open at a time", () => {
    render(<Header />);
    fireEvent.click(button("Community"));
    expect(button("Community").getAttribute("aria-expanded")).toBe("true");
    expect(panelOf("Community").hidden).toBe(false);
    fireEvent.click(button("Learn"));
    expect(button("Learn").getAttribute("aria-expanded")).toBe("true");
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
    expect(panelOf("Community").hidden).toBe(true);
    fireEvent.click(button("Learn"));
    expect(panelOf("Learn").hidden).toBe(true);
  });

  it("never opens on hover", () => {
    render(<Header />);
    fireEvent.mouseEnter(button("Community"));
    fireEvent.pointerEnter(button("Community"));
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the open panel and puts focus back on its button", () => {
    render(<Header />);
    fireEvent.click(button("Community"));
    const link = screen.getByRole("link", { name: "Card gallery" });
    link.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button("Community"));
  });

  it("a press outside closes it; a press inside doesn't", () => {
    render(<Header />);
    fireEvent.click(button("Community"));
    fireEvent.pointerDown(panelOf("Community"));
    expect(button("Community").getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(document.body);
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
  });

  it("focus moving out of the button and its panel closes it", () => {
    render(<Header />);
    fireEvent.click(button("Community"));
    const link = screen.getByRole("link", { name: "Community decks" });
    // Within the disclosure: stays open.
    fireEvent.blur(button("Community"), { relatedTarget: link });
    expect(button("Community").getAttribute("aria-expanded")).toBe("true");
    // Out of it (Tab past the last link): closes, focus untouched.
    fireEvent.blur(link, { relatedTarget: button("Elsewhere") });
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
  });

  it("following a link closes the panel — the page you're on too", () => {
    render(<Header />);
    fireEvent.click(button("Community"));
    fireEvent.click(screen.getByRole("link", { name: "Card gallery" }));
    expect(button("Community").getAttribute("aria-expanded")).toBe("false");
  });

  it("a navigation closes whatever was open", () => {
    const { rerender } = render(<Header />);
    fireEvent.click(button("Learn"));
    pathname = "/articles";
    act(() => rerender(<Header />));
    expect(button("Learn").getAttribute("aria-expanded")).toBe("false");
  });

  it("a lone disclosure keeps its own state", () => {
    render(
      <NavDisclosure id="account" label="Account" ariaLabel="Open account menu">
        <a href="/login">Sign in</a>
      </NavDisclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Open account menu" });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
