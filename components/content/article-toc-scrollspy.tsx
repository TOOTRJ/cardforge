"use client";

import { useEffect } from "react";

// Highlights the sidebar TOC entry for the heading currently in view. Pure
// enhancement: the links are server-rendered anchors and work without this.
export function ArticleTocScrollSpy({ ids }: { ids: string[] }) {
  useEffect(() => {
    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;
    const links = new Map(
      ids.map((id) => [
        id,
        document.querySelector<HTMLAnchorElement>(
          `[data-article-toc="sidebar"] [data-toc-link="${CSS.escape(id)}"]`,
        ),
      ]),
    );
    const setActive = (id: string | null) => {
      for (const [key, link] of links) {
        link?.setAttribute("data-active", key === id ? "true" : "false");
      }
    };
    // The active heading is the last one whose top has scrolled past the
    // sticky header offset — stable while reading, no flicker between
    // adjacent sections.
    const OFFSET = 112;
    let ticking = false;
    const update = () => {
      ticking = false;
      let current: string | null = null;
      for (const el of headings) {
        if (el.getBoundingClientRect().top - OFFSET <= 0) current = el.id;
        else break;
      }
      setActive(current ?? headings[0].id);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);
  return null;
}
