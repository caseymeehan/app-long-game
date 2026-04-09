import { eq } from "drizzle-orm";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";

// ─── User Service ───
// Handles user CRUD operations and role management.

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

export async function createUser(opts: {
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
}) {
  const { name, email, role, avatarUrl } = opts;
  const [user] = await db
    .insert(users)
    .values({ name, email, role, avatarUrl })
    .returning();
  return user;
}

export async function updateUser(opts: {
  id: number;
  name: string;
  email: string;
  bio: string | null;
}) {
  const { id, name, email, bio } = opts;
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

export async function createUserWithAuth(opts: {
  name: string;
  email: string;
  role: UserRole;
  supabaseAuthId: string;
  needsPasswordSetup?: boolean;
}) {
  const { name, email, role, supabaseAuthId, needsPasswordSetup = false } = opts;
  const [user] = await db
    .insert(users)
    .values({ name, email, role, supabaseAuthId, needsPasswordSetup })
    .returning();
  return user;
}

export async function clearPasswordSetupFlag(userId: number) {
  const [user] = await db
    .update(users)
    .set({ needsPasswordSetup: false })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

export async function setPasswordSetupFlag(email: string) {
  const [user] = await db
    .update(users)
    .set({ needsPasswordSetup: true })
    .where(eq(users.email, email))
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
