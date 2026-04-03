import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { Toaster } from "sonner";
import { getUserById } from "~/services/userService";
import { getCurrentUserId } from "~/lib/session";
import {
  getRecentlyProgressedCourses,
  calculateProgress,
  getCompletedLessonCount,
  getTotalLessonCount,
} from "~/services/progressService";
import { isTeamAdmin } from "~/services/teamService";
import { getDefaultCourse } from "~/lib/defaultCourse";
import { isUserEnrolled } from "~/services/enrollmentService";
import { UserRole } from "~/db/schema";

const EXEMPT_PATHS = ["/no-access", "/settings"];

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? await getUserById(currentUserId) : null;

  // Auth gate: must be logged in
  if (!currentUser) {
    const url = new URL(request.url);
    throw redirect(`/login?returnTo=${encodeURIComponent(url.pathname)}`);
  }

  // Enrollment gate: must be enrolled (or admin) to access app routes
  const url = new URL(request.url);
  const isExempt = EXEMPT_PATHS.some((p) => url.pathname === p);

  let isEnrolled = false;
  if (!isExempt) {
    const defaultCourse = await getDefaultCourse();
    isEnrolled = await isUserEnrolled(currentUser.id, defaultCourse.id);

    if (!isEnrolled && currentUser.role !== UserRole.Admin) {
      throw redirect("/no-access");
    }
  }

  const recentCourses = await Promise.all(
    (await getRecentlyProgressedCourses(currentUser.id)).map(async (course) => {
      const completedLessons = await getCompletedLessonCount(
        currentUser.id,
        course.courseId
      );
      const totalLessons = await getTotalLessonCount(course.courseId);
      const progress = await calculateProgress(
        currentUser.id,
        course.courseId,
        false,
        false
      );
      return {
        courseId: course.courseId,
        title: course.courseTitle,
        slug: course.courseSlug,
        coverImageUrl: course.coverImageUrl,
        completedLessons,
        totalLessons,
        progress,
      };
    })
  );

  return {
    currentUser: {
      id: currentUser.id,
      name: currentUser.name,
      role: currentUser.role,
      avatarUrl: currentUser.avatarUrl ?? null,
    },
    recentCourses,
    isTeamAdmin: await isTeamAdmin(currentUser.id),
    isEnrolled,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const {
    currentUser,
    recentCourses,
    isTeamAdmin: userIsTeamAdmin,
  } = loaderData;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentUser={currentUser}
        recentCourses={recentCourses}
        isTeamAdmin={userIsTeamAdmin}
      />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
