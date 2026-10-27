#!/usr/bin/env node
// Pulls the images CI's e2e job needs for `supabase start` before the CLI
// asks for them, each from the first Supabase mirror that answers (ECR
// Public, GHCR, Docker Hub), in up to four rounds 30 / 60 / 120 s apart —
// see scripts/lib/supabase-images.mjs for why (GHCR's shared throttle,
// 2026-10-27).
//
//   SUPABASE_START_EXCLUDE=studio,imgproxy node scripts/ci-pull-supabase-images.mjs
//
// SUPABASE_START_EXCLUDE is the `-x` list the next step passes to
// `supabase start` (ci.yml sets both from one job variable), and
// SUPABASE_INTERNAL_IMAGE_REGISTRY the registry the CLI pulls from (unset =
// the CLI's default, ECR Public). Always exits 0 once it has run: an image
// it could not fetch is left to `supabase start`, which pulls it as it
// always did (a ::warning:: names it). It exits 1 only on a bad `-x` list.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { imagesFor, parseExcluded, pullAll, registryOf } from "./lib/supabase-images.mjs";

/** One `docker` call, its output collected; never throws. */
export function docker(args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    } catch (error) {
      resolve({ ok: false, output: String(error?.message ?? error) });
      return;
    }
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (error) => resolve({ ok: false, output: `${output}\n${error.message}` }));
    child.on("close", (code, signal) => resolve({ ok: code === 0, output: signal ? `${output}\nkilled by ${signal}` : output }));
  });
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   run?: (args: string[]) => Promise<{ ok: boolean, output: string }>,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 * }} [opts]
 */
export async function main({ env = process.env, run = docker, sleep, log = console.log } = {}) {
  let images;
  try {
    images = imagesFor(parseExcluded(env.SUPABASE_START_EXCLUDE));
  } catch (error) {
    log(`::error::${error.message}`);
    return 1;
  }
  const registry = registryOf(env);
  log(`Pulling ${images.length} Supabase image(s) for ${registry}`);
  const missing = await pullAll({ images, registry, docker: run, sleep, log });
  if (missing.length > 0) {
    log(`::warning::No mirror served ${missing.join(", ")}; leaving ${missing.length === 1 ? "it" : "them"} to supabase start`);
  } else {
    log("Every image is present; supabase start pulls nothing");
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
