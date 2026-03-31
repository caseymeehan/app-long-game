import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { purchases } from "~/db/schema";
import { getOrCreateTeamForUser } from "./teamService";
import { generateCoupons } from "./couponService";

// ─── Purchase Service ───
// Handles purchase records (transaction log separate from enrollments).
// Uses positional parameters (project convention).

export async function createPurchase(
  userId: number,
  courseId: number,
  pricePaid: number,
  country: string | null
) {
  const [row] = await db
    .insert(purchases)
    .values({ userId, courseId, pricePaid, country })
    .returning();
  return row;
}

export async function findPurchase(userId: number, courseId: number) {
  const [row] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)));
  return row;
}

export async function getPurchasesByUser(userId: number) {
  return db.select().from(purchases).where(eq(purchases.userId, userId));
}

export async function getPurchasesByCourse(courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(eq(purchases.courseId, courseId));
}

// ─── Team Purchase ───

export async function createTeamPurchase(
  userId: number,
  courseId: number,
  pricePaid: number,
  country: string | null,
  quantity: number
) {
  const purchase = await createPurchase(userId, courseId, pricePaid, country);
  const team = await getOrCreateTeamForUser(userId);
  const coupons = await generateCoupons(team.id, courseId, purchase.id, quantity);
  return { purchase, team, coupons };
}
