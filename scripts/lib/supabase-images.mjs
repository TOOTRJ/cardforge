// ---------------------------------------------------------------------------
// The images CI's e2e job needs for `supabase start`, pulled BEFORE the CLI
// asks for them (scripts/ci-pull-supabase-images.mjs). Dependency-free: it
// only spawns `docker`.
//
// Why (2026-10-27, run 40544048050 on PR #611, and PR #604 the week before):
// supabase/setup-cli@v1 pins every CLI from 1.28.0 to 2.107.x to GHCR
// (`SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io`), and CLI 2.84.2 pulls from that
// ONE registry with no fallback — two tries 4 s and 8 s apart. GHCR answered
// `toomanyrequests: retry-after: 550µs, allowed: 44000/minute` for 35 s
// straight across both of the job's attempts. 44 000 a minute is not a limit
// our dozen requests reach: it is a bucket shared with other runners, kept
// empty by them (a sub-millisecond retry-after is one token's refill). Waiting
// a few seconds does not help; another registry does.
//
// GHCR's throttle is not the runners' alone: the same morning a Mac on a
// home line got the same answer for every supabase/* image on GHCR, while
// Docker Hub served all of them and ECR Public served most.
//
// So every image is tried on every mirror Supabase publishes it to — the
// registry the CLI is told to use first, then the others (CLI 2.108+ falls
// back the same way: ECR Public → GHCR → Docker Hub) — in up to four rounds
// 30 / 60 / 120 s apart, and a copy pulled from another mirror is TAGGED with
// the name the CLI looks for. The CLI's own pull is "missing only" (compose
// PullPolicyMissing, then an inspect before each pull), so it then pulls
// nothing. Anything still missing is left to the CLI: never worse than before.
// ---------------------------------------------------------------------------

/** The CLI version the list below was read from (its pkg/config/templates/Dockerfile). */
export const SUPABASE_CLI_VERSION = "2.84.2";

/**
 * Every SERVICE image of that CLI, by the short name `supabase start -x`
 * takes (the image's last path part, tag dropped). The job/tool images
 * (migra, pg_prove, schema diff) are never pulled by `start`.
 * tests/unit/devops/supabase-images.test.ts holds this to ci.yml: the
 * workflow's CLI version, and the services its `-x` leaves running.
 */
export const SERVICE_IMAGES = {
  postgres: "supabase/postgres:17.6.1.095",
  kong: "library/kong:2.8.1",
  mailpit: "axllent/mailpit:v1.22.3",
  postgrest: "postgrest/postgrest:v14.7",
  "postgres-meta": "supabase/postgres-meta:v0.96.1",
  studio: "supabase/studio:2026.03.23-sha-b7847b7",
  imgproxy: "darthsim/imgproxy:v3.8.0",
  "edge-runtime": "supabase/edge-runtime:v1.73.0",
  vector: "timberio/vector:0.53.0-alpine",
  supavisor: "supabase/supavisor:2.7.4",
  gotrue: "supabase/gotrue:v2.188.1",
  realtime: "supabase/realtime:v2.78.18",
  "storage-api": "supabase/storage-api:v1.44.11",
  logflare: "supabase/logflare:1.34.14",
};

/** The CLI's default registry when SUPABASE_INTERNAL_IMAGE_REGISTRY is unset. */
export const DEFAULT_REGISTRY = "public.ecr.aws";

/** The mirrors Supabase publishes its images to, in the CLI's own fallback order. */
export const MIRRORS = ["public.ecr.aws", "ghcr.io", "docker.io"];

/** The waits before rounds 2, 3 and 4 (ms). */
export const ROUND_DELAYS_MS = [30_000, 60_000, 120_000];

/** The registry the CLI pulls from: its env, lower-cased, else ECR Public. */
export function registryOf(env) {
  const value = typeof env?.SUPABASE_INTERNAL_IMAGE_REGISTRY === "string" ? env.SUPABASE_INTERNAL_IMAGE_REGISTRY.trim() : "";
  return value ? value.toLowerCase() : DEFAULT_REGISTRY;
}

