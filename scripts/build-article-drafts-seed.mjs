#!/usr/bin/env node
// Regenerates supabase/seeds/32_article_drafts.sql from content/article-drafts/
// (scripts/lib/article-drafts-seed.mjs). Run after editing a draft:
//
//   node scripts/build-article-drafts-seed.mjs

import fs from "node:fs";
import path from "node:path";
import { buildArticleDraftsSeed, parseDraftForSeed } from "./lib/article-drafts-seed.mjs";

const dir = path.join(process.cwd(), "content", "article-drafts");
const files = fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.mdx$/.test(f)).sort();
const drafts = files
  .map((f) => parseDraftForSeed(f, fs.readFileSync(path.join(dir, f), "utf8")))
  .filter(Boolean);
const out = path.join(process.cwd(), "supabase", "seeds", "32_article_drafts.sql");
fs.writeFileSync(out, buildArticleDraftsSeed(drafts));
console.log(`Wrote ${path.relative(process.cwd(), out)} (${drafts.length} drafts).`);
