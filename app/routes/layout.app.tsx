import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout.app";
import { Sidebar } from "~/components/sidebar";
import { Toaster } from "sonner";
import { getUserById } from "~/services/userService";
import { getCurrentUserId } from "~/lib/session";
import { getLessonProgressForCourse } from "~/services/progressService";
import { getDefaultCourse } from "~/lib/defaultCourse";
import { isUserEnrolled } from "~/services/enrollmentService";
import { getModulesByCourse } from "~/services/moduleService";
import { getLessonsByModule } from "~/services/lessonService";
import { UserRole, LessonProgressStatus } from "~/db/schema";

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

  const defaultCourse = await getDefaultCourse();
  let isEnrolled = false;

  if (!isExempt) {
    isEnrolled = await isUserEnrolled(currentUser.id, defaultCourse.id);

    if (!isEnrolled && currentUser.role !== UserRole.Admin) {
      throw redirect("/no-access");
    }
  }

  // Fetch modules with lessons for the sidebar
  const courseModules = await getModulesByCourse(defaultCourse.id);
  const progressRecords = await getLessonProgressForCourse(
    currentUser.id,
    defaultCourse.id
  );
  const completedLessonIds = new Set(
    progressRecords
      .filter((p) => p.status === LessonProgressStatus.Completed)
      .map((p) => p.lessonId)
  );

  const modulesWithLessons = await Promise.all(
    courseModules.map(async (mod) => {
      const modLessons = await getLessonsByModule(mod.id);
      return {
        id: mod.id,
        title: mod.title,
        position: mod.position,
        lessons: modLessons.map((l) => ({
          id: l.id,
          title: l.title,
          completed: completedLessonIds.has(l.id),
        })),
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
    courseSlug: defaultCourse.slug,
    courseTitle: defaultCourse.title,
    modules: modulesWithLessons,
    isEnrolled,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { currentUser, courseSlug, courseTitle, modules } = loaderData;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentUser={currentUser}
        courseSlug={courseSlug}
        courseTitle={courseTitle}
        modules={modules}
      />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
