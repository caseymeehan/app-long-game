import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { categories, courses } from "~/db/schema";

// ─── Category Service ───
// Handles category CRUD, slug generation, and uniqueness validation.
// Uses positional parameters (project convention).

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function getAllCategories() {
  return await db.select().from(categories).orderBy(categories.name);
}

export async function getCategoryById(id: number) {
  const [category] = await db.select().from(categories).where(eq(categories.id, id));
  return category;
}

export async function getCategoryBySlug(slug: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.slug, slug));
  return category;
}

export async function getCategoryByName(name: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(eq(categories.name, name));
  return category;
}

export async function getAllCategoriesWithCourseCounts() {
  return await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      courseCount: sql<number>`count(${courses.id})`,
    })
    .from(categories)
    .leftJoin(courses, eq(categories.id, courses.categoryId))
    .groupBy(categories.id)
    .orderBy(categories.name);
}

export async function createCategory(name: string) {
  const slug = slugify(name);

  const existingName = await getCategoryByName(name);
  if (existingName) {
    throw new Error(`A category with the name "${name}" already exists.`);
  }

  const existingSlug = await getCategoryBySlug(slug);
  if (existingSlug) {
    throw new Error(`A category with the slug "${slug}" already exists.`);
  }

  const [category] = await db
    .insert(categories)
    .values({ name, slug })
    .returning();
  return category;
}

export async function updateCategory(id: number, name: string) {
  const slug = slugify(name);

  const existingName = await getCategoryByName(name);
  if (existingName && existingName.id !== id) {
    throw new Error(`A category with the name "${name}" already exists.`);
  }

  const existingSlug = await getCategoryBySlug(slug);
  if (existingSlug && existingSlug.id !== id) {
    throw new Error(`A category with the slug "${slug}" already exists.`);
  }

  const [category] = await db
    .update(categories)
    .set({ name, slug })
    .where(eq(categories.id, id))
    .returning();
  return category;
}

export async function deleteCategory(id: number) {
  const [courseCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(courses)
    .where(eq(courses.categoryId, id));

  const count = courseCount?.count ?? 0;
  if (count > 0) {
    throw new Error(
      `Cannot delete: ${count} course${count === 1 ? "" : "s"} use this category.`
    );
  }

  const [category] = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning();
  return category;
}
