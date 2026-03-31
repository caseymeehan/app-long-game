import { createCookieSessionStorage } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";
import { db } from "~/db";
import { users } from "~/db/schema";
import { eq } from "drizzle-orm";

// Cookie session storage is kept for dev-only features (country override, user switching)
const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "cadence_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secrets: [process.env.SESSION_SECRET || "cadence-dev-secret"],
  },
});

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

/**
 * Get the current user's app ID by checking Supabase auth.
 * In development, also checks the dev cookie for user switching.
 */
export async function getCurrentUserId(
  request: Request,
  responseHeaders?: Headers
): Promise<number | null> {
  // In development, check for user switching override
  if (process.env.NODE_ENV === "development") {
    const session = await getSession(request);
    const devUserId = session.get("devUserId");
    if (typeof devUserId === "number") {
      return devUserId;
    }
  }

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

/**
 * Set the current user ID in the dev cookie (for user switching in development).
 */
export async function setCurrentUserId(request: Request, userId: number) {
  const session = await getSession(request);
  session.set("devUserId", userId);
  return sessionStorage.commitSession(session);
}

export async function destroySession(request: Request) {
  const session = await getSession(request);
  return sessionStorage.destroySession(session);
}

export async function getDevCountry(
  request: Request
): Promise<string | null> {
  const session = await getSession(request);
  const country = session.get("devCountry");
  return typeof country === "string" ? country : null;
}

export async function setDevCountry(
  request: Request,
  country: string | null
) {
  const session = await getSession(request);
  if (country) {
    session.set("devCountry", country);
  } else {
    session.unset("devCountry");
  }
  return sessionStorage.commitSession(session);
}
