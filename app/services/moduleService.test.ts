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

// Import after mock so the module picks up our test db
import {
  getModuleById,
  getModulesByCourse,
  getModuleWithLessons,
  createModule,
  updateModuleTitle,
  deleteModule,
  getModuleCount,
  moveModuleToPosition,
  swapModulePositions,
  reorderModules,
} from "./moduleService";
import { createLesson } from "./lessonService";

describe("moduleService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    await cleanDb(testDb);
    base = await seedBaseData(testDb);
  });

  // ─── CRUD ───

  describe("createModule", () => {
    it("creates a module with an explicit position", async () => {
      const mod = await createModule(base.course.id, "Module 1", 1);

      expect(mod).toBeDefined();
      expect(mod.title).toBe("Module 1");
      expect(mod.courseId).toBe(base.course.id);
      expect(mod.position).toBe(1);
    });

    it("auto-calculates position when null", async () => {
      await createModule(base.course.id, "Module 1", null);
      const mod2 = await createModule(base.course.id, "Module 2", null);

      expect(mod2.position).toBe(2);
    });

    it("starts auto position at 1 for empty course", async () => {
      const mod = await createModule(base.course.id, "First Module", null);

      expect(mod.position).toBe(1);
    });
  });

  describe("getModuleById", () => {
    it("returns a module by id", async () => {
      const created = await createModule(base.course.id, "Mod A", 1);

      const found = await getModuleById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe("Mod A");
    });

    it("returns undefined for non-existent id", async () => {
      expect(await getModuleById(9999)).toBeUndefined();
    });
  });

  describe("getModulesByCourse", () => {
    it("returns modules ordered by position", async () => {
      await createModule(base.course.id, "Second", 2);
      await createModule(base.course.id, "First", 1);
      await createModule(base.course.id, "Third", 3);

      const mods = await getModulesByCourse(base.course.id);
      expect(mods).toHaveLength(3);
      expect(mods[0].title).toBe("First");
      expect(mods[1].title).toBe("Second");
      expect(mods[2].title).toBe("Third");
    });

    it("returns empty array for course with no modules", async () => {
      expect(await getModulesByCourse(base.course.id)).toHaveLength(0);
    });
  });

  describe("getModuleWithLessons", () => {
    it("returns module with its lessons ordered by position", async () => {
      const mod = await createModule(base.course.id, "Module A", 1);
      await createLesson({ moduleId: mod.id, title: "Lesson 2", content: null, videoUrl: null, position: 2, durationMinutes: null });
      await createLesson({ moduleId: mod.id, title: "Lesson 1", content: null, videoUrl: null, position: 1, durationMinutes: null });

      const result = await getModuleWithLessons(mod.id);
      expect(result).toBeDefined();
      expect(result!.title).toBe("Module A");
      expect(result!.lessons).toHaveLength(2);
      expect(result!.lessons[0].title).toBe("Lesson 1");
      expect(result!.lessons[1].title).toBe("Lesson 2");
    });

    it("returns null for non-existent module", async () => {
      expect(await getModuleWithLessons(9999)).toBeNull();
    });
  });

  describe("updateModuleTitle", () => {
    it("updates the module title", async () => {
      const mod = await createModule(base.course.id, "Old Title", 1);

      const updated = await updateModuleTitle(mod.id, "New Title");
      expect(updated).toBeDefined();
      expect(updated!.title).toBe("New Title");
    });
  });

  describe("deleteModule", () => {
    it("deletes a module and its lessons", async () => {
      const mod = await createModule(base.course.id, "To Delete", 1);
      await createLesson({ moduleId: mod.id, title: "Lesson 1", content: null, videoUrl: null, position: 1, durationMinutes: null });
      await createLesson({ moduleId: mod.id, title: "Lesson 2", content: null, videoUrl: null, position: 2, durationMinutes: null });

      const deleted = await deleteModule(mod.id);
      expect(deleted).toBeDefined();
      expect(deleted!.id).toBe(mod.id);

      expect(await getModuleById(mod.id)).toBeUndefined();
    });
  });

  describe("getModuleCount", () => {
    it("returns the number of modules in a course", async () => {
      await createModule(base.course.id, "M1", 1);
      await createModule(base.course.id, "M2", 2);

      expect(await getModuleCount(base.course.id)).toBe(2);
    });

    it("returns 0 for course with no modules", async () => {
      expect(await getModuleCount(base.course.id)).toBe(0);
    });
  });

  // ─── Reordering ───

  describe("moveModuleToPosition", () => {
    it("moves a module down (position 1 → 3)", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      const moved = await moveModuleToPosition({ moduleId: m1.id, newPosition: 3 });
      expect(moved!.position).toBe(3);

      // M2 and M3 should have shifted up
      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M2");
      expect(mods[0].position).toBe(1);
      expect(mods[1].title).toBe("M3");
      expect(mods[1].position).toBe(2);
      expect(mods[2].title).toBe("M1");
      expect(mods[2].position).toBe(3);
    });

    it("moves a module up (position 3 → 1)", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      const moved = await moveModuleToPosition({ moduleId: m3.id, newPosition: 1 });
      expect(moved!.position).toBe(1);

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M3");
      expect(mods[0].position).toBe(1);
      expect(mods[1].title).toBe("M1");
      expect(mods[1].position).toBe(2);
      expect(mods[2].title).toBe("M2");
      expect(mods[2].position).toBe(3);
    });

    it("returns module unchanged when moving to same position", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);

      const result = await moveModuleToPosition({ moduleId: m1.id, newPosition: 1 });
      expect(result!.position).toBe(1);
    });

    it("returns null for non-existent module", async () => {
      expect(await moveModuleToPosition({ moduleId: 9999, newPosition: 1 })).toBeNull();
    });

    it("moves a module to middle position (1 → 2 of 3)", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      await moveModuleToPosition({ moduleId: m1.id, newPosition: 2 });

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M2");
      expect(mods[0].position).toBe(1);
      expect(mods[1].title).toBe("M1");
      expect(mods[1].position).toBe(2);
      expect(mods[2].title).toBe("M3");
      expect(mods[2].position).toBe(3);
    });

    it("moves from middle to top (2 → 1 of 3)", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      await moveModuleToPosition({ moduleId: m2.id, newPosition: 1 });

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M2");
      expect(mods[0].position).toBe(1);
      expect(mods[1].title).toBe("M1");
      expect(mods[1].position).toBe(2);
      expect(mods[2].title).toBe("M3");
      expect(mods[2].position).toBe(3);
    });

    it("does not affect modules in other courses", async () => {
      // Create a second course
      const [course2] = await testDb
        .insert(schema.courses)
        .values({
          title: "Course 2",
          slug: "course-2",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning();

      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const other = await createModule(course2.id, "Other M1", 1);

      await moveModuleToPosition({ moduleId: m1.id, newPosition: 2 });

      // Other course's module should be untouched
      const otherMod = await getModuleById(other.id);
      expect(otherMod!.position).toBe(1);
    });
  });

  describe("swapModulePositions", () => {
    it("swaps positions of two modules", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);

      const result = await swapModulePositions({ moduleIdA: m1.id, moduleIdB: m2.id });
      expect(result).toBeDefined();
      expect(result!.a.position).toBe(2);
      expect(result!.b.position).toBe(1);

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M2");
      expect(mods[1].title).toBe("M1");
    });

    it("swaps non-adjacent modules", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      await swapModulePositions({ moduleIdA: m1.id, moduleIdB: m3.id });

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].title).toBe("M3");
      expect(mods[0].position).toBe(1);
      expect(mods[1].title).toBe("M2");
      expect(mods[1].position).toBe(2);
      expect(mods[2].title).toBe("M1");
      expect(mods[2].position).toBe(3);
    });

    it("returns null when first module does not exist", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);

      expect(await swapModulePositions({ moduleIdA: 9999, moduleIdB: m1.id })).toBeNull();
    });

    it("returns null when second module does not exist", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);

      expect(await swapModulePositions({ moduleIdA: m1.id, moduleIdB: 9999 })).toBeNull();
    });
  });

  describe("reorderModules", () => {
    it("reorders modules according to the given id array", async () => {
      const m1 = await createModule(base.course.id, "M1", 1);
      const m2 = await createModule(base.course.id, "M2", 2);
      const m3 = await createModule(base.course.id, "M3", 3);

      // Reverse the order: M3 → pos 1, M2 → pos 2, M1 → pos 3
      const result = await reorderModules(base.course.id, [m3.id, m2.id, m1.id]);

      // Result is ordered by position (returned by getModulesByCourse)
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("M3");
      expect(result[0].position).toBe(1);
      expect(result[1].title).toBe("M2");
      expect(result[1].position).toBe(2);
      expect(result[2].title).toBe("M1");
      expect(result[2].position).toBe(3);
    });

    it("assigns positions starting at 1", async () => {
      const m1 = await createModule(base.course.id, "M1", 10);
      const m2 = await createModule(base.course.id, "M2", 20);

      await reorderModules(base.course.id, [m2.id, m1.id]);

      const mods = await getModulesByCourse(base.course.id);
      expect(mods[0].position).toBe(1);
      expect(mods[1].position).toBe(2);
    });

    it("does not reorder modules from a different course", async () => {
      const [course2] = await testDb
        .insert(schema.courses)
        .values({
          title: "Course 2",
          slug: "course-2",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning();

      const m1 = await createModule(base.course.id, "M1", 1);
      const other = await createModule(course2.id, "Other", 1);

      // Try to reorder with a module from another course — it won't be affected
      await reorderModules(base.course.id, [other.id, m1.id]);

      // m1 should have position 2 (second in the array), other should be unchanged
      const otherMod = await getModuleById(other.id);
      expect(otherMod!.position).toBe(1); // unchanged — courseId filter prevents update
    });
  });
});
