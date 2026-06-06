import { redirect } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { isActivePartner } from "~/services/partnerService";

/**
 * Shared post-authentication routing. Called once a Supabase session has been
 * established (via OTP code verification on /forgot-password, or the legacy
 * magic-link exchange on /auth/callback). Ensures an app `users` row exists,
 * then throws a redirect to the right destination.
 *
 * Always throws — either a redirect to the destination, or a redirect to
 * /login if no authenticated user is found on the session.
 */
export async function redirectAfterLogin(
  supabase: SupabaseClient,
  responseHeaders: Headers,
  redirectTo: string = "/courses"
): Promise<never> {
  const isDefaultRedirect = redirectTo === "/" || redirectTo === "/courses";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw redirect("/login?error=auth_failed", { headers: responseHeaders });
  }

  // Ensure the app user row exists (it normally does — created by the DB
  // trigger / ThriveCart webhook — but self-heal if missing).
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseAuthId, user.id));

  if (!existing) {
    await db.insert(users).values({
      name: user.user_metadata?.name || user.email?.split("@")[0] || "User",
      email: user.email!,
      role: UserRole.Student,
      supabaseAuthId: user.id,
    });
    throw redirect(redirectTo, { headers: responseHeaders });
  }

  if (existing.needsPasswordSetup) {
    throw redirect("/set-password", { headers: responseHeaders });
  }

  // If no specific page was requested, send partners to their resources page.
  if (isDefaultRedirect) {
    const partner = await isActivePartner(existing.id);
    if (partner) {
      throw redirect("/partner-resources", { headers: responseHeaders });
    }
  }

  throw redirect(redirectTo, { headers: responseHeaders });
}
