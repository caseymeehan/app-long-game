import { createCookieSessionStorage, redirect, data } from "react-router";
import { createSupabaseServerClient } from "./supabase.server";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { getUserById } from "~/services/userService";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "long_game_session",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    secrets: [process.env.SESSION_SECRET ?? (() => { throw new Error("SESSION_SECRET env var is required"); })()],
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

/**
 * Require a logged-in user. Use `from: "loader"` in loaders (redirects to /login),
 * `from: "action"` in actions (throws 401).
 */
export async function requireUser(
  request: Request,
  from: "loader" | "action" = "loader"
) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    if (from === "loader") throw redirect("/login");
    throw data("You must be logged in.", { status: 401 });
  }
  const user = await getUserById(userId);
  if (!user) {
    if (from === "loader") throw redirect("/login");
    throw data("You must be logged in.", { status: 401 });
  }
  return user;
}

/**
 * Require the user has one of the given roles.
 */
export async function requireRole(
  request: Request,
  roles: UserRole | UserRole[],
  from: "loader" | "action" = "loader"
) {
  const user = await requireUser(request, from);
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role as UserRole)) {
    throw data("You do not have permission to access this page.", { status: 403 });
  }
  return user;
}

/**
 * Require the user is an admin.
 */
export async function requireAdmin(request: Request, from: "loader" | "action" = "loader") {
  return requireRole(request, UserRole.Admin, from);
}

/**
 * Require the user is an instructor or admin.
 */
export async function requireInstructor(request: Request, from: "loader" | "action" = "loader") {
  return requireRole(request, [UserRole.Instructor, UserRole.Admin], from);
}
