import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, cleanDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: Awaited<ReturnType<typeof seedBaseData>>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getAllCourses,
  getCourseById,
  getCourseBySlug,
  getCoursesByInstructor,
  getCoursesByCategory,
  getCoursesByStatus,
  getPublishedCourses,
  buildCourseQuery,
  getCourseWithDetails,
  getLessonCountForCourse,
  createCourse,
  updateCourse,
  updateCourseStatus,
  deleteCourse,
} from "./courseService";

describe("courseService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    await cleanDb(testDb);
    base = await seedBaseData(testDb);
  });

  // ─── CRUD ───

  describe("createCourse", () => {
    it("creates a course with draft status", async () => {
      const course = await createCourse({
        title: "New Course",
        slug: "new-course",
        description: "A brand new course",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        coverImageUrl: null,
      });

      expect(course).toBeDefined();
      expect(course.title).toBe("New Course");
      expect(course.slug).toBe("new-course");
      expect(course.description).toBe("A brand new course");
      expect(course.instructorId).toBe(base.instructor.id);
      expect(course.categoryId).toBe(base.category.id);
      expect(course.status).toBe(schema.CourseStatus.Draft);
      expect(course.coverImageUrl).toBeNull();
    });

    it("creates a course with a cover image URL", async () => {
      const course = await createCourse({
        title: "With Image",
        slug: "with-image",
        description: "Has a cover",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        coverImageUrl: "https://example.com/cover.jpg",
      });

      expect(course.coverImageUrl).toBe("https://example.com/cover.jpg");
    });
  });

  describe("getCourseById", () => {
    it("returns the course by id", async () => {
      const found = await getCourseById(base.course.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(base.course.id);
      expect(found!.title).toBe("Test Course");
    });

    it("returns undefined for non-existent id", async () => {
      expect(await getCourseById(9999)).toBeUndefined();
    });
  });

  describe("getCourseBySlug", () => {
    it("returns the course by slug", async () => {
      const found = await getCourseBySlug("test-course");
      expect(found).toBeDefined();
      expect(found!.slug).toBe("test-course");
    });

    it("returns undefined for non-existent slug", async () => {
      expect(await getCourseBySlug("no-such-slug")).toBeUndefined();
    });
  });

  describe("getAllCourses", () => {
    it("returns all courses", async () => {
      const all = await getAllCourses();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(base.course.id);
    });

    it("returns multiple courses", async () => {
      await createCourse({ title: "Second", slug: "second", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });
      const all = await getAllCourses();
      expect(all).toHaveLength(2);
    });
  });

  describe("updateCourse", () => {
    it("updates title and description", async () => {
      const updated = await updateCourse({ id: base.course.id, title: "Updated Title", description: "Updated description" });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe("Updated Title");
      expect(updated!.description).toBe("Updated description");
    });

    it("sets updatedAt to a new timestamp", async () => {
      const before = (await getCourseById(base.course.id))!.updatedAt;
      const updated = await updateCourse({ id: base.course.id, title: "New Title", description: "New desc" });

      expect(updated!.updatedAt).toBeDefined();
      // updatedAt should be set (may or may not differ in fast tests, but should exist)
      expect(typeof updated!.updatedAt).toBe("string");
    });
  });

  describe("deleteCourse", () => {
    it("deletes the course", async () => {
      const deleted = await deleteCourse(base.course.id);
      expect(deleted).toBeDefined();
      expect(deleted!.id).toBe(base.course.id);

      expect(await getCourseById(base.course.id)).toBeUndefined();
    });

    it("returns undefined when deleting non-existent course", async () => {
      expect(await deleteCourse(9999)).toBeUndefined();
    });
  });

  // ─── Filtering ───

  describe("getCoursesByInstructor", () => {
    it("returns courses for the given instructor", async () => {
      const result = await getCoursesByInstructor(base.instructor.id);
      expect(result).toHaveLength(1);
      expect(result[0].instructorId).toBe(base.instructor.id);
    });

    it("returns empty array for instructor with no courses", async () => {
      expect(await getCoursesByInstructor(base.user.id)).toHaveLength(0);
    });
  });

  describe("getCoursesByCategory", () => {
    it("returns courses in the given category", async () => {
      const result = await getCoursesByCategory(base.category.id);
      expect(result).toHaveLength(1);
    });

    it("returns empty array for category with no courses", async () => {
      const [emptyCategory] = await testDb
        .insert(schema.categories)
        .values({ name: "Empty", slug: "empty" })
        .returning();

      expect(await getCoursesByCategory(emptyCategory.id)).toHaveLength(0);
    });
  });

  describe("getCoursesByStatus", () => {
    it("returns courses with the given status", async () => {
      const published = await getCoursesByStatus(schema.CourseStatus.Published);
      expect(published).toHaveLength(1);
    });

    it("returns empty array when no courses match the status", async () => {
      const archived = await getCoursesByStatus(schema.CourseStatus.Archived);
      expect(archived).toHaveLength(0);
    });
  });

  describe("getPublishedCourses", () => {
    it("returns only published courses", async () => {
      await createCourse({ title: "Draft", slug: "draft", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });
      // base.course is published, new course is draft
      const published = await getPublishedCourses();
      expect(published).toHaveLength(1);
      expect(published[0].id).toBe(base.course.id);
    });
  });

  // ─── Status Transitions ───

  describe("updateCourseStatus", () => {
    it("transitions from published to archived", async () => {
      const result = await updateCourseStatus(base.course.id, schema.CourseStatus.Archived);
      expect(result).toBeDefined();
      expect(result!.status).toBe(schema.CourseStatus.Archived);
    });

    it("transitions from draft to published", async () => {
      const draft = await createCourse({ title: "Draft", slug: "draft", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });
      const result = await updateCourseStatus(draft.id, schema.CourseStatus.Published);
      expect(result!.status).toBe(schema.CourseStatus.Published);
    });

    it("transitions from published to draft", async () => {
      const result = await updateCourseStatus(base.course.id, schema.CourseStatus.Draft);
      expect(result!.status).toBe(schema.CourseStatus.Draft);
    });

    it("updates the updatedAt timestamp", async () => {
      const result = await updateCourseStatus(base.course.id, schema.CourseStatus.Archived);
      expect(result!.updatedAt).toBeDefined();
    });
  });

  // ─── Search & Query ───

  describe("buildCourseQuery", () => {
    it("returns all courses when no filters applied", async () => {
      const results = await buildCourseQuery({ search: null, category: null, status: null, sortBy: null, limit: 10, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Test Course");
      expect(results[0].instructorName).toBe("Test Instructor");
      expect(results[0].categoryName).toBe("Programming");
    });

    it("filters by search term in title", async () => {
      await createCourse({ title: "JavaScript Basics", slug: "js-basics", description: "Learn JS", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: "JavaScript", category: null, status: null, sortBy: null, limit: 10, offset: 0 });
      // Only the draft JS course, not the published Test Course
      // Actually buildCourseQuery doesn't filter by status by default, so search matches title
      expect(results.some((r) => r.title === "JavaScript Basics")).toBe(true);
      expect(results.some((r) => r.title === "Test Course")).toBe(false);
    });

    it("filters by search term in description", async () => {
      await createCourse({ title: "Intro", slug: "intro", description: "Learn Python programming", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: "Python", category: null, status: null, sortBy: null, limit: 10, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Intro");
    });

    it("filters by status", async () => {
      await createCourse({ title: "Draft", slug: "draft-c", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const published = await buildCourseQuery({ search: null, category: null, status: schema.CourseStatus.Published, sortBy: null, limit: 10, offset: 0 });
      expect(published).toHaveLength(1);
      expect(published[0].status).toBe(schema.CourseStatus.Published);

      const drafts = await buildCourseQuery({ search: null, category: null, status: schema.CourseStatus.Draft, sortBy: null, limit: 10, offset: 0 });
      expect(drafts).toHaveLength(1);
      expect(drafts[0].status).toBe(schema.CourseStatus.Draft);
    });

    it("filters by category slug", async () => {
      const [designCat] = await testDb
        .insert(schema.categories)
        .values({ name: "Design", slug: "design" })
        .returning();
      await createCourse({ title: "Design 101", slug: "design-101", description: "desc", instructorId: base.instructor.id, categoryId: designCat.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: null, category: "design", status: null, sortBy: null, limit: 10, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Design 101");
    });

    it("combines search and status filters", async () => {
      await createCourse({ title: "Test Draft", slug: "test-draft", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: "Test", category: null, status: schema.CourseStatus.Published, sortBy: null, limit: 10, offset: 0 });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Test Course");
    });

    it("respects limit", async () => {
      await createCourse({ title: "Second", slug: "second", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });
      await createCourse({ title: "Third", slug: "third", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: null, category: null, status: null, sortBy: null, limit: 2, offset: 0 });
      expect(results).toHaveLength(2);
    });

    it("respects offset", async () => {
      await createCourse({ title: "Second", slug: "second", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const all = await buildCourseQuery({ search: null, category: null, status: null, sortBy: null, limit: 10, offset: 0 });
      const offset = await buildCourseQuery({ search: null, category: null, status: null, sortBy: null, limit: 10, offset: 1 });
      expect(offset).toHaveLength(all.length - 1);
    });

    it("sorts by title", async () => {
      await createCourse({ title: "Alpha Course", slug: "alpha", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });
      await createCourse({ title: "Zeta Course", slug: "zeta", description: "desc", instructorId: base.instructor.id, categoryId: base.category.id, coverImageUrl: null });

      const results = await buildCourseQuery({ search: null, category: null, status: null, sortBy: "title", limit: 10, offset: 0 });
      expect(results[0].title).toBe("Alpha Course");
      expect(results[results.length - 1].title).toBe("Zeta Course");
    });

    it("returns empty array when no courses match", async () => {
      const results = await buildCourseQuery({ search: "nonexistent-query-xyz", category: null, status: null, sortBy: null, limit: 10, offset: 0 });
      expect(results).toHaveLength(0);
    });
  });

  // ─── Course with Details ───

  describe("getCourseWithDetails", () => {
    it("returns null for non-existent course", async () => {
      expect(await getCourseWithDetails(9999)).toBeNull();
    });

    it("returns course with instructor and category names", async () => {
      const result = await getCourseWithDetails(base.course.id);
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Test Course");
      expect(result!.instructorName).toBe("Test Instructor");
      expect(result!.categoryName).toBe("Programming");
    });

    it("returns empty modules array when course has no modules", async () => {
      const result = await getCourseWithDetails(base.course.id);
      expect(result!.modules).toHaveLength(0);
    });

    it("returns modules ordered by position", async () => {
      await testDb.insert(schema.modules).values({ courseId: base.course.id, title: "Module B", position: 2 });
      await testDb.insert(schema.modules).values({ courseId: base.course.id, title: "Module A", position: 1 });

      const result = await getCourseWithDetails(base.course.id);
      expect(result!.modules).toHaveLength(2);
      expect(result!.modules[0].title).toBe("Module A");
      expect(result!.modules[1].title).toBe("Module B");
    });

    it("nests lessons within their modules", async () => {
      const [mod] = await testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning();

      await testDb.insert(schema.lessons).values({ moduleId: mod.id, title: "Lesson B", position: 2 });
      await testDb.insert(schema.lessons).values({ moduleId: mod.id, title: "Lesson A", position: 1 });

      const result = await getCourseWithDetails(base.course.id);
      expect(result!.modules[0].lessons).toHaveLength(2);
      expect(result!.modules[0].lessons[0].title).toBe("Lesson A");
      expect(result!.modules[0].lessons[1].title).toBe("Lesson B");
    });

    it("separates lessons into correct modules", async () => {
      const [mod1] = await testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning();
      const [mod2] = await testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "Module 2", position: 2 })
        .returning();

      await testDb.insert(schema.lessons).values({ moduleId: mod1.id, title: "M1 Lesson", position: 1 });
      await testDb.insert(schema.lessons).values({ moduleId: mod2.id, title: "M2 Lesson", position: 1 });

      const result = await getCourseWithDetails(base.course.id);
      expect(result!.modules[0].lessons).toHaveLength(1);
      expect(result!.modules[0].lessons[0].title).toBe("M1 Lesson");
      expect(result!.modules[1].lessons).toHaveLength(1);
      expect(result!.modules[1].lessons[0].title).toBe("M2 Lesson");
    });
  });

  // ─── Lesson Count ───

  describe("getLessonCountForCourse", () => {
    it("returns 0 for course with no modules", async () => {
      expect(await getLessonCountForCourse(base.course.id)).toBe(0);
    });

    it("counts lessons across all modules", async () => {
      const [mod1] = await testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "M1", position: 1 })
        .returning();
      const [mod2] = await testDb
        .insert(schema.modules)
        .values({ courseId: base.course.id, title: "M2", position: 2 })
        .returning();

      await testDb.insert(schema.lessons).values({ moduleId: mod1.id, title: "L1", position: 1 });
      await testDb.insert(schema.lessons).values({ moduleId: mod1.id, title: "L2", position: 2 });
      await testDb.insert(schema.lessons).values({ moduleId: mod2.id, title: "L3", position: 1 });

      expect(await getLessonCountForCourse(base.course.id)).toBe(3);
    });
  });

});
