import { eq, and, sql, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "~/db";
import { lessons } from "~/db/schema";

// ─── Lesson Service ───
// Handles lesson CRUD and reordering within modules.

export async function getLessonById(id: number) {
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id));
  return row;
}

export async function getLessonsByModule(moduleId: number) {
  return await db
    .select()
    .from(lessons)
    .where(eq(lessons.moduleId, moduleId))
    .orderBy(lessons.position);
}

export async function getLessonCount(moduleId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lessons)
    .where(eq(lessons.moduleId, moduleId));
  return Number(result?.count ?? 0);
}

export async function createLesson(opts: {
  moduleId: number;
  title: string;
  content: string | null;
  videoUrl: string | null;
  position: number | null;
  durationMinutes: number | null;
}) {
  const { moduleId, title, content, videoUrl, position, durationMinutes } = opts;
  let pos: number;
  if (position != null) {
    pos = position;
  } else {
    const [maxResult] = await db
      .select({ max: sql<number>`coalesce(max(${lessons.position}), 0)` })
      .from(lessons)
      .where(eq(lessons.moduleId, moduleId));
    pos = (maxResult?.max ?? 0) + 1;
  }

  const [row] = await db
    .insert(lessons)
    .values({
      moduleId,
      title,
      content,
      videoUrl,
      position: pos,
      durationMinutes,
    })
    .returning();
  return row;
}

export async function updateLesson(opts: {
  id: number;
  title?: string | null;
  content?: string | null;
  videoUrl?: string | null;
  durationMinutes?: number | null;
  githubRepoUrl?: string | null;
}) {
  const { id, title = null, content = null, videoUrl = null, durationMinutes = null, githubRepoUrl = null } = opts;
  const updates: Record<string, unknown> = {};
  if (title !== null) updates.title = title;
  if (content !== null) updates.content = content;
  if (videoUrl !== null) updates.videoUrl = videoUrl;
  if (durationMinutes !== null) updates.durationMinutes = durationMinutes;
  if (githubRepoUrl !== null) updates.githubRepoUrl = githubRepoUrl;

  if (Object.keys(updates).length === 0) {
    return await getLessonById(id);
  }

  const [row] = await db
    .update(lessons)
    .set(updates)
    .where(eq(lessons.id, id))
    .returning();
  return row;
}

export async function updateLessonTitle(id: number, title: string) {
  const [row] = await db
    .update(lessons)
    .set({ title })
    .where(eq(lessons.id, id))
    .returning();
  return row;
}

export async function updateLessonContent(id: number, content: string) {
  const [row] = await db
    .update(lessons)
    .set({ content })
    .where(eq(lessons.id, id))
    .returning();
  return row;
}

export async function deleteLesson(id: number) {
  const [row] = await db.delete(lessons).where(eq(lessons.id, id)).returning();
  return row;
}

// ─── Reordering ───

export async function moveLessonToPosition(opts: { lessonId: number; newPosition: number }) {
  const { lessonId, newPosition } = opts;
  const lesson = await getLessonById(lessonId);
  if (!lesson) return null;

  const oldPosition = lesson.position;
  if (oldPosition === newPosition) return lesson;

  if (newPosition > oldPosition) {
    // Moving down: shift items between old+1 and new up by 1
    await db.update(lessons)
      .set({ position: sql`${lessons.position} - 1` })
      .where(
        and(
          eq(lessons.moduleId, lesson.moduleId),
          gt(lessons.position, oldPosition),
          lte(lessons.position, newPosition)
        )
      );
  } else {
    // Moving up: shift items between new and old-1 down by 1
    await db.update(lessons)
      .set({ position: sql`${lessons.position} + 1` })
      .where(
        and(
          eq(lessons.moduleId, lesson.moduleId),
          gte(lessons.position, newPosition),
          lt(lessons.position, oldPosition)
        )
      );
  }

  const [row] = await db
    .update(lessons)
    .set({ position: newPosition })
    .where(eq(lessons.id, lessonId))
    .returning();
  return row;
}

export async function swapLessonPositions(opts: { lessonIdA: number; lessonIdB: number }) {
  const { lessonIdA, lessonIdB } = opts;
  const lessonA = await getLessonById(lessonIdA);
  const lessonB = await getLessonById(lessonIdB);
  if (!lessonA || !lessonB) return null;

  await db.update(lessons)
    .set({ position: lessonB.position })
    .where(eq(lessons.id, lessonIdA));

  await db.update(lessons)
    .set({ position: lessonA.position })
    .where(eq(lessons.id, lessonIdB));

  return {
    a: { ...lessonA, position: lessonB.position },
    b: { ...lessonB, position: lessonA.position },
  };
}

export async function reorderLessons(moduleId: number, lessonIds: number[]) {
  for (let i = 0; i < lessonIds.length; i++) {
    await db.update(lessons)
      .set({ position: i + 1 })
      .where(and(eq(lessons.id, lessonIds[i]), eq(lessons.moduleId, moduleId)));
  }
  return await getLessonsByModule(moduleId);
}

/**
 * Move a lesson from one module to another at a specific position.
 * Closes the gap in the source module and opens a gap in the destination module.
 */
export async function moveLessonToModule(opts: {
  lessonId: number;
  targetModuleId: number;
  targetPosition: number;
}) {
  const { lessonId, targetModuleId, targetPosition } = opts;
  const lesson = await getLessonById(lessonId);
  if (!lesson) return null;

  const sourceModuleId = lesson.moduleId;

  // 1. Close the gap in the source module
  await db.update(lessons)
    .set({ position: sql`${lessons.position} - 1` })
    .where(
      and(
        eq(lessons.moduleId, sourceModuleId),
        gt(lessons.position, lesson.position)
      )
    );

  // 2. Open a gap in the destination module
  await db.update(lessons)
    .set({ position: sql`${lessons.position} + 1` })
    .where(
      and(
        eq(lessons.moduleId, targetModuleId),
        gte(lessons.position, targetPosition)
      )
    );

  // 3. Move the lesson to the target module at the target position
  const [row] = await db
    .update(lessons)
    .set({ moduleId: targetModuleId, position: targetPosition })
    .where(eq(lessons.id, lessonId))
    .returning();
  return row;
}
