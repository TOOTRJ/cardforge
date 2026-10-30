# Screenshots for the profile links / store cards PRs

Images only, no code. The two PRs (the profile links schema with its Settings
editors, and the profile page refactor) link these files. Delete this branch
once both PRs are merged or closed. `vercel.json` turns off Vercel deployments
for this branch.

The pages were rendered LOCALLY: `next dev` on the PR branches and on `main`,
with a fixture stand-in for the Supabase REST API (made-up rows for `dev_pro`).
The session that took them couldn't reach supabase.co or the Vercel previews.
They show layout and behaviour, not production data.
