import { redirect } from "react-router";
import type { Route } from "./+types/auth.callback";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirectTo") || "/courses";
  const responseHeaders = new Headers();

  if (code) {
    const supabase = createSupabaseServerClient(request, responseHeaders);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error(`[auth.callback] Code exchange failed: ${error.message}`);
      throw redirect(
        `/login?error=auth_failed&message=${encodeURIComponent(error.message)}`,
        { headers: responseHeaders }
      );
    }

    // Get the authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Check if app user exists, create if not
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.supabaseAuthId, user.id));

      if (!existing) {
        await db.insert(users).values({
          name:
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "User",
          email: user.email!,
          role: UserRole.Student,
          supabaseAuthId: user.id,
        });
      } else if (existing.needsPasswordSetup) {
        throw redirect("/set-password", { headers: responseHeaders });
      }
    }
  }

  throw redirect(redirectTo, { headers: responseHeaders });
}
