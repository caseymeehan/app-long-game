import * as Sentry from "@sentry/react-router";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

Sentry.init({
  dsn: "https://5de9be80d3645dd1e51a05150dc5d29f@o4511242796072960.ingest.us.sentry.io/4511242804264960",
  environment: import.meta.env.MODE,

  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Benign browser noise: these fire when a user navigates away mid-request or
  // hits a transient network blip — not bugs, and they drown out real errors.
  // Suppress-benign-only: failed-query / router errors are intentionally left
  // reporting so we still catch real backend issues.
  ignoreErrors: [
    "Failed to fetch", // Chrome/Firefox: cancelled or failed fetch
    "Load failed", // Safari's equivalent of "Failed to fetch"
    "NetworkError when attempting to fetch resource",
    "AbortError", // fetch aborted (navigation away mid-request)
    "The operation was aborted",
    "The user aborted a request",
    /turbo-stream/i, // interrupted React Router data stream on navigation
  ],

  integrations: [Sentry.reactRouterTracingIntegration()],
});

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
