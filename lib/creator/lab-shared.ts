// Creator lab — the hidden second create walkthrough (owner decision
// 2026-09-16: build the click-to-edit "canvas" layout without touching the
// current stepper, behind an admin switch so it can be previewed and tested
// before anyone else sees it). Pure + client-safe.

export const CREATOR_LAB_MODES = ["off", "admins", "everyone"] as const;
export type CreatorLabMode = (typeof CREATOR_LAB_MODES)[number];

export const CREATOR_LAB_MODE_LABELS: Record<CreatorLabMode, string> = {
  off: "Off — nobody sees it",
  admins: "Admins only — preview and test",
  everyone: "Everyone — offered as an option on /create",
};

export const DEFAULT_CREATOR_LAB_MODE: CreatorLabMode = "off";

export function isCreatorLabMode(value: unknown): value is CreatorLabMode {
  return (CREATOR_LAB_MODES as readonly unknown[]).includes(value);
}

/** Whether this viewer may switch to the canvas layout. */
export function canUseCreatorLab(mode: CreatorLabMode, isAdmin: boolean): boolean {
  if (mode === "everyone") return true;
  if (mode === "admins") return isAdmin;
  return false;
}

/** The two creator layouts. "stepper" is the shipped one; "canvas" is the
 *  lab's centred live preview with clickable regions. */
export type CreatorLayout = "stepper" | "canvas";

/** Resolve the layout for a request: the lab must be allowed for the viewer
 *  AND asked for (?lab=1) — nobody is switched without opting in. */
export function resolveCreatorLayout(
  allowed: boolean,
  labParam: string | undefined,
): CreatorLayout {
  return allowed && labParam === "1" ? "canvas" : "stepper";
}
