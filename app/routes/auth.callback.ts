import { redirect } from "react-router";
import * as Sentry from "@sentry/react-router";
import type { Route } from "./+types/auth.callback";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { redirectAfterLogin } from "~/lib/post-login.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirectTo") || "/courses";
  const responseHeaders = new Headers();

  if (code) {
    const supabase = createSupabaseServerClient(request, responseHeaders);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      // Logins now use OTP codes (see /forgot-password); this path only fires
      // for legacy/bookmarked magic links. Capture so we can measure residual
      // failures (e.g. corporate scanners, cross-device) before retiring it.
      console.error(`[auth.callback] Code exchange failed: ${error.message}`);
      Sentry.captureException(error, {
        tags: { auth_failure: "code_exchange" },
      });
      throw redirect(
        `/login?error=auth_failed&message=${encodeURIComponent(error.message)}`,
        { headers: responseHeaders }
      );
    }

    return await redirectAfterLogin(supabase, responseHeaders, redirectTo);
  }

  throw redirect(redirectTo, { headers: responseHeaders });
}
