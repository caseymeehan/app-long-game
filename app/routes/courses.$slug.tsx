import { Link } from "react-router";
import type { Route } from "./+types/courses.$slug";
import {
  getCourseBySlug,
  getCourseWithDetails,
  getLessonCountForCourse,
} from "~/services/courseService";
import { isUserEnrolled } from "~/services/enrollmentService";
import {
  calculateProgress,
  getLessonProgressForCourse,
  getNextIncompleteLesson,
} from "~/services/progressService";
import { getCurrentUserId } from "~/lib/session";
import { LessonProgressStatus } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock,
  Lock,
  PlayCircle,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { formatDuration } from "~/lib/utils";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — AI for the Long Game` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const course = await getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const courseWithDetails = await getCourseWithDetails(course.id);
  if (!courseWithDetails) {
    throw data("Course not found", { status: 404 });
  }

  const lessonCount = await getLessonCountForCourse(course.id);
  const currentUserId = await getCurrentUserId(request);

  let progress = 0;
  let lessonProgressMap: Record<number, string> = {};
  let nextLessonId: number | null = null;

  if (currentUserId) {
    const enrolled = await isUserEnrolled(currentUserId, course.id);

    if (enrolled) {
      progress = await calculateProgress({ userId: currentUserId, courseId: course.id, includeQuizzes: false, weightByDuration: false });

      const progressRecords = await getLessonProgressForCourse(
        currentUserId,
        course.id
      );
      for (const record of progressRecords) {
        lessonProgressMap[record.lessonId] = record.status;
      }

      const nextLesson = await getNextIncompleteLesson(currentUserId, course.id);
      nextLessonId = nextLesson?.id ?? null;
    }
  }

  return {
    course: courseWithDetails,
    lessonCount,
    progress,
    lessonProgressMap,
    nextLessonId,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="mb-3 h-9 w-3/4" />
      <Skeleton className="mb-2 h-4 w-full" />
      <Skeleton className="mb-8 h-4 w-2/3" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function CourseDetail({ loaderData }: Route.ComponentProps) {
  const {
    course,
    lessonCount,
    progress,
    lessonProgressMap,
    nextLessonId,
  } = loaderData;

  const totalDuration = course.modules.reduce(
    (sum, mod) =>
      sum + mod.lessons.reduce((s, l) => s + (l.durationMinutes ?? 0), 0),
    0
  );

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <h1 className="mb-3 text-3xl font-bold">{course.title}</h1>
      <p className="mb-4 text-lg text-muted-foreground">
        {course.description}
      </p>

      <div className="mb-8 flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <BookOpen className="size-4" />
          {lessonCount} lessons
        </span>
        {totalDuration > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="size-4" />
            {formatDuration(totalDuration, true, false, false)}
          </span>
        )}
        {progress > 0 && (
          <span className="font-medium text-foreground">
            {progress}% complete
          </span>
        )}
      </div>

      {/* Progress bar */}
      {progress > 0 && (
        <div className="mb-8">
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {nextLessonId && (
            <Link to={`/courses/${course.slug}/lessons/${nextLessonId}`}>
              <Button>
                <PlayCircle className="mr-2 size-4" />
                Continue Learning
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Start button for 0% progress */}
      {progress === 0 && course.modules.length > 0 && (
        <div className="mb-8">
          {(() => {
            const firstLessonId = course.modules[0]?.lessons[0]?.id;
            return firstLessonId ? (
              <Link to={`/courses/${course.slug}/lessons/${firstLessonId}`}>
                <Button>
                  <PlayCircle className="mr-2 size-4" />
                  Start Course
                </Button>
              </Link>
            ) : null;
          })()}
        </div>
      )}

      {/* Course content / modules */}
      <h2 className="mb-4 text-2xl font-bold">Course Content</h2>
      {course.modules.length === 0 ? (
        <p className="text-muted-foreground">
          No content has been added to this course yet.
        </p>
      ) : (
        <div className="space-y-4">
          {course.modules.map((mod) => (
            <Card key={mod.id}>
              <CardHeader>
                {mod.isLocked ? (
                  <div className="flex items-center gap-2">
                    <Lock className="size-4 shrink-0 text-muted-foreground" />
                    <h3 className="font-semibold text-muted-foreground">
                      {mod.title}
                    </h3>
                  </div>
                ) : (
                  <Link to={`/courses/${course.slug}/${mod.id}`}>
                    <h3 className="font-semibold hover:underline">{mod.title}</h3>
                  </Link>
                )}
                <p className="text-sm text-muted-foreground">
                  {mod.lessons.length} lessons
                </p>
              </CardHeader>
              {!mod.isLocked && (
                <CardContent>
                  <ul className="space-y-2">
                    {mod.lessons.map((lesson) => {
                      const status = lessonProgressMap[lesson.id];
                      const isCompleted =
                        status === LessonProgressStatus.Completed;
                      const isInProgress =
                        status === LessonProgressStatus.InProgress;

                      return (
                        <li key={lesson.id}>
                          <Link
                            to={`/courses/${course.slug}/lessons/${lesson.id}`}
                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="size-4 shrink-0 text-green-500" />
                            ) : isInProgress ? (
                              <PlayCircle className="size-4 shrink-0 text-blue-500" />
                            ) : (
                              <Circle className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="flex-1">{lesson.title}</span>
                            {lesson.durationMinutes && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="size-3" />
                                {formatDuration(
                                  lesson.durationMinutes,
                                  true,
                                  false,
                                  false
                                )}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this course.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Course not found";
      message =
        "The course you're looking for doesn't exist or may have been removed.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
