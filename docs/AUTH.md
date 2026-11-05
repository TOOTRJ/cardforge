# Sign-in providers (Google, Discord)

How the "Continue with …" buttons on `/login` and `/signup` work, and what the
owner sets up per environment. Email + password is documented in
`docs/EMAIL.md`; the environments themselves in `docs/ENVIRONMENTS.md`.

## How it works

- ONE button component, `components/auth/oauth-sign-in-button.tsx`
  (`OAuthSignInButton` / `OAuthSignInButtons`), and ONE list of providers,
  `lib/auth/oauth-providers.ts` (`enabledOAuthProviders()`).
- The flow is the same for every provider:
  `signInWithOAuth` → the provider → Supabase → `/auth/callback?redirectTo=…`
  (PKCE code exchange) → `safeRedirectPath(redirectTo)`. There is no second
  callback or redirect rule.
- Google asks for its account chooser (`prompt: "select_account"`). Discord
  asks for nothing extra: GoTrue's Discord provider already requests exactly
  `identify email`, and a `scopes` option would be APPENDED to that list.
- A new account goes through the signup trigger (`handle_new_user`, 0094 /
  0127) like any other: the handle is GENERATED (`ember_sphinx_4821`) — GoTrue
  sends Discord's name as `full_name` / `name` and never as `username`, the one
  key the trigger would honour — and the display name is the provider's name
  (Discord: the account's username; Google: the full name), cut to 64. Only a
  Google account picture is kept as the avatar; a Discord account gets a
  built-in avatar + banner (0095). Then onboarding, as for an email signup.
- **Same email as an existing account.** Supabase's automatic identity
  linking applies (its "Identity Linking" guide): a provider account with a
  VERIFIED email signs in to the existing account — no second profile is
  made. A provider email that isn't verified is not signed in; the login page
  asks the visitor to verify it with the provider first. We build no account
  linking of our own.
- **A provider's refusal** comes back to `/auth/callback` as `?error=…` (and
  `error_code` for GoTrue's own refusals) instead of a code
  (`lib/auth/oauth-callback-error.ts`): a visitor who presses Cancel on
  Discord's screen (`access_denied`) lands on `/login?error=oauth-cancelled`
  ("Sign-in was cancelled, so nothing changed…"), an unverified provider email
  on `oauth-verify-email`, anything else on `oauth-failed` (logged on the
  server). The redirect is kept, so a
  retry lands where the visitor was going. No message says whether a
  PipGlyph account exists.

## The Discord switch: `NEXT_PUBLIC_AUTH_DISCORD`

The Discord button shows only where `NEXT_PUBLIC_AUTH_DISCORD=1`. supabase-js
navigates straight to GoTrue's `/authorize`, so a provider that isn't enabled
in that environment's Supabase project would leave the visitor on GoTrue's raw
JSON error (`"Unsupported provider: provider is not enabled"`); finding out
first would mean asking GoTrue's `/settings` on every render. Set the flag only
where Discord is configured. It is a `NEXT_PUBLIC_` value, inlined at build:
**a change needs a redeploy**. Google has no flag — it is configured on
production.

## Owner setup: Discord

### 1. The Discord application (once)

1. <https://discord.com/developers/applications> → **New Application** →
   name it "PipGlyph", accept Discord's terms. Give it the PipGlyph icon
   (`public/brand/`) — it shows on Discord's consent screen.
2. **OAuth2** → copy the **Client ID**; **Reset Secret** → copy the
   **Client Secret**. Keep both out of git, chat and docs: the repository is
   public.
3. **OAuth2 → Redirects** → add, one per Supabase project that will offer
   Discord (Discord allows ten):
   - Production, and the shared dev branch: each project's **Callback URL**
     as its Supabase Dashboard shows it (Authentication → Sign In / Providers
     → Discord). Copy it exactly — it reflects a custom auth domain if one is
     active.
   - Local Docker stack (optional): `http://127.0.0.1:54321/auth/v1/callback`

### 2. Production

1. Supabase Dashboard (production project) → Authentication → Sign In /
   Providers → **Discord** → enable, paste the Client ID and Client Secret,
   save. (Production does not read `supabase/config.toml` auth settings.)
2. Authentication → URL Configuration: nothing to add — the production site's
   `/auth/callback` is already allowed (Google uses it).
3. Vercel → Settings → Environment Variables → **Production** →
   `NEXT_PUBLIC_AUTH_DISCORD` = `1` → redeploy production.
4. Check: `/login` shows "Continue with Discord"; sign in with a Discord
   account whose email is verified → onboarding (new) or the dashboard
   (existing email, now linked).

### 3. Previews and the shared dev branch

Most previews (every PR that doesn't touch `supabase/`) and local `npm run dev`
use the persistent `dev` branch. `supabase/config.toml` syncs to it, so a
dashboard toggle there would be overwritten by the next config change —
configure it as code instead:

1. Set the two values as secrets of the dev branch (its ref is
   `[remotes.dev]`'s `project_id`). Put them in a git-ignored file such as
   `supabase/.env.discord` (`SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID=…`,
   `SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET=…`) — never on the command line,
   where they stay in the shell's history — then:

   ```bash
   supabase secrets set --project-ref <dev branch ref> --env-file supabase/.env.discord
   ```

   and delete the file.

2. A PR adds, under `[remotes.dev]` in `supabase/config.toml`:

   ```toml
   [remotes.dev.auth.external.discord]
   enabled = true
   client_id = "env(SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID)"
   secret = "env(SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET)"
   ```

   Merged, the dev branch picks it up through the `dev` git branch.
3. Vercel → **Preview** (and Development, for local) →
   `NEXT_PUBLIC_AUTH_DISCORD` = `1` → redeploy the preview.

A PR that DOES touch `supabase/` gets its own short-lived branch with its own
project ref: it has neither the secrets nor a registered Discord redirect, so
Discord can't be tested there — with the Preview flag on, its button lands on
GoTrue's "provider is not enabled" page. Test Discord on a preview that uses
the dev branch (or the `dev` git branch's stable preview URL).

### 4. Local Docker stack (optional)

`supabase/config.toml` keeps `[auth.external.discord]` OFF (CI's stack and
every preview branch inherit it). `enabled` is a literal on purpose:
`"env(…)"` fails the CLI's config parse whenever the variable is unset. To try
Discord locally, put the two `SUPABASE_AUTH_EXTERNAL_DISCORD_*` values in
`supabase/.env` (git-ignored), then:

```bash
supabase stop
```

```bash
SUPABASE_AUTH_EXTERNAL_DISCORD_ENABLED=true supabase start
```

and `NEXT_PUBLIC_AUTH_DISCORD=1` in the app's env.

## Google

Configured in the production dashboard (Authentication → Providers →
Google). `config.toml` has no Google block, so per-PR preview branches and the
local stack don't have it unless it was enabled there by hand: the button is
always shown, and there it leads to GoTrue's "provider is not enabled" page.
