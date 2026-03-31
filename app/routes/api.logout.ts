import { redirect } from "react-router";
import type { Route } from "./+types/api.logout";
import { destroySession } from "~/lib/session";
import { createSupabaseServerClient } from "~/lib/supabase.server";

export async function action({ request }: Route.ActionArgs) {
  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient(request, responseHeaders);

  // Sign out from Supabase
  await supabase.auth.signOut();

  // Destroy the dev session cookie
  const cookie = await destroySession(request);
  responseHeaders.append("Set-Cookie", cookie);

  return redirect("/", {
    headers: responseHeaders,
  });
}