/**
 * The name an image has on a registry — what CLI 2.84.2's
 * `GetRegistryImageUrl` builds: Docker Hub keeps the image's own name, any
 * other registry is `<registry>/supabase/<last part>`.
 */
export function imageOn(registry, image) {
  if (registry === "docker.io") return image;
  const last = image.split("/").pop();
  return `${registry}/supabase/${last}`;
}

/** The images the stack starts with, given the `-x` list. Throws on a name the CLI does not know. */
export function imagesFor(excluded) {
  for (const name of excluded) {
    if (name === "postgres" || !(name in SERVICE_IMAGES)) throw new Error(`"${name}" is not a service \`supabase start -x\` can leave out (CLI ${SUPABASE_CLI_VERSION})`);
  }
  return Object.entries(SERVICE_IMAGES)
    .filter(([name]) => !excluded.includes(name))
    .map(([, image]) => image);
}

/**
 * Where to look for one image, in order: the CLI's registry first, then the
 * other mirrors. Each entry says what to pull and the name the CLI will
 * look for (`target`) — a pull from another mirror is tagged with it.
 */
export function sourcesOf(image, registry) {
  const order = [registry, ...MIRRORS.filter((m) => m !== registry)];
  const target = imageOn(registry, image);
  return order.map((r) => ({ registry: r, ref: imageOn(r, image), target }));
}

/** "studio,imgproxy" → ["studio", "imgproxy"]. */
export function parseExcluded(list) {
  return String(list ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Pull every image, each from the first mirror that answers, in rounds.
 * Returns the images still missing (empty = all present).
 *
 * @param {{
 *   images: string[],
 *   registry: string,
 *   docker: (args: string[]) => Promise<{ ok: boolean, output: string }>,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 *   delaysMs?: number[],
 *   concurrency?: number,
 * }} opts
 *
 * One pull at a time by default: ECR Public's anonymous quota is per IP and
 * tight ("Rate exceeded" on manifest reads 2.5 s apart, 2026-10-27), and
 * Postgres's image is most of the bytes anyway.
 */
export async function pullAll({ images, registry, docker, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log, delaysMs = ROUND_DELAYS_MS, concurrency = 1 }) {
  let missing = [];
  for (const image of images) {
    const { target } = sourcesOf(image, registry)[0];
    if ((await docker(["image", "inspect", "--format", "{{.Id}}", target])).ok) log(`${target}: already present`);
    else missing.push(image);
  }

  const rounds = delaysMs.length + 1;
  for (let round = 1; round <= rounds && missing.length > 0; round += 1) {
    if (round > 1) {
      const wait = delaysMs[round - 2];
      log(`${missing.length} image(s) still missing; round ${round} of ${rounds} in ${wait / 1000} s`);
      await sleep(wait);
    }
    const queue = [...missing];
    const failed = [];
    const worker = async () => {
      for (let image = queue.shift(); image !== undefined; image = queue.shift()) {
        if (!(await pullOne(image, registry, docker, log))) failed.push(image);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
    missing = images.filter((image) => failed.includes(image));
  }
  return missing;
}

async function pullOne(image, registry, docker, log) {
  for (const { ref, target } of sourcesOf(image, registry)) {
    const pulled = await docker(["pull", "--quiet", ref]);
    if (!pulled.ok) {
      log(`${ref}: ${lastLine(pulled.output)}`);
      continue;
    }
    if (ref !== target) {
      const tagged = await docker(["tag", ref, target]);
      if (!tagged.ok) {
        log(`${ref} → ${target}: tag failed: ${lastLine(tagged.output)}`);
        continue;
      }
      log(`${target}: pulled from ${ref}`);
    } else {
      log(`${target}: pulled`);
    }
    return true;
  }
  return false;
}

function lastLine(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "failed";
}
