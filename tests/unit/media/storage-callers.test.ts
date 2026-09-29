import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Who may call Supabase Storage (migration 0126). Users hold no write policy
// on storage.objects any more, so every write is server code using the
// service role — and the one door into a user's folder is
// lib/media/user-storage.ts, which forces the `{userId}/` path. This keeps it
// that way at the source level:
//
//   * no browser module ("use client", or anything using the browser client
//     in lib/supabase/client.ts) touches `.storage` — no direct upload,
//     remove, signed upload URL…;
//   * Storage is called from a short list of server-only modules, each on
//     the service-role client — a new caller has to be added here on purpose
//     (a user-folder write belongs in lib/media/user-storage.ts).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

/** Server-only modules allowed to call `.storage`, and why. Card renders are
 *  NOT here on purpose: every bake upload / delete (save bake, admin sweep,
 *  card delete, go-private, moderation hide, frame-preview delete) goes
 *  through lib/cards/bake-core.ts, which only ever opens the owner's folder
 *  with userFolder() — no caller holds a service-role storage client. */
const STORAGE_CALLERS: Record<string, string> = {
  "lib/media/user-storage.ts": "the user-folder door: service role, `{userId}/{name}` keys only",
  "lib/account/actions.ts": "account deletion lists and empties the user's folders (service role, after its own auth check)",
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source without comments, so prose that mentions `.storage` doesn't count. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const firstStatement = (src: string) => src.trimStart().split("\n")[0].trim();
const isClientModule = (src: string) => /^["']use client["'];?$/.test(firstStatement(src));
const isServerOnly = (rel: string, src: string) =>
  /^["']use server["'];?$/.test(firstStatement(src)) ||
  /^import\s+["']server-only["'];?$/m.test(src) ||
  /^app\/.*\/route\.ts$/.test(rel);

/** Any reach for a Supabase client's Storage API: member access (`.storage`,
 *  `?.storage`), destructuring (`const { storage } = client`,
 *  `{ storage: s } =`), bracket access (`client["storage"]`) and the
 *  signed-upload helpers. */
const USES_STORAGE =
  /\.storage\b|\{[^{}]*\bstorage\b[^{}]*\}\s*=[^=>]|\[\s*["'`]storage["'`]\s*\]|createSignedUploadUrl|uploadToSignedUrl/;

const files = ["app", "components", "lib", "hooks"]
  .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
  .concat(existsSync(path.join(ROOT, "proxy.ts")) ? [path.join(ROOT, "proxy.ts")] : [])
  .map((file) => ({ rel: path.relative(ROOT, file).split(path.sep).join("/"), src: code(file) }));

describe("the storage matcher", () => {
  it.each([
    ["member access", "await supabase.storage.from('card-art').upload(k, b)"],
    ["optional member access", "client?.storage?.from(bucket)"],
    ["destructuring", "const { storage } = await createClient();"],
    ["destructuring with a rename", "const { auth, storage: files } = supabase;"],
    ["bracket access", 'const s = supabase["storage"];'],
    ["a signed upload URL", "await bucket.createSignedUploadUrl(path)"],
  ])("sees %s", (_label, snippet) => {
    expect(USES_STORAGE.test(snippet)).toBe(true);
  });

  it.each([
    ["localStorage", "window.localStorage.getItem(key)"],
    ["the storage event", 'window.addEventListener("storage", onChange);'],
    ["a storage-paths import", 'import { cardRenderPath } from "@/lib/cards/storage-paths";'],
    ["prose in a string", 'return { ok: false, error: "Render storage is unavailable." };'],
    ["a type named after it", "import { isUserStorageConfigured } from \"@/lib/media/user-storage\";"],
  ])("ignores %s", (_label, snippet) => {
    expect(USES_STORAGE.test(snippet)).toBe(false);
  });
});

describe("Supabase Storage callers", () => {
  it("scans the app", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no browser module touches storage", () => {
    const offenders = files
      .filter(({ src }) => isClientModule(src) || /from\s+["']@\/lib\/supabase\/client["']/.test(src))
      .filter(({ src }) => USES_STORAGE.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only the listed server-only modules call storage", () => {
    const callers = files.filter(({ src }) => USES_STORAGE.test(src)).map(({ rel }) => rel).sort();
    expect(callers).toEqual(Object.keys(STORAGE_CALLERS).sort());
    for (const { rel, src } of files.filter((f) => f.rel in STORAGE_CALLERS)) {
      expect(isServerOnly(rel, src), `${rel} must be server-only`).toBe(true);
      expect(isClientModule(src), rel).toBe(false);
    }
  });

  it("the user-folder door uses the service-role client, never a user's", () => {
    const src = files.find((f) => f.rel === "lib/media/user-storage.ts")!.src;
    expect(src).toMatch(/from\s+["']@\/lib\/supabase\/admin["']/);
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client|public)["']/);
  });

  it("no browser module imports the user-folder door", () => {
    const offenders = files
      .filter(({ src }) => isClientModule(src) && /@\/lib\/media\/user-storage["']/.test(src))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
