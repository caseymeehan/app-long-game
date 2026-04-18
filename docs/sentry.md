# Sentry — operational notes

This platform uses Sentry for error tracking. Scope is deliberately
minimal: email alerts on server + browser errors, release tagged by
git SHA, no PII shipped off-platform.

## Where things live

| Concern            | Location                                                                    |
|--------------------|-----------------------------------------------------------------------------|
| Server SDK init    | `platform/app/instrument.server.mjs`                                        |
| Server entry       | `platform/app/app/entry.server.tsx` (exports `handleError`)                 |
| Browser SDK init   | `platform/app/app/entry.client.tsx` (DSN inlined)                           |
| Browser fallback   | `ErrorBoundary` in `platform/app/app/root.tsx` calls `Sentry.captureException` |
| Webhook context    | `api.thrivecart-webhook.ts`, `api.mailchimp-subscribe.ts`                   |
| Release tagging    | `vite.config.ts` (`sentryReactRouter` plugin) + `react-router.config.ts`    |
| Dashboard URL      | https://sentry.io                                                           |

## Environment variables

**Runtime (Railway → Variables):**

| Name                 | Value                            | Notes                                       |
|----------------------|----------------------------------|---------------------------------------------|
| `SENTRY_DSN`         | from Sentry project              | Public identifier. Server only; browser DSN is inlined in entry.client.tsx. |
| `SENTRY_ENVIRONMENT` | `production`                     | Tags events; useful if we add staging later. |
| `SENTRY_RELEASE`     | `${{RAILWAY_GIT_COMMIT_SHA}}`    | Railway variable reference, NOT a literal.   |

**Build-only (Railway → Variables, used by `@sentry/vite-plugin`):**

| Name                 | Notes                                             |
|----------------------|---------------------------------------------------|
| `SENTRY_AUTH_TOKEN`  | Secret. Org-level token with `project:releases`.  |
| `SENTRY_ORG`         | Sentry org slug from the dashboard URL.           |
| `SENTRY_PROJECT`     | Sentry project slug from the dashboard URL.       |

All six key names (no values) are mirrored in `platform/app/.env.example`.

## Alert rules (configure these in the Sentry dashboard)

Alerts → Create Alert → **Issue Alert**. Email-only, destination
`casey@epicpresence.com`, environment `production`.

1. **"New issue in production"** — fires when a new issue is first
   seen.
2. **"Regression"** — fires when a resolved issue becomes unresolved.
3. **"Spike"** — fires when an issue has occurred more than 20 times
   in 1 hour.

No Slack, no PagerDuty, no other integrations.

## Rotating the DSN

Server-side DSN is in `SENTRY_DSN` (Railway variable). Browser DSN is
hardcoded in `app/entry.client.tsx` — that's intentional (DSNs are
public by design and every Sentry SDK doc example inlines them). If
the DSN rotates, update Railway and edit that one line in
`entry.client.tsx`.

## Emergency kill switch

Unset `SENTRY_DSN` in Railway and restart the service. The SDK
no-ops silently in that state on both server and browser. No redeploy
required beyond restart.

## Rollback paths

| Failure mode              | Action                                              |
|---------------------------|-----------------------------------------------------|
| SDK breaks server boot    | `git revert` the "server init + handleError" commit |
| CSP breaks the browser UI | `git revert` the "client init + CSP" commit         |
| Build fails on sourcemap  | `git revert` the "release tracking" commit          |
| All else fails            | Unset `SENTRY_DSN` in Railway (no redeploy)         |

## Deliberate omissions (v1)

- **No cron monitor.** The free tier includes one monitor. We have
  no scheduled jobs in the repo, so nothing to monitor yet. Revisit
  when the first real cron lands.
- **No Session Replay.** Replay records DOM structure and user
  interactions. Primary goal is email alerts on silent regressions,
  not UX debugging. Enable later in one line if needed.
- **`sendDefaultPii: false`.** IP addresses, cookies, and auth
  headers are not shipped to Sentry. A `beforeSend` hook drops
  cookie/set-cookie/authorization headers as defense in depth.
- **No `Sentry.setUser({ id })`** in the root loader. Adding a root
  loader just for error tagging would introduce a DB call on every
  request. Defer until we have a root loader for other reasons.

## Related memory files

- `feedback_verify_git_railway_parity` — run `railway deployment list`
  before the first push in any session.
- `feedback_railway_supabase_sync_git` — Railway env vars need key-name
  mirrors in `.env.example`.
