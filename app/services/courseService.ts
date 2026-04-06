import { eq, like, and, or, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  categories,
  users,
  modules,
  lessons,
  CourseStatus,
} from "~/db/schema";

// ─── Course Service ───
// Handles course CRUD, search, category filtering, and status transitions.

export async function getAllCourses() {
  return await db.select().from(courses);
}

export async function getCourseById(id: number) {
  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  return course;
}

export async function getCourseBySlug(slug: string) {
  const [course] = await db.select().from(courses).where(eq(courses.slug, slug));
  return course;
}

export async function getCoursesByInstructor(instructorId: number) {
  return await db
    .select()
    .from(courses)
    .where(eq(courses.instructorId, instructorId));
}

export async function getCoursesByCategory(categoryId: number) {
  return await db
    .select()
    .from(courses)
    .where(eq(courses.categoryId, categoryId));
}

export async function getCoursesByStatus(status: CourseStatus) {
  return await db.select().from(courses).where(eq(courses.status, status));
}

export async function getPublishedCourses() {
  return await getCoursesByStatus(CourseStatus.Published);
}

export async function buildCourseQuery(opts: {
  search: string | null;
  category: string | null;
  status: CourseStatus | null;
  sortBy: string | null;
  limit: number;
  offset: number;
}) {
  const { search, category, status, sortBy, limit, offset } = opts;
  const conditions = [];

  if (status) {
    conditions.push(eq(courses.status, status));
  }

  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(like(courses.title, term), like(courses.description, term))!
    );
  }

  const query = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      salesCopy: courses.salesCopy,
      instructorId: courses.instructorId,
      categoryId: courses.categoryId,
      status: courses.status,
      coverImageUrl: courses.coverImageUrl,
      price: courses.price,
      pppEnabled: courses.pppEnabled,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      instructorName: users.name,
      instructorAvatarUrl: users.avatarUrl,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id));

  if (category) {
    conditions.push(eq(categories.slug, category));
  }

  const filtered =
    conditions.length > 0 ? query.where(and(...conditions)) : query;

  const sorted =
    sortBy === "title"
      ? filtered.orderBy(courses.title)
      : sortBy === "oldest"
        ? filtered.orderBy(courses.createdAt)
        : filtered.orderBy(sql`${courses.createdAt} DESC`);

  return await sorted.limit(limit).offset(offset);
}

export async function getCourseWithDetails(id: number) {
  const [course] = await db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      description: courses.description,
      salesCopy: courses.salesCopy,
      instructorId: courses.instructorId,
      categoryId: courses.categoryId,
      status: courses.status,
      coverImageUrl: courses.coverImageUrl,
      price: courses.price,
      pppEnabled: courses.pppEnabled,
      createdAt: courses.createdAt,
      updatedAt: courses.updatedAt,
      instructorName: users.name,
      instructorAvatarUrl: users.avatarUrl,
      instructorBio: users.bio,
      categoryName: categories.name,
    })
    .from(courses)
    .innerJoin(users, eq(courses.instructorId, users.id))
    .innerJoin(categories, eq(courses.categoryId, categories.id))
    .where(eq(courses.id, id));

  if (!course) return null;

  const courseModules = await db
    .select()
    .from(modules)
    .where(eq(modules.courseId, id))
    .orderBy(modules.position);

  const moduleIds = courseModules.map((m) => m.id);

  const courseLessons =
    moduleIds.length > 0
      ? await db
          .select()
          .from(lessons)
          .where(or(...moduleIds.map((mid) => eq(lessons.moduleId, mid)))!)
          .orderBy(lessons.position)
      : [];

  return {
    ...course,
    modules: courseModules.map((mod) => ({
      ...mod,
      lessons: courseLessons.filter((l) => l.moduleId === mod.id),
    })),
  };
}

export async function getLessonCountForCourse(courseId: number) {
  const courseModules = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId));

  if (courseModules.length === 0) return 0;

  const [count] = await db
    .select({ count: sql<number>`count(*)` })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id)))!);

  return Number(count?.count ?? 0);
}

export async function createCourse(opts: {
  title: string;
  slug: string;
  description: string;
  instructorId: number;
  categoryId: number;
  coverImageUrl: string | null;
}) {
  const { title, slug, description, instructorId, categoryId, coverImageUrl } = opts;
  const [course] = await db
    .insert(courses)
    .values({
      title,
      slug,
      description,
      instructorId,
      categoryId,
      status: CourseStatus.Draft,
      coverImageUrl,
    })
    .returning();
  return course;
}

export async function updateCourse(opts: { id: number; title: string; description: string }) {
  const { id, title, description } = opts;
  const [course] = await db
    .update(courses)
    .set({ title, description, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning();
  return course;
}

export async function updateCourseStatus(id: number, status: CourseStatus) {
  const [course] = await db
    .update(courses)
    .set({ status, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning();
  return course;
}

export async function updateCourseSalesCopy(id: number, salesCopy: string | null) {
  const [course] = await db
    .update(courses)
    .set({ salesCopy, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning();
  return course;
}

export async function updateCoursePrice(id: number, price: number) {
  const [course] = await db
    .update(courses)
    .set({ price, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning();
  return course;
}

export async function updateCoursePppEnabled(id: number, pppEnabled: boolean) {
  const [course] = await db
    .update(courses)
    .set({ pppEnabled, updatedAt: new Date().toISOString() })
    .where(eq(courses.id, id))
    .returning();
  return course;
}

export async function deleteCourse(id: number) {
  const [course] = await db.delete(courses).where(eq(courses.id, id)).returning();
  return course;
}
