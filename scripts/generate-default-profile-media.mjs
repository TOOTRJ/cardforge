#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generates the default profile avatars + banners new accounts are assigned
// (lib/profile/default-media.ts, migration 0095). 25 of each, five per colour
// of mana, painted through the Vercel AI Gateway (FLUX — same model + route
// as lib/ai/image-gen.ts; never a direct provider).
//
//   node scripts/generate-default-profile-media.mjs            # fill gaps
//   node scripts/generate-default-profile-media.mjs --force    # repaint all
//   node scripts/generate-default-profile-media.mjs --only avatar-07,banner-12
//
// Output: public/defaults/avatars/avatar-NN.webp  (512×512)
//         public/defaults/banners/banner-NN.webp  (1600×400, the profile's 4:1)
//
// Resumable: existing files are skipped unless --force/--only names them.
// The subjects are generic fantasy archetypes — no Wizards of the Coast
// characters, symbols, or card frames (Fan Content Policy).
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { experimental_generateImage as generateImage } from "ai";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "defaults");
const MODEL = process.env.AI_IMAGE_MODEL?.trim() || "bfl/flux-2-flex";
const CONCURRENCY = 3;

async function loadEnvLocal() {
  if (process.env.AI_GATEWAY_API_KEY) return;
  try {
    const raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const match = /^\s*(AI_GATEWAY_API_KEY|AI_IMAGE_MODEL)\s*=\s*(.*)\s*$/.exec(line);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env.local — fall through to the missing-key error
  }
}

const AVATAR_STYLE =
  "Square fantasy character portrait, head and shoulders, centered, facing slightly off-camera. Rich painterly digital oil illustration in the style of classic trading card game art, dramatic rim lighting, deep saturated colors, softly blurred background. No text, no letters, no signature, no borders, no frame, no watermark, no logos.";

const BANNER_STYLE =
  "Ultra-wide panoramic fantasy landscape, cinematic composition with the horizon across the middle third, no characters in the foreground. Rich painterly digital oil illustration in the style of classic trading card game land art, atmospheric depth, deep saturated colors. Unsigned artwork: no signature, no artist mark, no text, no letters, no borders, no frame, no watermark, no logos.";

// Five per colour of mana: white, blue, black, red, green.
const AVATARS = [
  // white
  "a serene angel knight in polished silver armor, white feathered wings, warm golden dawn light",
  "a stern human cleric with a shaved head and a sunburst circlet, ivory robes, soft candle glow",
  "a noble white lion with a braided mane and a golden collar, sunlit marble behind",
  "a resolute paladin with short dark hair, a steel gorget and a blue cloak, banners in the wind",
  "a wise old griffin rider in a plumed helm, pale sky and clouds behind",
  // blue
  "a merfolk sorceress with teal scales and fin-like ears, glowing water orbs, deep ocean light",
  "a hooded human wizard with a silver beard, floating arcane sigils, cool moonlit library",
  "a sphinx with sapphire eyes and an enigmatic smile, star-filled twilight sky",
  "a young artificer with brass goggles pushed up on her forehead, blue spark light from a gadget",
  "a spectral drake made of mist and frost, pale blue glow, stormy sea behind",
  // black
  "a pale vampire noble with slicked silver hair and a high crimson collar, candlelit crypt",
  "a necromancer in a bone mask and tattered violet hood, faint green wisps of light",
  "a cunning rat-folk rogue with a notched ear and a dark leather cowl, lantern light in a sewer",
  "a raven-haired witch with a crow on her shoulder, moonlit swamp and dead trees behind",
  "a skeletal knight in rusted black plate with glowing violet eye sockets, fog",
  // red
  "a grinning goblin tinkerer with oversized ears and soot on his face, sparks and firelight",
  "a fierce red dragon head with molten-gold eyes and smoke curling from its nostrils",
  "a barbarian warrior woman with wild copper hair and war paint, volcanic glow",
  "a fire mage with ember-bright eyes and flames dancing over his fingers, scorched canyon",
  "a minotaur champion with a chipped horn and bronze shoulder armor, red dust storm",
  // green
  "an elf druid with antlers woven from branches and moss-green eyes, dappled forest light",
  "a great bear spirit with glowing green runes in its fur, ancient woodland",
  "a dryad with bark skin and leaves for hair, golden-hour sunlight through the canopy",
  "a weathered human ranger with a grey-streaked beard and a wolf-pelt hood, misty pines",
  "a towering treefolk elder with a mossy face and tiny mushrooms on its brow, fireflies",
];

