import { eq } from "drizzle-orm";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";

// ─── User Service ───
// Handles user CRUD operations and role management.
// Uses positional parameters (project convention).

export async function getAllUsers() {
  return await db.select().from(users);
}

export async function getUserById(id: number) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

export async function getUsersByRole(role: UserRole) {
  return await db.select().from(users).where(eq(users.role, role));
}

export async function createUser(
  name: string,
  email: string,
  role: UserRole,
  avatarUrl: string | null
) {
  const [user] = await db
    .insert(users)
    .values({ name, email, role, avatarUrl })
    .returning();
  return user;
}

export async function updateUser(
  id: number,
  name: string,
  email: string,
  bio: string | null
) {
  const [user] = await db
    .update(users)
    .set({ name, email, bio })
    .where(eq(users.id, id))
    .returning();
  return user;
}

export async function updateUserRole(id: number, role: UserRole) {
  const [user] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning();
  return user;
}

export async function createUserWithAuth(
  name: string,
  email: string,
  role: UserRole,
  supabaseAuthId: string
) {
  const [user] = await db
    .insert(users)
    .values({ name, email, role, supabaseAuthId })
    .returning();
  return user;
}

export async function linkSupabaseAuth(userId: number, supabaseAuthId: string) {
  const [user] = await db
    .update(users)
    .set({ supabaseAuthId })
    .where(eq(users.id, userId))
    .returning();
  return user;
}
