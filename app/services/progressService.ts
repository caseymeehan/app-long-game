import { eq, and, or, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  lessonProgress,
  lessons,
  modules,
  courses,
  enrollments,
  LessonProgressStatus,
} from "~/db/schema";

// ─── Progress Service ───
// Handles lesson completion tracking and course progress calculation.

export async function getLessonProgress(userId: number, lessonId: number) {
  const [row] = await db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.lessonId, lessonId)
      )
    );
  return row;
}

export async function getLessonProgressForCourse(userId: number, courseId: number) {
  const courseModules = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId));

  if (courseModules.length === 0) return [];

  const courseLessons = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!);

  if (courseLessons.length === 0) return [];

  return db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        or(...courseLessons.map((l) => eq(lessonProgress.lessonId, l.id)))!
      )
    );
}

export async function markLessonComplete(userId: number, lessonId: number) {
  const existing = await getLessonProgress(userId, lessonId);

  if (existing) {
    const [row] = await db
      .update(lessonProgress)
      .set({
        status: LessonProgressStatus.Completed,
        completedAt: new Date().toISOString(),
      })
      .where(eq(lessonProgress.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .returning();
  return row;
}

export async function markLessonInProgress(userId: number, lessonId: number) {
  const existing = await getLessonProgress(userId, lessonId);

  if (existing) {
    if (existing.status === LessonProgressStatus.Completed) {
      return existing;
    }
    const [row] = await db
      .update(lessonProgress)
      .set({ status: LessonProgressStatus.InProgress })
      .where(eq(lessonProgress.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.InProgress,
    })
    .returning();
  return row;
}

export async function resetLessonProgress(userId: number, lessonId: number) {
  const [row] = await db
    .delete(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.lessonId, lessonId)
      )
    )
    .returning();
  return row;
}

async function getCourseLessonIds(courseId: number): Promise<number[]> {
  const courseModules = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId));

  if (courseModules.length === 0) return [];

  const courseLessons = await db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!);

  return courseLessons.map((l) => l.id);
}

export async function calculateProgress(opts: {
  userId: number;
  courseId: number;
  includeQuizzes: boolean;
  weightByDuration: boolean;
}) {
  const { userId, courseId, includeQuizzes, weightByDuration } = opts;
  const lessonIds = await getCourseLessonIds(courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = await db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(or(...lessonIds.map((id) => eq(lessons.id, id)))!);

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = await db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
        )
      );

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const [completedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    );

  return Math.round((Number(completedCount?.count ?? 0) / lessonIds.length) * 100);
}

export async function getCompletedLessonCount(userId: number, courseId: number) {
  const lessonIds = await getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return 0;

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))!
      )
    );

  return Number(result?.count ?? 0);
}

export async function getTotalLessonCount(courseId: number) {
  return (await getCourseLessonIds(courseId)).length;
}

export async function isLessonCompleted(userId: number, lessonId: number) {
  const progress = await getLessonProgress(userId, lessonId);
  return progress?.status === LessonProgressStatus.Completed;
}

export async function getNextIncompleteLesson(userId: number, courseId: number) {
  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position);

  if (courseModules.length === 0) return null;

  for (const mod of courseModules) {
    const moduleLessons = await db
      .select()
      .from(lessons)
      .where(eq(lessons.moduleId, mod.id))
      .orderBy(lessons.position);

    for (const lesson of moduleLessons) {
      const progress = await getLessonProgress(userId, lesson.id);
      if (!progress || progress.status !== LessonProgressStatus.Completed) {
        return lesson;
      }
    }
  }

  return null;
}

export async function getRecentlyProgressedCourses(
  userId: number,
  limit: number = 3
) {
  return db
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      coverImageUrl: courses.coverImageUrl,
      lastActivityId: sql<number>`max(${lessonProgress.id})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessonProgress.userId, userId))
    .groupBy(courses.id)
    .orderBy(desc(sql`max(${lessonProgress.id})`))
    .limit(limit);
}
