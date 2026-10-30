# Article drafts

Draft articles for the owner to review, as MDX files with the composer's
frontmatter (`title`, `description`, `tags`, `category`, `faq`, optional
`seoTitle`, `excerpt`, `cover`). They are **not** guides: nothing on the public
site reads this folder (published guides live in `content/articles/`).

- **Production:** an admin presses **Import drafts** on `/admin/articles`.
  Each file becomes a DRAFT composer article (a slug that already exists is
  skipped, never overwritten). Edit, schedule and publish from there.
- **Previews, the dev database, local resets:** `supabase/seeds/` loads the
  same drafts.

The file name is the slug. Images are PipGlyph's own: diagrams under
`public/article-media/<slug>/`, never Wizards of the Coast art.
