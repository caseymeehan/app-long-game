import { createCookieSessionStorage } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";
import { db } from "~/db";
import { users } from "~/db/schema";
import { eq } from "drizzle-orm";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "long_game_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: [process.env.SESSION_SECRET || "long-game-dev-secret"],
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

/**
 * Get the current user's app ID by checking Supabase auth.
 */
export async function getCurrentUserId(
  request: Request,
  responseHeaders?: Headers
): Promise<number | null> {
  // Check Supabase auth
  const headers = responseHeaders ?? new Headers();
  const supabase = createSupabaseServerClient(request, headers);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Look up app user by supabase_auth_id
  const [appUser] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseAuthId, user.id));

  return appUser?.id ?? null;
}

export async function destroySession(request: Request) {
  const session = await getSession(request);
  return sessionStorage.destroySession(session);
}
