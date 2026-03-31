import { eq, and, isNull } from "drizzle-orm";
import { db } from "~/db";
import { coupons, purchases, enrollments } from "~/db/schema";
import crypto from "crypto";

// ─── Coupon Service ───
// Handles coupon generation, redemption (with validation), and listing.
// Each coupon grants one seat for a specific course within a team.

function generateCode(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export async function generateCoupons(
  teamId: number,
  courseId: number,
  purchaseId: number,
  quantity: number
) {
  const created: (typeof coupons.$inferSelect)[] = [];
  for (let i = 0; i < quantity; i++) {
    const [coupon] = await db
      .insert(coupons)
      .values({
        teamId,
        courseId,
        code: generateCode(),
        purchaseId,
      })
      .returning();
    created.push(coupon);
  }
  return created;
}

export async function getCouponByCode(code: string) {
  const [row] = await db.select().from(coupons).where(eq(coupons.code, code));
  return row;
}

export async function getCouponsForTeam(teamId: number, courseId?: number) {
  if (courseId !== undefined) {
    return db
      .select()
      .from(coupons)
      .where(and(eq(coupons.teamId, teamId), eq(coupons.courseId, courseId)));
  }
  return db.select().from(coupons).where(eq(coupons.teamId, teamId));
}

export type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

export async function redeemCoupon(
  code: string,
  userId: number,
  userCountry: string
): Promise<RedeemResult> {
  // 1. Find the coupon
  const coupon = await getCouponByCode(code);
  if (!coupon) {
    return { ok: false, error: "Coupon not found" };
  }

  // 2. Check if already consumed
  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "Coupon has already been redeemed" };
  }

  // 3. Check if user is already enrolled
  const [existingEnrollment] = await db
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, coupon.courseId)
      )
    );

  if (existingEnrollment) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  // 4. Country check: match purchaser's country
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId));

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    };
  }

  // 5. Redeem: mark coupon consumed + enroll user
  await db.update(coupons)
    .set({
      redeemedByUserId: userId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, coupon.id));

  const [enrollment] = await db
    .insert(enrollments)
    .values({ userId, courseId: coupon.courseId })
    .returning();

  return { ok: true, enrollment };
}
