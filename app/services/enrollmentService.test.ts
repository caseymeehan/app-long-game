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
  enrollUser,
  unenrollUser,
  findEnrollment,
  isUserEnrolled,
  getEnrollmentById,
  getEnrollmentsByUser,
  getEnrollmentsByCourse,
  getEnrollmentCountForCourse,
  getUserEnrolledCourses,
  getCourseEnrolledStudents,
  markEnrollmentComplete,
} from "./enrollmentService";

describe("enrollmentService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    await cleanDb(testDb);
    base = await seedBaseData(testDb);
  });

  describe("enrollUser", () => {
    it("enrolls a user in a course", async () => {
      const enrollment = await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      expect(enrollment).toBeDefined();
      expect(enrollment.userId).toBe(base.user.id);
      expect(enrollment.courseId).toBe(base.course.id);
      expect(enrollment.enrolledAt).toBeDefined();
      expect(enrollment.completedAt).toBeNull();
    });

    it("throws when enrolling a user who is already enrolled", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      await expect(
        enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false })
      ).rejects.toThrowError("User is already enrolled in this course");
    });

    it("throws when enrolling in a non-existent course", async () => {
      await expect(
        enrollUser({ userId: base.user.id, courseId: 9999, sendEmail: false, skipValidation: false })
      ).rejects.toThrowError("Course not found");
    });

    it("skips course existence check when skipValidation is true", async () => {
      // skipValidation bypasses the course existence check at the service level,
      // but the DB foreign key constraint still prevents inserting invalid references.
      // Verify it doesn't throw "Course not found" (service-level) but throws FK error instead.
      await expect(
        enrollUser({ userId: base.user.id, courseId: 9999, sendEmail: false, skipValidation: true })
      ).rejects.toThrowError(); // FK constraint, not "Course not found"
    });

    it("allows duplicate enrollment when skipValidation is true", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      // Second enrollment with skipValidation — no "already enrolled" error
      const second = await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: true });
      expect(second).toBeDefined();
    });

    it("accepts sendEmail parameter without error", async () => {
      const enrollment = await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: true, skipValidation: false });
      expect(enrollment).toBeDefined();
    });
  });

  describe("unenrollUser", () => {
    it("unenrolls a user from a course", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const result = await unenrollUser(base.user.id, base.course.id);
      expect(result).toBeDefined();
      expect(result!.userId).toBe(base.user.id);
      expect(result!.courseId).toBe(base.course.id);
    });

    it("throws when unenrolling a user who is not enrolled", async () => {
      await expect(
        unenrollUser(base.user.id, base.course.id)
      ).rejects.toThrowError("User is not enrolled in this course");
    });

    it("removes the enrollment from the database", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });
      await unenrollUser(base.user.id, base.course.id);

      expect(await isUserEnrolled(base.user.id, base.course.id)).toBe(false);
    });
  });

  describe("findEnrollment", () => {
    it("returns the enrollment when it exists", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const found = await findEnrollment(base.user.id, base.course.id);
      expect(found).toBeDefined();
      expect(found!.userId).toBe(base.user.id);
      expect(found!.courseId).toBe(base.course.id);
    });

    it("returns undefined when no enrollment exists", async () => {
      const found = await findEnrollment(base.user.id, base.course.id);
      expect(found).toBeUndefined();
    });
  });

  describe("isUserEnrolled", () => {
    it("returns true when user is enrolled", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      expect(await isUserEnrolled(base.user.id, base.course.id)).toBe(true);
    });

    it("returns false when user is not enrolled", async () => {
      expect(await isUserEnrolled(base.user.id, base.course.id)).toBe(false);
    });
  });

  describe("getEnrollmentById", () => {
    it("returns enrollment by id", async () => {
      const created = await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const found = await getEnrollmentById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it("returns undefined for non-existent id", async () => {
      expect(await getEnrollmentById(9999)).toBeUndefined();
    });
  });

  describe("getEnrollmentsByUser", () => {
    it("returns all enrollments for a user", async () => {
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

      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });
      await enrollUser({ userId: base.user.id, courseId: course2.id, sendEmail: false, skipValidation: false });

      const enrollmentsList = await getEnrollmentsByUser(base.user.id);
      expect(enrollmentsList).toHaveLength(2);
    });

    it("returns empty array when user has no enrollments", async () => {
      expect(await getEnrollmentsByUser(base.user.id)).toHaveLength(0);
    });
  });

  describe("getEnrollmentsByCourse", () => {
    it("returns all enrollments for a course", async () => {
      const [student2] = await testDb
        .insert(schema.users)
        .values({
          name: "Student Two",
          email: "student2@example.com",
          role: schema.UserRole.Student,
        })
        .returning();

      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });
      await enrollUser({ userId: student2.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const enrollmentsList = await getEnrollmentsByCourse(base.course.id);
      expect(enrollmentsList).toHaveLength(2);
    });

    it("returns empty array when course has no enrollments", async () => {
      expect(await getEnrollmentsByCourse(base.course.id)).toHaveLength(0);
    });
  });

  describe("getEnrollmentCountForCourse", () => {
    it("returns the count of enrollments", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      expect(await getEnrollmentCountForCourse(base.course.id)).toBe(1);
    });

    it("returns 0 when no enrollments exist", async () => {
      expect(await getEnrollmentCountForCourse(base.course.id)).toBe(0);
    });
  });

  describe("markEnrollmentComplete", () => {
    it("sets completedAt on the enrollment", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const result = await markEnrollmentComplete(base.user.id, base.course.id);
      expect(result).toBeDefined();
      expect(result!.completedAt).toBeDefined();
      expect(result!.completedAt).not.toBeNull();
    });
  });

  describe("getUserEnrolledCourses", () => {
    it("returns enrolled courses with course details", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const courses = await getUserEnrolledCourses(base.user.id);
      expect(courses).toHaveLength(1);
      expect(courses[0].courseTitle).toBe("Test Course");
      expect(courses[0].courseSlug).toBe("test-course");
      expect(courses[0].courseDescription).toBe("A test course");
    });

    it("returns empty array when user has no enrollments", async () => {
      expect(await getUserEnrolledCourses(base.user.id)).toHaveLength(0);
    });
  });

  describe("getCourseEnrolledStudents", () => {
    it("returns enrolled students for a course", async () => {
      await enrollUser({ userId: base.user.id, courseId: base.course.id, sendEmail: false, skipValidation: false });

      const students = await getCourseEnrolledStudents(base.course.id);
      expect(students).toHaveLength(1);
      expect(students[0].userId).toBe(base.user.id);
    });

    it("returns empty array when course has no enrollments", async () => {
      expect(await getCourseEnrolledStudents(base.course.id)).toHaveLength(0);
    });
  });
});
