import * as Sentry from "@sentry/react-router";

// Loaded via NODE_OPTIONS='--import ./instrument.server.mjs' before the app boots.
// If SENTRY_DSN is unset the SDK no-ops, so this is safe in local dev without env.

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,

  sendDefaultPii: false,
  tracesSampleRate: 0.1,

  beforeSend(event) {
    const req = event.request;
    if (req?.headers) {
      for (const key of Object.keys(req.headers)) {
        if (/^(cookie|set-cookie|authorization)$/i.test(key)) {
          delete req.headers[key];
        }
      }
    }
    if (req?.cookies) delete req.cookies;
    return event;
  },
});
