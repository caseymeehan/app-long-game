import { getUserByEmail } from "~/services/userService";

/**
 * Polls for an app user to appear after Supabase auth creation.
 * The Postgres trigger creates the app user asynchronously, so we retry.
 */
export async function waitForAppUser(email: string, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    const user = await getUserByEmail(email);
    if (user) return user;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
