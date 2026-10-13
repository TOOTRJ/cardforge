// ---------------------------------------------------------------------------
// What the two halves of the parity suite (TODO 3.11) agree on — the bake
// stage (tests/parity/bake.parity.ts, vitest) and the browser stage
// (tests/parity/preview.parity.spec.ts, Playwright). No imports: Playwright's
// loader and vitest both read it.
// ---------------------------------------------------------------------------

/** The harness's dev server (never 3000 / 3100: a developer's own servers). */
export const PARITY_PORT = 3187;

/** The page that mounts CardPreview (app/dev/parity/page.parity.tsx). */
export const PARITY_PATH = "/dev/parity";

/**
 * The storage host the harness server is told it has
 * (NEXT_PUBLIC_SUPABASE_URL). Nothing listens there: the browser stage
 * answers every request to it from local files, and CardPreview accepts the
 * art URLs below as the deployment's own storage objects
 * (lib/media/media-urls.ts) — as it would a real upload.
 */
export const PARITY_STORAGE_ORIGIN = "https://storage.parity.invalid";

/** The frames bucket origin the preview is pointed at (served from the
 *  visual suite's frame cache, tmp/visual/frames/). */
export const PARITY_FRAME_ORIGIN = "https://frames.parity.invalid";

const ART_FOLDER = `${PARITY_STORAGE_ORIGIN}/storage/v1/object/public/card-art/00000000-0000-4000-a000-00000000071a`;

/** The two pictures of the suite as the preview loads them; the bake draws
 *  the same bytes from a data URL. */
export const PARITY_ART_URL = `${ART_FOLDER}/parity-art.png`;
export const PARITY_ART2_URL = `${ART_FOLDER}/parity-art2.png`;
/** The EXIF cases' photo (TODO 3.14): stored sideways with Orientation 6,
 *  and the same file as prepareUploadBytes stores it. */
export const PARITY_TAGGED_JPEG_URL = `${ART_FOLDER}/parity-exif6-stored.jpg`;
export const PARITY_UPLOADED_JPEG_URL = `${ART_FOLDER}/parity-exif6-upload.jpg`;
/** The art files the browser stage may serve from tmp/parity/art/. */
export const PARITY_ART_FILE = /^parity-[a-z0-9-]+\.(png|jpg)$/;

/** Where the bake stage leaves its work for the browser stage (gitignored). */
export const PARITY_DIR = "tmp/parity";

/** The two compared sizes: the 750 px bake against the preview at 750 CSS px,
 *  and the stored HD bake against the same preview on a 2× screen. */
export const PARITY_SIZES = [
  { name: "750", preset: "default", cssWidth: 750, scale: 1 },
  { name: "hd", preset: "hd", cssWidth: 750, scale: 2 },
] as const;

export type ParitySizeName = (typeof PARITY_SIZES)[number]["name"];

/** The page behind the card (the bake's transparent corners are flattened
 *  onto the same grey). */
export const PARITY_BACKDROP = { r: 128, g: 128, b: 128 } as const;

/** File-name-safe form of a case id (the bake's PNGs, the results, and the
 *  case's baseline file: tests/parity/baseline/<platform>/<this>.json). */
export function parityFileName(id: string): string {
  return id.replace(/[/@]/g, "__");
}

/** One case as the bake stage hands it to the browser stage. */
export type ParityCaseFile = {
  /** Its place in tests/parity/cases.ts (the bake runs in shards). */
  index: number;
  id: string;
  file: string;
  why: string;
  face: "front" | "back";
  orientation: "portrait" | "landscape";
  /** CardPreviewData (JSON), art already on the harness's storage URLs. */
  card: Record<string, unknown>;
  regions: { name: string; x: number; y: number; w: number; h: number }[];
};
