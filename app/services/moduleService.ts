import { eq, and, sql, gt, lt, gte, lte, ne } from "drizzle-orm";
import { db } from "~/db";
import { modules, lessons } from "~/db/schema";

// ─── Module Service ───
// Handles module CRUD and reordering within courses.

export async function getModuleById(id: number) {
  const [row] = await db.select().from(modules).where(eq(modules.id, id));
  return row;
}

export async function getModulesByCourse(courseId: number) {
  return await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position);
}

export async function getModuleWithLessons(id: number) {
  const mod = await getModuleById(id);
  if (!mod) return null;

  const moduleLessons = await db
    .select()
    .from(lessons)
    .where(eq(lessons.moduleId, id))
    .orderBy(lessons.position);

  return { ...mod, lessons: moduleLessons };
}

export async function createModule(
  courseId: number,
  title: string,
  position: number | null
) {
  let pos: number;
  if (position != null) {
    pos = position;
  } else {
    const [maxResult] = await db
      .select({ max: sql<number>`coalesce(max(${modules.position}), 0)` })
      .from(modules)
      .where(eq(modules.courseId, courseId));
    pos = maxResult!.max + 1;
  }

  const [row] = await db
    .insert(modules)
    .values({ courseId, title, position: pos })
    .returning();
  return row;
}

export async function updateModuleTitle(id: number, title: string) {
  const [row] = await db
    .update(modules)
    .set({ title })
    .where(eq(modules.id, id))
    .returning();
  return row;
}

export async function updateModuleContent(opts: {
  id: number;
  content: string | null;
  videoUrl: string | null;
}) {
  const { id, content, videoUrl } = opts;
  const [row] = await db
    .update(modules)
    .set({ content, videoUrl })
    .where(eq(modules.id, id))
    .returning();
  return row;
}

export async function deleteModule(id: number) {
  // Delete all lessons in this module first
  await db.delete(lessons).where(eq(lessons.moduleId, id));
  const [row] = await db.delete(modules).where(eq(modules.id, id)).returning();
  return row;
}

export async function getModuleCount(courseId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(modules)
    .where(eq(modules.courseId, courseId));
  return result?.count ?? 0;
}

// ─── Locking ───

export async function lockModule(id: number) {
  const [row] = await db
    .update(modules)
    .set({ isLocked: true, lockedAt: new Date().toISOString() })
    .where(eq(modules.id, id))
    .returning();
  return row;
}

export async function unlockModule(id: number) {
  const [row] = await db
    .update(modules)
    .set({ isLocked: false, lockedAt: new Date().toISOString() })
    .where(eq(modules.id, id))
    .returning();
  return row;
}

export async function lockAllModules(courseId: number) {
  await db
    .update(modules)
    .set({ isLocked: true, lockedAt: new Date().toISOString() })
    .where(eq(modules.courseId, courseId));
}

export async function unlockAllModules(courseId: number) {
  await db
    .update(modules)
    .set({ isLocked: false, lockedAt: new Date().toISOString() })
    .where(eq(modules.courseId, courseId));
}

// ─── Reordering ───

export async function moveModuleToPosition(opts: { moduleId: number; newPosition: number }) {
  const { moduleId, newPosition } = opts;
  const mod = await getModuleById(moduleId);
  if (!mod) return null;

  const oldPosition = mod.position;
  if (oldPosition === newPosition) return mod;

  if (newPosition > oldPosition) {
    // Moving down: shift items between old+1 and new up by 1
    await db.update(modules)
      .set({ position: sql`${modules.position} - 1` })
      .where(
        and(
          eq(modules.courseId, mod.courseId),
          gt(modules.position, oldPosition),
          lte(modules.position, newPosition)
        )
      );
  } else {
    // Moving up: shift items between new and old-1 down by 1
    await db.update(modules)
      .set({ position: sql`${modules.position} + 1` })
      .where(
        and(
          eq(modules.courseId, mod.courseId),
          gte(modules.position, newPosition),
          lt(modules.position, oldPosition)
        )
      );
  }

  const [row] = await db
    .update(modules)
    .set({ position: newPosition })
    .where(eq(modules.id, moduleId))
    .returning();
  return row;
}

export async function swapModulePositions(opts: { moduleIdA: number; moduleIdB: number }) {
  const { moduleIdA, moduleIdB } = opts;
  const modA = await getModuleById(moduleIdA);
  const modB = await getModuleById(moduleIdB);
  if (!modA || !modB) return null;

  await db.update(modules)
    .set({ position: modB.position })
    .where(eq(modules.id, moduleIdA));

  await db.update(modules)
    .set({ position: modA.position })
    .where(eq(modules.id, moduleIdB));

  return {
    a: { ...modA, position: modB.position },
    b: { ...modB, position: modA.position },
  };
}

export async function reorderModules(courseId: number, moduleIds: number[]) {
  for (let i = 0; i < moduleIds.length; i++) {
    await db.update(modules)
      .set({ position: i + 1 })
      .where(and(eq(modules.id, moduleIds[i]), eq(modules.courseId, courseId)));
  }
  return await getModulesByCourse(courseId);
}
