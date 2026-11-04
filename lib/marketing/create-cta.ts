// ---------------------------------------------------------------------------
// The home page's ONE create button (owner 2026-11-04, after the home
// conversion review): the same words on every button that starts a card,
// and a name for each place it sits — the `surface` its create_cta_click carries
// and the signup that may follow remembers (lib/analytics/attribution.ts).
// Plain module: a "use client" file's exported strings reach a server
// component as references, not text.
// ---------------------------------------------------------------------------

/** What every home-page button that starts a card says. */
export const CREATE_CTA_LABEL = "Make a card — free";

/** Where a tracked create button sits. The header's "Create a card" is the
 *  site-wide nav button (its words stay); it is tracked the same way. */
export const CTA_SURFACES = ["home_hero", "home_pulse", "home_final", "header"] as const;
export type CtaSurface = (typeof CTA_SURFACES)[number];

/** The admin funnel panel's words for each surface ("none": the signup
 *  followed no tracked button — a direct visit to /signup, another page). */
export const CTA_SURFACE_LABELS: Record<CtaSurface | "none", string> = {
  home_hero: "Home · hero",
  home_pulse: "Home · under trending",
  home_final: "Home · last band",
  header: "Header · Create a card",
  none: "No tracked button",
};

export function ctaSurfaceLabel(surface: string): string {
  return (CTA_SURFACE_LABELS as Record<string, string>)[surface] ?? surface;
}
