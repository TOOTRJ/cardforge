# Email

How PipGlyph sends email, and the owner steps that turn it on in production.

## Provider: Resend

One provider for everything (decision 2026-09-17, after comparing Resend,
Postmark, Loops, SES, SendGrid, Mailgun and Brevo):

- the codebase already talks to Resend's REST API with plain `fetch` (no SDK);
- it is an official Supabase SMTP provider with a one-click integration;
- the same account covers auth mail (SMTP), app mail (REST/batch API) and, if
  ever wanted, hosted newsletters (Broadcasts).

Cost: free tier = 3,000 emails/month but **100/day**; Pro is $20/month for
50k with no daily cap. Postmark ($15/10k) is the runner-up if deliverability
ever becomes a problem.

## Auth emails (signup confirmation, password reset, email change, …)

Supabase Auth sends these itself. Two things make them PipGlyph's:

1. **Templates** — generated from the one email shell
   (`lib/email/layout.ts`) by `npm run email:build-auth-templates` into
   `supabase/templates/*.html`. Never edit the HTML by hand.
   `supabase/config.toml` points the local stack and every Supabase preview
   branch at them.
2. **Links** — every template links to
   `{{ .SiteURL }}/auth/confirm?token_hash=…&type=…`. That page verifies the
   token hash server-side on a button press, so the link works in any
   browser or device (the default `?code=` PKCE link only works in the
   browser that requested it) and survives mail scanners that prefetch URLs.
   `/auth/callback` remains for Google OAuth.

### Production setup (owner, one time)

Production does **not** read `config.toml` auth settings — the Supabase GitHub
integration only deploys migrations, functions and buckets. So:

1. **Resend** → add and verify the sending domain (SPF + DKIM + a DMARC
   record). Turn **click and open tracking OFF** for it: tracking rewrites
   links and breaks one-time auth links.
2. **Supabase → Authentication → SMTP** (or Resend's Supabase integration,
   which fills this in): host `smtp.resend.com`, port `465`, user `resend`,
   password = a Resend API key; sender e.g. `PipGlyph <accounts@pipglyph.com>`.
   Until custom SMTP is on, Supabase's built-in mailer sends **2 emails/hour,
   to project team members only** — real users get nothing.
3. **Supabase → Authentication → Rate limits**: raise "emails per hour" from
   the post-SMTP default of 30.
4. **Supabase → Authentication → URL configuration**: Site URL
   `https://pipglyph.com`; redirect allow-list includes
   `https://pipglyph.com/auth/callback` (OAuth) — `/auth/confirm` needs no
   entry because the templates build it from the Site URL.
5. **Push the templates**:
   ```bash
   SUPABASE_ACCESS_TOKEN=… npm run email:push-auth-templates            # dry run
   SUPABASE_ACCESS_TOKEN=… npm run email:push-auth-templates -- --apply
   ```
   (needs `SUPABASE_PROD_REF` in `.env.local`, same as `db:push:prod`). It
   writes only the mailer subject/template keys and the two security-notice
   toggles, and prints the related settings (SMTP, site URL, password policy)
   so drift is visible. Re-run it whenever the templates change.
6. **Supabase → Authentication → Passwords**: minimum length 8 (the app
   enforces 8–72) and enable leaked-password protection if the plan has it.

### Local

`supabase start` serves the branded templates; mail lands in Mailpit at
http://127.0.0.1:54324. After changing a template: rebuild, then
`supabase stop && supabase start` (the auth container reads them at boot).
`tests/e2e/auth-flows.spec.ts` drives a real password reset through Mailpit.

## App emails (welcome, team messages, activity digest, newsletter)

Sent by the app through Resend's REST API (`lib/email/send.ts`, plain
`fetch`). All of them use the same shell as the auth emails
(`lib/email/layout.ts`) via the builders in `lib/email/messages.ts`.

| Email | List | When |
| --- | --- | --- |
| Welcome | account | once, when onboarding is finished or skipped |
| Team message | account | immediately, when the team posts in the user's thread |
| Activity digest | activity | weekly cron (`/api/cron/email-digest`, Mondays 15:00 UTC), only to users with UNREAD notifications since their last digest — never one email per like. The body links straight to the "Activity digest" switch in Settings → Email |
| Newsletter | newsletter | admin presses **Email newsletter** on a live update in `/admin/updates` |

Preferences live in `email_preferences` (migration 0095): three switches the
user sets during onboarding and under Settings → Email. **Newsletter is
opt-in** (unchecked by default; the consent timestamp is stamped by a DB
trigger). Security emails from Supabase Auth are never gated.

Every list email carries `List-Unsubscribe` + `List-Unsubscribe-Post`
(RFC 8058 one-click, required by Gmail/Yahoo for bulk senders) pointing at
`POST /api/email/unsubscribe?token=…&list=…`, plus a visible `/unsubscribe`
footer link that asks for a button press (mail scanners can't unsubscribe
anyone). The token is `email_preferences.unsubscribe_token`.

Bounces and complaints: `POST /api/webhooks/resend` (Svix-signed) calls
`suppress_email()`, which stops all non-auth email to that address; a
complaint also withdraws newsletter consent. Settings shows the user why.

### Production setup (owner)

Vercel env:

| Var | Purpose |
| --- | --- |
| `RESEND_API_KEY` | required for any app email |
| `EMAIL_FROM` | verified sender, e.g. `PipGlyph <hello@pipglyph.com>` (the older `ADMIN_ALERT_FROM` still works as a fallback) |
| `EMAIL_FROM_NEWSLETTER` | optional separate sender for the newsletter — a subdomain like `news.pipglyph.com` keeps marketing reputation away from transactional mail |
| `EMAIL_REPLY_TO` | optional |
| `EMAIL_POSTAL_ADDRESS` | postal address printed in the newsletter footer (CAN-SPAM) |
| `RESEND_WEBHOOK_SECRET` | from Resend → Webhooks, after adding `https://pipglyph.com/api/webhooks/resend` for `email.bounced` + `email.complained` |
| `CRON_SECRET` | already expected by the other cron routes; **without it every cron route (this one included) fails closed with 401** |

Volume: the free tier's 100/day cap is reachable on digest Mondays once
there are a few hundred active users — plan on Resend Pro ($20/month) then.

### Alternatives considered

Resend Broadcasts (hosted newsletter editor, Segments/Topics, hosted
preference page) would replace the in-app newsletter send at the cost of
syncing subscribers to Resend and a second $40/month plan past 1,000
contacts; the in-app send keeps one source of truth (our DB) and is free at
today's size. Postmark ($15/month) is the deliverability runner-up; SES is
cheapest but has no list tooling; SendGrid retired its free plan.
