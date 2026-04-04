import { eq, sql, asc } from "drizzle-orm";
import { db } from "~/db";
import {
  partnerResourceCategories,
  partnerResources,
  partnerPageSettings,
} from "~/db/schema";

// ─── Partner Resource Service ───
// Handles partner resource categories, resources, and page settings.

// ─── Page Settings ───

export async function getPageSettings() {
  const [row] = await db.select().from(partnerPageSettings).limit(1);
  return row;
}

export async function upsertPageSettings(
  content: string | null,
  videoUrl: string | null
) {
  const existing = await getPageSettings();
  if (existing) {
    const [row] = await db
      .update(partnerPageSettings)
      .set({ content, videoUrl, updatedAt: new Date().toISOString() })
      .where(eq(partnerPageSettings.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(partnerPageSettings)
    .values({ content, videoUrl })
    .returning();
  return row;
}

// ─── Categories ───

export async function getAllCategories() {
  return await db
    .select()
    .from(partnerResourceCategories)
    .orderBy(asc(partnerResourceCategories.position));
}

export async function getCategoryById(id: number) {
  const [row] = await db
    .select()
    .from(partnerResourceCategories)
    .where(eq(partnerResourceCategories.id, id));
  return row;
}

export async function createCategory(title: string) {
  const [maxResult] = await db
    .select({
      max: sql<number>`coalesce(max(${partnerResourceCategories.position}), 0)`,
    })
    .from(partnerResourceCategories);
  const position = maxResult!.max + 1;

  const [row] = await db
    .insert(partnerResourceCategories)
    .values({ title, position })
    .returning();
  return row;
}

export async function updateCategory(id: number, title: string) {
  const [row] = await db
    .update(partnerResourceCategories)
    .set({ title })
    .where(eq(partnerResourceCategories.id, id))
    .returning();
  return row;
}

export async function deleteCategory(id: number) {
  // Delete all resources in this category first
  await db
    .delete(partnerResources)
    .where(eq(partnerResources.categoryId, id));
  const [row] = await db
    .delete(partnerResourceCategories)
    .where(eq(partnerResourceCategories.id, id))
    .returning();
  return row;
}

export async function reorderCategories(orderedIds: number[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(partnerResourceCategories)
      .set({ position: i + 1 })
      .where(eq(partnerResourceCategories.id, orderedIds[i]));
  }
}

// ─── Resources ───

export async function getResourcesByCategory(categoryId: number) {
  return await db
    .select()
    .from(partnerResources)
    .where(eq(partnerResources.categoryId, categoryId))
    .orderBy(asc(partnerResources.position));
}

export async function getResourceById(id: number) {
  const [row] = await db
    .select()
    .from(partnerResources)
    .where(eq(partnerResources.id, id));
  return row;
}

export async function createResource(categoryId: number, title: string) {
  const [maxResult] = await db
    .select({
      max: sql<number>`coalesce(max(${partnerResources.position}), 0)`,
    })
    .from(partnerResources)
    .where(eq(partnerResources.categoryId, categoryId));
  const position = maxResult!.max + 1;

  const [row] = await db
    .insert(partnerResources)
    .values({ categoryId, title, position })
    .returning();
  return row;
}

export async function updateResource(
  id: number,
  title: string | null,
  content: string | null
) {
  const updates: Record<string, unknown> = {};
  if (title !== null) updates.title = title;
  if (content !== null) updates.content = content;

  const [row] = await db
    .update(partnerResources)
    .set(updates)
    .where(eq(partnerResources.id, id))
    .returning();
  return row;
}

export async function deleteResource(id: number) {
  const [row] = await db
    .delete(partnerResources)
    .where(eq(partnerResources.id, id))
    .returning();
  return row;
}

export async function reorderResources(
  categoryId: number,
  orderedIds: number[]
) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(partnerResources)
      .set({ position: i + 1 })
      .where(eq(partnerResources.id, orderedIds[i]));
  }
}

// ─── Combined Queries ───

export async function getAllCategoriesWithResources() {
  const categories = await getAllCategories();
  const result = await Promise.all(
    categories.map(async (cat) => {
      const resources = await getResourcesByCategory(cat.id);
      return { ...cat, resources };
    })
  );
  return result;
}
