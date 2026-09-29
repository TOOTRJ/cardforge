import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Where the admin frame preview (TODO 2.1) may and may not reach, pinned in
// the sources:
//   * the guest creator is the static ISR page — it never reads searchParams,
//     so ?previewFrames can't reach it, and it keeps the public verified set;
//   * /create and /card/<slug>/edit decide the mode from the server-read
//     profile's is_admin, never from anything in the URL.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("admin frame preview surfaces", () => {
  it("the guest ISR creator never reads the URL and keeps the verified set", () => {
    const guest = read("app/(marketing)/create-guest/page.tsx");
    expect(guest).not.toMatch(/searchParams/);
    expect(guest).not.toMatch(/previewFrames|resolveFramePreviewMode/);
    expect(guest).toMatch(/getVerifiedFrameKeysPublic\(\)/);
    expect(guest).toMatch(/export const revalidate = \d+/);
  });

  it.each(["app/(app)/create/page.tsx", "app/(app)/card/[username]/edit/page.tsx"])(
    "%s gates the preview on the profile's is_admin",
    (path) => {
      const page = read(path);
      expect(page).toMatch(/resolveFramePreviewMode\(\{\s*isAdmin(: Boolean\(profile\?\.is_admin\))?,/);
      expect(page).toMatch(/Boolean\(profile\?\.is_admin\)/);
    },
  );
});