const BANNERS = [
  // plains (white)
  "endless golden wheat plains under towering sunlit clouds, a distant white-stone citadel",
  "rolling green grassland at dawn with a lone ancient stone archway and drifting mist",
  "a sunlit savanna with scattered acacia trees and great floating stone monoliths in the sky",
  "terraced farmland and a white marble aqueduct stretching to the horizon at golden hour",
  "windswept highland meadows of white flowers beneath a radiant sunburst sky",
  // islands (blue)
  "a chain of misty tropical islands in turquoise water beneath a vast twilight sky with two moons",
  "sea stacks and crashing waves under a storm front, a lighthouse glowing blue with arcane light",
  "a drowned ruined city with spires rising from a calm mirror-like sea at dusk",
  "floating islands with waterfalls pouring into the clouds, cool blue morning light",
  "an icy northern coastline with aurora ribbons over dark water and drifting floes",
  // swamps (black)
  "a moonlit swamp of twisted mangroves and black water with drifting violet will-o'-wisps",
  "a fog-choked graveyard moor with leaning headstones and a ruined gothic chapel on the horizon",
  "a dead forest bog under a sickly green sky, bones half-sunk in the mire",
  "a vast cavern of black stone and glowing purple fungi with a still underground lake",
  "a rotting battlefield marsh at dusk with shattered banners and circling crows",
  // mountains (red)
  "jagged volcanic peaks with rivers of lava under an ash-red sky",
  "a red sandstone canyon at sunset with towering hoodoos and a distant dragon silhouette in the sky",
  "snow-capped mountain range at sunrise with a dwarven forge-city glowing in the cliff face",
  "a lightning storm over a barren crag with a broken watchtower on the ridge",
  "scorched badlands with smoking fissures and ember-filled wind, a burning horizon",
  // forests (green)
  "a single continuous view of an ancient primeval forest, colossal moss-covered trunks receding into mist, shafts of golden light",
  "an autumn woodland valley with a winding river and overgrown stone elven ruins",
  "a bioluminescent jungle at night with giant ferns and glowing flowers",
  "a misty bamboo forest with a hidden shrine and stone lanterns at dawn",
  "a giant world-tree rising above a sea of forest canopy beneath drifting clouds",
];

const pad = (n) => String(n).padStart(2, "0");

function buildJobs() {
  const jobs = [];
  AVATARS.forEach((subject, i) => {
    jobs.push({
      name: `avatar-${pad(i + 1)}`,
      file: path.join(OUT, "avatars", `avatar-${pad(i + 1)}.webp`),
      prompt: `${AVATAR_STYLE} Subject: ${subject}.`,
      aspectRatio: "1:1",
      width: 512,
      height: 512,
    });
  });
  BANNERS.forEach((subject, i) => {
    jobs.push({
      name: `banner-${pad(i + 1)}`,
      file: path.join(OUT, "banners", `banner-${pad(i + 1)}.webp`),
      prompt: `${BANNER_STYLE} Scene: ${subject}.`,
      aspectRatio: "21:9",
      width: 1600,
      height: 400,
    });
  });
  return jobs;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function paint(job) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { image } = await generateImage({
        model: MODEL,
        prompt: job.prompt,
        aspectRatio: job.aspectRatio,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(120_000),
      });
      const webp = await sharp(Buffer.from(image.uint8Array))
        // Centre crop: banner prompts put the horizon mid-frame, and the bottom
        // edge (where a model likes to fake a signature) is what 21:9 → 4:1 drops.
        .resize(job.width, job.height, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer();
      await writeFile(job.file, webp);
      return webp.length;
    } catch (error) {
      lastError = error;
      console.warn(`  ${job.name}: attempt ${attempt} failed — ${error?.message ?? error}`);
    }
  }
  throw lastError;
}

async function main() {
  await loadEnvLocal();
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error("AI_GATEWAY_API_KEY is not set (env or .env.local).");
    process.exit(1);
  }
  const force = process.argv.includes("--force");
  const onlyIndex = process.argv.indexOf("--only");
  const only =
    onlyIndex !== -1 ? new Set((process.argv[onlyIndex + 1] ?? "").split(",")) : null;

  await mkdir(path.join(OUT, "avatars"), { recursive: true });
  await mkdir(path.join(OUT, "banners"), { recursive: true });

  const queue = [];
  for (const job of buildJobs()) {
    if (only) {
      if (only.has(job.name)) queue.push(job);
    } else if (force || !(await exists(job.file))) {
      queue.push(job);
    }
  }
  console.log(`${queue.length} image(s) to paint with ${MODEL}.`);

  let failed = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      try {
        const bytes = await paint(job);
        console.log(`✓ ${job.name} (${Math.round(bytes / 1024)} KB)`);
      } catch {
        failed += 1;
        console.error(`✗ ${job.name} — gave up after 3 attempts`);
      }
    }
  });
  await Promise.all(workers);
  if (failed > 0) {
    console.error(`${failed} image(s) failed — rerun to fill the gaps.`);
    process.exit(1);
  }
  console.log("Done.");
}

main();
