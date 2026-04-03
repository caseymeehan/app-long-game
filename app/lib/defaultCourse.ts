import { getCourseBySlug } from "~/services/courseService";

const DEFAULT_COURSE_SLUG = process.env.DEFAULT_COURSE_SLUG ?? "ai-for-the-long-game";

let cachedCourse: Awaited<ReturnType<typeof getCourseBySlug>> | undefined;

export async function getDefaultCourse() {
  if (cachedCourse) return cachedCourse;
  const course = await getCourseBySlug(DEFAULT_COURSE_SLUG);
  if (!course) {
    throw new Error(
      `Default course not found: slug="${DEFAULT_COURSE_SLUG}". Set DEFAULT_COURSE_SLUG env var or create the course.`
    );
  }
  cachedCourse = course;
  return course;
}

export function getDefaultCourseSlug() {
  return DEFAULT_COURSE_SLUG;
}
