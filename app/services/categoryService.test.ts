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
  slugify,
  getAllCategories,
  getCategoryById,
  getCategoryBySlug,
  getCategoryByName,
  getAllCategoriesWithCourseCounts,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./categoryService";

describe("categoryService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    await cleanDb(testDb);
    base = await seedBaseData(testDb);
  });

  // ─── Slug Generation ───

  describe("slugify", () => {
    it("converts name to lowercase slug", () => {
      expect(slugify("Machine Learning")).toBe("machine-learning");
    });

    it("removes special characters", () => {
      expect(slugify("Hello, World! (2024)")).toBe("hello-world-2024");
    });

    it("trims leading and trailing dashes", () => {
      expect(slugify("--hello--")).toBe("hello");
    });

    it("collapses multiple separators", () => {
      expect(slugify("foo   bar")).toBe("foo-bar");
    });

    it("handles already-clean slugs", () => {
      expect(slugify("already-clean")).toBe("already-clean");
    });

    it("handles unicode by stripping non-alphanumeric", () => {
      expect(slugify("café résumé")).toBe("caf-r-sum");
    });

    it("handles empty string", () => {
      expect(slugify("")).toBe("");
    });
  });

  // ─── Read Operations ───

  describe("getAllCategories", () => {
    it("returns all categories", async () => {
      const cats = await getAllCategories();
      expect(cats.length).toBeGreaterThanOrEqual(1);
      expect(cats.some((c) => c.slug === "programming")).toBe(true);
    });

    it("returns categories ordered alphabetically by name", async () => {
      await testDb
        .insert(schema.categories)
        .values({ name: "Zebra Studies", slug: "zebra-studies" });
      await testDb
        .insert(schema.categories)
        .values({ name: "Art", slug: "art" });

      const cats = await getAllCategories();
      const names = cats.map((c) => c.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe("getCategoryById", () => {
    it("returns the category by id", async () => {
      const cat = await getCategoryById(base.category.id);
      expect(cat).toBeDefined();
      expect(cat!.name).toBe("Programming");
    });

    it("returns undefined for non-existent id", async () => {
      expect(await getCategoryById(9999)).toBeUndefined();
    });
  });

  describe("getCategoryBySlug", () => {
    it("returns the category by slug", async () => {
      const cat = await getCategoryBySlug("programming");
      expect(cat).toBeDefined();
      expect(cat!.name).toBe("Programming");
    });

    it("returns undefined for non-existent slug", async () => {
      expect(await getCategoryBySlug("nonexistent")).toBeUndefined();
    });
  });

  describe("getCategoryByName", () => {
    it("returns the category by name", async () => {
      const cat = await getCategoryByName("Programming");
      expect(cat).toBeDefined();
      expect(cat!.slug).toBe("programming");
    });

    it("returns undefined for non-existent name", async () => {
      expect(await getCategoryByName("Nonexistent")).toBeUndefined();
    });
  });

  describe("getAllCategoriesWithCourseCounts", () => {
    it("returns categories with course counts", async () => {
      const cats = await getAllCategoriesWithCourseCounts();
      const programming = cats.find((c) => c.slug === "programming");
      expect(programming).toBeDefined();
      expect(programming!.courseCount).toBe(1);
    });

    it("returns 0 for categories with no courses", async () => {
      await testDb
        .insert(schema.categories)
        .values({ name: "Empty Category", slug: "empty-category" });

      const cats = await getAllCategoriesWithCourseCounts();
      const empty = cats.find((c) => c.slug === "empty-category");
      expect(empty).toBeDefined();
      expect(empty!.courseCount).toBe(0);
    });

    it("returns categories ordered alphabetically", async () => {
      await testDb
        .insert(schema.categories)
        .values({ name: "Art", slug: "art" });

      const cats = await getAllCategoriesWithCourseCounts();
      const names = cats.map((c) => c.name);
      expect(names).toEqual([...names].sort());
    });
  });

  // ─── Create ───

  describe("createCategory", () => {
    it("creates a category with auto-generated slug", async () => {
      const cat = await createCategory("Machine Learning");
      expect(cat.name).toBe("Machine Learning");
      expect(cat.slug).toBe("machine-learning");
      expect(cat.id).toBeDefined();
    });

    it("throws on duplicate name", async () => {
      await expect(() => createCategory("Programming")).rejects.toThrow(
        'A category with the name "Programming" already exists.'
      );
    });

    it("throws on duplicate slug", async () => {
      // "programming!" would produce slug "programming" which already exists
      await testDb
        .insert(schema.categories)
        .values({ name: "Data Science", slug: "data-science" });

      await expect(() => createCategory("Data Science")).rejects.toThrow(
        'A category with the name "Data Science" already exists.'
      );
    });

    it("throws on slug collision even with different name", async () => {
      // Create a category, then try another name that produces the same slug
      await createCategory("Web Dev");
      await expect(() => createCategory("web dev")).rejects.toThrow();
    });
  });

  // ─── Update ───

  describe("updateCategory", () => {
    it("updates name and regenerates slug", async () => {
      const updated = await updateCategory(base.category.id, "Web Development");
      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Web Development");
      expect(updated!.slug).toBe("web-development");
    });

    it("allows updating to the same name (no-op rename)", async () => {
      const updated = await updateCategory(base.category.id, "Programming");
      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Programming");
    });

    it("throws on duplicate name with another category", async () => {
      await testDb
        .insert(schema.categories)
        .values({ name: "Design", slug: "design" });

      await expect(() => updateCategory(base.category.id, "Design")).rejects.toThrow(
        'A category with the name "Design" already exists.'
      );
    });

    it("throws on duplicate slug with another category", async () => {
      await testDb
        .insert(schema.categories)
        .values({ name: "Design", slug: "design" });

      // "design" name → "design" slug, which already exists under a different id
      await expect(() => updateCategory(base.category.id, "Design")).rejects.toThrow();
    });
  });

  // ─── Delete ───

  describe("deleteCategory", () => {
    it("deletes a category with no courses", async () => {
      const [empty] = await testDb
        .insert(schema.categories)
        .values({ name: "Empty", slug: "empty" })
        .returning();

      const deleted = await deleteCategory(empty.id);
      expect(deleted).toBeDefined();
      expect(deleted!.id).toBe(empty.id);
      expect(await getCategoryById(empty.id)).toBeUndefined();
    });

    it("throws when category has courses", async () => {
      await expect(() => deleteCategory(base.category.id)).rejects.toThrow(
        "Cannot delete: 1 course use this category."
      );
    });

    it("includes course count in error message", async () => {
      // Add a second course to the category
      await testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "desc",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Draft,
        });

      await expect(() => deleteCategory(base.category.id)).rejects.toThrow(
        "Cannot delete: 2 courses use this category."
      );
    });
  });
});
