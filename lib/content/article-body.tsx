import "server-only";

import type { ReactElement } from "react";
import { compileMDX } from "next-mdx-remote/rsc";
import {
  articleMdxOptions,
  composerArticleMdxOptions,
  mdxComponents,
} from "@/components/content/mdx-components";

// ---------------------------------------------------------------------------
// ONE compile of an article body, for every place that draws or releases one:
// the public page (/articles/[slug]), the composer's preview, and the
// composer's schedule / publish / scheduled-or-live edit, which compile the
// STORED body once and refuse on an error — so a body that cannot be drawn
// never goes out. A composer article compiles with composerArticleMdxOptions
// (the body guard, lib/content/article-body-guard.ts); an MDX guide from git
// with articleMdxOptions, as it always has.
// ---------------------------------------------------------------------------

export type CompiledArticleBody = { ok: true; content: ReactElement } | { ok: false; error: string };

export async function compileArticleBody(
  body: string,
  source: "file" | "composer" = "composer",
): Promise<CompiledArticleBody> {
  try {
    const { content } = await compileMDX({
      source: body,
      options: source === "composer" ? composerArticleMdxOptions : articleMdxOptions,
      components: mdxComponents,
    });
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Why a composer body can't go out (null = it compiles). */
export async function articleBodyCompileError(body: string): Promise<string | null> {
  const compiled = await compileArticleBody(body, "composer");
  return compiled.ok ? null : compiled.error;
}
