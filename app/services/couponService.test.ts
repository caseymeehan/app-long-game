import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
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
  generateCoupons,
  getCouponByCode,
  getCouponsForTeam,
  redeemCoupon,
} from "./couponService";

// Helper: create a team with admin and a purchase for coupon generation
async function setupTeamAndPurchase(country: string | null = "US") {
  const [team] = await testDb.insert(schema.teams).values({}).returning();

  await testDb
    .insert(schema.teamMembers)
    .values({
      teamId: team.id,
      userId: base.user.id,
      role: schema.TeamMemberRole.Admin,
    });

  const [purchase] = await testDb
    .insert(schema.purchases)
    .values({
      userId: base.user.id,
      courseId: base.course.id,
      pricePaid: 10000,
      country,
    })
    .returning();

  return { team, purchase };
}

// Helper: create a second user (the redeemer)
async function createRedeemer() {
  const [redeemer] = await testDb
    .insert(schema.users)
    .values({
      name: "Redeemer",
      email: "redeemer@example.com",
      role: schema.UserRole.Student,
    })
    .returning();
  return redeemer;
}

describe("couponService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    base = await seedBaseData(testDb);
  });

  describe("generateCoupons", () => {
    it("generates the requested number of coupons", async () => {
      const { team, purchase } = await setupTeamAndPurchase();

      const result = await generateCoupons(team.id, base.course.id, purchase.id, 5);

      expect(result).toHaveLength(5);
    });

    it("generates unique codes for each coupon", async () => {
      const { team, purchase } = await setupTeamAndPurchase();

      const result = await generateCoupons(team.id, base.course.id, purchase.id, 10);
      const codes = result.map((c) => c.code);
      const uniqueCodes = new Set(codes);

      expect(uniqueCodes.size).toBe(10);
    });

    it("associates coupons with the correct team, course, and purchase", async () => {
      const { team, purchase } = await setupTeamAndPurchase();

      const result = await generateCoupons(team.id, base.course.id, purchase.id, 1);

      expect(result[0].teamId).toBe(team.id);
      expect(result[0].courseId).toBe(base.course.id);
      expect(result[0].purchaseId).toBe(purchase.id);
      expect(result[0].redeemedByUserId).toBeNull();
      expect(result[0].redeemedAt).toBeNull();
    });
  });

  describe("getCouponByCode", () => {
    it("returns a coupon by its code", async () => {
      const { team, purchase } = await setupTeamAndPurchase();
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];

      const found = await getCouponByCode(coupon.code);

      expect(found).toBeDefined();
      expect(found!.id).toBe(coupon.id);
    });

    it("returns undefined for a nonexistent code", async () => {
      const found = await getCouponByCode("nonexistent-code");

      expect(found).toBeUndefined();
    });
  });

  describe("getCouponsForTeam", () => {
    it("returns all coupons for a team", async () => {
      const { team, purchase } = await setupTeamAndPurchase();
      await generateCoupons(team.id, base.course.id, purchase.id, 3);

      const result = await getCouponsForTeam(team.id);

      expect(result).toHaveLength(3);
    });

    it("filters coupons by course when courseId is provided", async () => {
      const { team, purchase } = await setupTeamAndPurchase();

      // Create a second course
      const [course2] = await testDb
        .insert(schema.courses)
        .values({
          title: "Second Course",
          slug: "second-course",
          description: "Another course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning();

      const [purchase2] = await testDb
        .insert(schema.purchases)
        .values({
          userId: base.user.id,
          courseId: course2.id,
          pricePaid: 5000,
          country: "US",
        })
        .returning();

      await generateCoupons(team.id, base.course.id, purchase.id, 3);
      await generateCoupons(team.id, course2.id, purchase2.id, 2);

      const filtered = await getCouponsForTeam(team.id, base.course.id);
      expect(filtered).toHaveLength(3);

      const filtered2 = await getCouponsForTeam(team.id, course2.id);
      expect(filtered2).toHaveLength(2);

      const all = await getCouponsForTeam(team.id);
      expect(all).toHaveLength(5);
    });
  });

  describe("redeemCoupon", () => {
    it("redeems a valid coupon and enrolls the user", async () => {
      const { team, purchase } = await setupTeamAndPurchase();
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];
      const redeemer = await createRedeemer();

      const result = await redeemCoupon(coupon.code, redeemer.id, "US");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.enrollment.userId).toBe(redeemer.id);
        expect(result.enrollment.courseId).toBe(base.course.id);
      }

      // Verify coupon is marked as redeemed
      const updated = await getCouponByCode(coupon.code);
      expect(updated!.redeemedByUserId).toBe(redeemer.id);
      expect(updated!.redeemedAt).toBeDefined();
    });

    it("rejects redemption of a nonexistent code", async () => {
      const result = await redeemCoupon("nonexistent-code", 999, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Coupon not found");
      }
    });

    it("rejects redemption of an already-consumed coupon", async () => {
      const { team, purchase } = await setupTeamAndPurchase();
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];
      const redeemer = await createRedeemer();

      // First redemption succeeds
      await redeemCoupon(coupon.code, redeemer.id, "US");

      // Second redemption (different user) fails
      const [anotherUser] = await testDb
        .insert(schema.users)
        .values({
          name: "Another User",
          email: "another@example.com",
          role: schema.UserRole.Student,
        })
        .returning();

      const result = await redeemCoupon(coupon.code, anotherUser.id, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Coupon has already been redeemed");
      }
    });

    it("rejects redemption when user is already enrolled (coupon stays unconsumed)", async () => {
      const { team, purchase } = await setupTeamAndPurchase();
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];
      const redeemer = await createRedeemer();

      // Enroll the user first (outside the coupon flow)
      await testDb
        .insert(schema.enrollments)
        .values({ userId: redeemer.id, courseId: base.course.id });

      const result = await redeemCoupon(coupon.code, redeemer.id, "US");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("You are already enrolled in this course");
      }

      // Verify coupon is NOT consumed
      const unchanged = await getCouponByCode(coupon.code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("rejects redemption from a different country", async () => {
      const { team, purchase } = await setupTeamAndPurchase("US");
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];
      const redeemer = await createRedeemer();

      const result = await redeemCoupon(coupon.code, redeemer.id, "PL");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "This coupon can only be redeemed from the same country as the purchaser"
        );
      }

      // Verify coupon is NOT consumed
      const unchanged = await getCouponByCode(coupon.code);
      expect(unchanged!.redeemedByUserId).toBeNull();
    });

    it("allows redemption when purchase has no country set", async () => {
      const { team, purchase } = await setupTeamAndPurchase(null);
      const coupons = await generateCoupons(team.id, base.course.id, purchase.id, 1);
      const coupon = coupons[0];
      const redeemer = await createRedeemer();

      const result = await redeemCoupon(coupon.code, redeemer.id, "PL");

      expect(result.ok).toBe(true);
    });
  });
});
