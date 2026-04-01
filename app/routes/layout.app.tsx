import { Outlet } from "react-router";
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

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? await getUserById(currentUserId) : null;

  const recentCourses = currentUserId
    ? await Promise.all(
        (await getRecentlyProgressedCourses(currentUserId)).map(async (course) => {
          const completedLessons = await getCompletedLessonCount(
            currentUserId,
            course.courseId
          );
          const totalLessons = await getTotalLessonCount(course.courseId);
          const progress = await calculateProgress(
            currentUserId,
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
      )
    : [];

  return {
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role,
          avatarUrl: currentUser.avatarUrl ?? null,
        }
      : null,
    recentCourses,
    isTeamAdmin: currentUserId ? await isTeamAdmin(currentUserId) : false,
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
