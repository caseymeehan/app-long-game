import { useState, useEffect, useCallback } from "react";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/courses.$slug.lessons.$lessonId";
import {
  getCourseBySlug,
  getCourseWithDetails,
} from "~/services/courseService";
import { getLessonById } from "~/services/lessonService";
import { getModuleById } from "~/services/moduleService";
import { getCurrentUserId } from "~/lib/session";
import { isUserEnrolled } from "~/services/enrollmentService";
import {
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
} from "~/services/progressService";
import {
  getLastWatchPosition,
  calculateWatchProgress,
} from "~/services/videoTrackingService";
import {
  getQuizByLessonId,
  getQuizWithQuestions,
  getBestAttempt,
} from "~/services/quizService";
import { computeResult } from "~/services/quizScoringService";
import { LessonProgressStatus } from "~/db/schema";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Github,
  HelpCircle,
  Lock,
  PlayCircle,
  XCircle,
  Trophy,
  RotateCcw,
} from "lucide-react";
import { formatDuration } from "~/lib/utils";
import { renderMarkdown } from "~/lib/markdown.server";
import { YouTubePlayer } from "~/components/youtube-player";
import { data, isRouteErrorResponse } from "react-router";
import { z } from "zod";
import { parseFormData, parseParams } from "~/lib/validation";

const lessonParamsSchema = z.object({
  slug: z.string().min(1),
  lessonId: z.coerce.number().int(),
});

const markCompleteSchema = z.object({
  intent: z.literal("mark-complete"),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Lesson";
  const courseTitle = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — ${courseTitle} — Long-Game` }];
}

type FlatLesson = {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string;
};

function flattenCourseLessons(course: {
  modules: Array<{
    id: number;
    title: string;
    lessons: Array<{ id: number; title: string; moduleId: number }>;
  }>;
}): FlatLesson[] {
  const flat: FlatLesson[] = [];
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      flat.push({
        id: lesson.id,
        title: lesson.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }
  }
  return flat;
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug;
  const lessonId = Number(params.lessonId);

  if (isNaN(lessonId)) {
    throw data("Invalid lesson ID", { status: 400 });
  }

  const course = await getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const courseWithDetails = await getCourseWithDetails(course.id);
  if (!courseWithDetails) {
    throw data("Course not found", { status: 404 });
  }

  const lesson = await getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }

  const mod = await getModuleById(lesson.moduleId);
  if (!mod) {
    throw data("Module not found", { status: 404 });
  }

  // Verify lesson belongs to this course
  if (mod.courseId !== course.id) {
    throw data("Lesson not found in this course", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);

  // Module lock check (admins bypass)
  if (mod.isLocked) {
    const currentUser = currentUserId
      ? await (await import("~/services/userService")).getUserById(currentUserId)
      : null;
    if (currentUser?.role !== "admin") {
      throw data("This module hasn't been unlocked yet.", { status: 403 });
    }
  }
  let enrolled = false;
  let lessonStatus: string | null = null;
  let lastWatchPosition = 0;
  let watchProgress = 0;
  let lessonProgressMap: Record<number, string> = {};

  if (currentUserId) {
    enrolled = await isUserEnrolled(currentUserId, course.id);

    if (enrolled) {
      // Mark lesson as in-progress when viewed
      await markLessonInProgress(currentUserId, lessonId);
      const progress = await getLessonProgress(currentUserId, lessonId);
      lessonStatus = progress?.status ?? null;

      // Get progress for all lessons in course (for curriculum sidebar)
      const progressRecords = await getLessonProgressForCourse(
        currentUserId,
        course.id
      );
      for (const record of progressRecords) {
        lessonProgressMap[record.lessonId] = record.status;
      }

      // Get video watch state for resume and progress display
      if (lesson.videoUrl) {
        lastWatchPosition = await getLastWatchPosition(currentUserId, lessonId);
        const videoDurationSeconds = (lesson.durationMinutes ?? 0) * 60;
        if (videoDurationSeconds > 0) {
          watchProgress = await calculateWatchProgress({
            userId: currentUserId,
            lessonId,
            videoDurationSeconds,
          });
        }
      }
    }
  }

  // Render lesson content from Markdown to HTML server-side
  const contentHtml = lesson.content
    ? await renderMarkdown(lesson.content)
    : null;

  // Build prev/next navigation
  const allLessons = flattenCourseLessons(courseWithDetails);
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson =
    currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  // Check for quiz attached to this lesson
  const quizRecord = await getQuizByLessonId(lessonId);
  let quiz: {
    id: number;
    title: string;
    passingScore: number;
    questions: Array<{
      id: number;
      questionText: string;
      questionType: string;
      position: number;
      options: Array<{ id: number; optionText: string }>;
    }>;
  } | null = null;
  let bestAttempt: { score: number; passed: boolean } | null = null;

  if (quizRecord) {
    const quizData = await getQuizWithQuestions(quizRecord.id);
    if (quizData) {
      // Strip isCorrect from options so answers aren't leaked to the client
      quiz = {
        id: quizData.id,
        title: quizData.title,
        passingScore: quizData.passingScore,
        questions: quizData.questions.map((q) => ({
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType,
          position: q.position,
          options: q.options.map((o) => ({
            id: o.id,
            optionText: o.optionText,
          })),
        })),
      };
    }

    if (currentUserId) {
      const best = await getBestAttempt(currentUserId, quizRecord.id);
      if (best) {
        bestAttempt = { score: best.score, passed: best.passed };
      }
    }
  }

  return {
    course: {
      id: courseWithDetails.id,
      title: courseWithDetails.title,
      slug: courseWithDetails.slug,
    },
    curriculum: courseWithDetails.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({
        id: l.id,
        title: l.title,
      })),
    })),
    module: {
      id: mod.id,
      title: mod.title,
    },
    lesson,
    contentHtml,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { slug, lessonId } = parseParams(params, lessonParamsSchema);

  const course = await getCourseBySlug(slug);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-complete") {
    await markLessonComplete(currentUserId, lessonId);
    return { success: true };
  }

  if (intent === "submit-quiz") {
    const quizId = Number(formData.get("quizId"));
    if (isNaN(quizId)) {
      throw data("Invalid quiz ID", { status: 400 });
    }

    // Collect answers: form fields named "question-{questionId}" with value = optionId
    const selectedAnswers: Record<number, number> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("question-")) {
        const questionId = Number(key.replace("question-", ""));
        const optionId = Number(value);
        if (!isNaN(questionId) && !isNaN(optionId)) {
          selectedAnswers[questionId] = optionId;
        }
      }
    }

    const result = await computeResult(currentUserId, quizId, selectedAnswers);
    if (!result) {
      throw data("Failed to score quiz", { status: 500 });
    }

    return { quizResult: result };
  }

  throw data("Invalid action", { status: 400 });
}

const AUTOPLAY_KEY = "long-game-autoplay";

function useAutoplay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    try {
      setEnabled(localStorage.getItem(AUTOPLAY_KEY) === "true");
    } catch {
      /* silently fail */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTOPLAY_KEY, String(next));
      } catch {
        /* silently fail */
      }
      return next;
    });
  }, []);

  return [enabled, toggle] as const;
}

export default function LessonViewer({ loaderData }: Route.ComponentProps) {
  const {
    course,
    curriculum,
    module: mod,
    lesson,
    contentHtml,
    lessonStatus,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    quiz,
    bestAttempt,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
  } = loaderData;
  const [autoplay, toggleAutoplay] = useAutoplay();
  const fetcher = useFetcher({ key: `mark-complete-${lesson.id}` });
  const quizFetcher = useFetcher({ key: `quiz-${lesson.id}` });
  const navigate = useNavigate();

  const isMarking =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "mark-complete";

  const justCompleted = fetcher.data?.success;

  const isCompleted =
    lessonStatus === LessonProgressStatus.Completed || justCompleted;

  // Navigate to next lesson after marking complete
  useEffect(() => {
    if (justCompleted && nextLesson) {
      navigate(`/courses/${course.slug}/lessons/${nextLesson.id}`);
    }
  }, [justCompleted, nextLesson, course.slug, navigate]);

  const quizResult = quizFetcher.data?.quizResult ?? null;
  const isSubmittingQuiz = quizFetcher.state !== "idle";

  return (
    <div className="p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link
          to={`/courses/${course.slug}`}
          className="hover:text-foreground"
        >
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted-foreground">{mod.title}</span>
        <span className="mx-2">/</span>
        <span className="text-foreground">{lesson.title}</span>
      </nav>

        <div className="mx-auto max-w-4xl">
          {/* Lesson Title */}
          <h1 className="mb-2 text-3xl font-bold">{lesson.title}</h1>
          <div className="mb-6 flex items-center gap-3">
            {lesson.durationMinutes && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="size-4" />
                {formatDuration(lesson.durationMinutes, true, false, false)}
              </div>
            )}
            {lesson.githubRepoUrl && (
              <a
                href={lesson.githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <Github className="mr-1.5 size-4" />
                  Open Code
                </Button>
              </a>
            )}
          </div>

          {/* YouTube Video */}
          {lesson.videoUrl && (
            <YouTubePlayer
              videoUrl={lesson.videoUrl}
              lessonId={lesson.id}
              title={lesson.title}
              startPosition={lastWatchPosition}
              durationMinutes={lesson.durationMinutes}
              watchProgress={watchProgress}
              trackingEnabled={enrolled && !!currentUserId}
              autoplay={autoplay}
              onToggleAutoplay={toggleAutoplay}
            />
          )}

          {/* Lesson Content */}
          {contentHtml && (
            <div
              className="prose prose-neutral dark:prose-invert mb-8 max-w-none"
              dangerouslySetInnerHTML={{ __html: contentHtml }}
            />
          )}

          {!contentHtml && !lesson.videoUrl && (
            <Card className="mb-8">
              <CardContent className="py-12 text-center text-muted-foreground">
                No content has been added to this lesson yet.
              </CardContent>
            </Card>
          )}

          {/* Quiz Section */}
          {quiz && enrolled && currentUserId && (
            <QuizSection
              quiz={quiz}
              bestAttempt={bestAttempt}
              quizResult={quizResult}
              quizFetcher={quizFetcher}
              isSubmitting={isSubmittingQuiz}
            />
          )}

          {/* Mark Complete / Up Next */}
          {enrolled && currentUserId && (
            <div className="mb-8">
              {isCompleted ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="size-5" />
                    <span className="font-medium">Lesson completed</span>
                  </div>
                  {nextLesson && (
                    <Link
                      to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                    >
                      <Button variant="outline" size="sm">
                        Up next: {nextLesson.title}
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              ) : nextLesson ? (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="mark-complete" />
                  <Button disabled={isMarking}>
                    {isMarking ? (
                      "Completing..."
                    ) : (
                      <>
                        Up next: {nextLesson.title}
                        <ChevronRight className="ml-1 size-4" />
                      </>
                    )}
                  </Button>
                </fetcher.Form>
              ) : (
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="mark-complete" />
                  <Button disabled={isMarking}>
                    <CheckCircle2 className="mr-2 size-4" />
                    {isMarking ? "Marking..." : "Mark as Complete"}
                  </Button>
                </fetcher.Form>
              )}
            </div>
          )}

          {/* Prev/Next Navigation */}
          <div className="flex items-center justify-between border-t pt-6">
            {prevLesson ? (
              <Link
                to={`/courses/${course.slug}/lessons/${prevLesson.id}`}
                className="flex items-center gap-2 text-sm hover:text-foreground text-muted-foreground"
              >
                <ChevronLeft className="size-4" />
                <div>
                  <div className="text-xs text-muted-foreground">Previous</div>
                  <div className="font-medium text-foreground">
                    {prevLesson.title}
                  </div>
                </div>
              </Link>
            ) : (
              <div />
            )}

            {nextLesson ? (
              <Link
                to={`/courses/${course.slug}/lessons/${nextLesson.id}`}
                className="flex items-center gap-2 text-right text-sm hover:text-foreground text-muted-foreground"
              >
                <div>
                  <div className="text-xs text-muted-foreground">Next</div>
                  <div className="font-medium text-foreground">
                    {nextLesson.title}
                  </div>
                </div>
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <Link
                to={`/courses/${course.slug}`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <div>
                  <div className="text-xs text-muted-foreground">Back to</div>
                  <div className="font-medium text-foreground">
                    {course.title}
                  </div>
                </div>
                <ChevronRight className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
  );
}

function QuizSection({
  quiz,
  bestAttempt,
  quizResult,
  quizFetcher,
  isSubmitting,
}: {
  quiz: {
    id: number;
    title: string;
    passingScore: number;
    questions: Array<{
      id: number;
      questionText: string;
      questionType: string;
      position: number;
      options: Array<{ id: number; optionText: string }>;
    }>;
  };
  bestAttempt: { score: number; passed: boolean } | null;
  quizResult: {
    attemptId: number;
    score: number;
    passed: boolean;
    grade: string;
    totalCorrect: number;
    totalQuestions: number;
    questionResults: Array<{
      questionId: number;
      correct: boolean;
      selectedOptionId: number | null;
      correctOptionId: number | null;
    }>;
  } | null;
  quizFetcher: ReturnType<typeof useFetcher>;
  isSubmitting: boolean;
}) {
  const [selectedAnswers, setSelectedAnswers] = useState<
    Record<number, number>
  >({});
  const [showQuiz, setShowQuiz] = useState(!bestAttempt?.passed);
  const [retaking, setRetaking] = useState(false);

  useEffect(() => {
    if (quizResult && !retaking) {
      if (quizResult.passed) {
        toast.success(
          `Quiz passed! Score: ${Math.round(quizResult.score * 100)}%`
        );
      } else {
        toast.error(
          `Quiz not passed. Score: ${Math.round(quizResult.score * 100)}%`
        );
      }
    }
  }, [quizResult, retaking]);

  const allAnswered = quiz.questions.every(
    (q) => selectedAnswers[q.id] !== undefined
  );
  const showResult = quizResult && !retaking;

  if (showResult) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <HelpCircle className="size-5 text-primary" />
            <h2 className="text-xl font-semibold">{quiz.title}</h2>
          </div>

          {/* Results summary */}
          <div
            className={`mb-6 rounded-lg p-4 ${quizResult.passed ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}`}
          >
            <div className="flex items-center gap-3">
              {quizResult.passed ? (
                <Trophy className="size-8 text-green-600" />
              ) : (
                <XCircle className="size-8 text-red-600" />
              )}
              <div>
                <p
                  className={`text-lg font-semibold ${quizResult.passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                >
                  {quizResult.passed ? "You passed!" : "Not quite — try again!"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Score: {quizResult.totalCorrect}/{quizResult.totalQuestions} (
                  {Math.round(quizResult.score * 100)}%) — Grade:{" "}
                  {quizResult.grade}
                </p>
              </div>
            </div>
          </div>

          {/* Per-question results */}
          <div className="space-y-4">
            {quiz.questions.map((question, qIndex) => {
              const result = quizResult.questionResults.find(
                (r) => r.questionId === question.id
              );
              return (
                <div key={question.id} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-start gap-2">
                    {result?.correct ? (
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
                    )}
                    <p className="font-medium">
                      {qIndex + 1}. {question.questionText}
                    </p>
                  </div>
                  <div className="ml-7 space-y-1">
                    {question.options.map((option) => {
                      const isSelected = result?.selectedOptionId === option.id;
                      const isCorrect = result?.correctOptionId === option.id;
                      let className = "text-sm";
                      if (isCorrect)
                        className +=
                          " font-medium text-green-700 dark:text-green-400";
                      else if (isSelected && !result?.correct)
                        className +=
                          " text-red-600 dark:text-red-400 line-through";
                      return (
                        <p key={option.id} className={className}>
                          {isCorrect ? "✓ " : isSelected ? "✗ " : "  "}
                          {option.optionText}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Retake button */}
          {!quizResult.passed && (
            <div className="mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedAnswers({});
                  setRetaking(true);
                }}
              >
                <RotateCcw className="mr-2 size-4" />
                Retake Quiz
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!showQuiz && bestAttempt?.passed) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="size-5 text-green-600" />
              <span className="font-medium">{quiz.title}</span>
              <span className="text-sm text-muted-foreground">
                — Best score: {Math.round(bestAttempt.score * 100)}%
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowQuiz(true)}
            >
              <RotateCcw className="mr-2 size-4" />
              Retake
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <HelpCircle className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">{quiz.title}</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Answer all questions and submit. Passing score:{" "}
          {Math.round(quiz.passingScore * 100)}%.
        </p>

        <quizFetcher.Form method="post" onSubmit={() => setRetaking(false)}>
          <input type="hidden" name="intent" value="submit-quiz" />
          <input type="hidden" name="quizId" value={quiz.id} />

          <div className="space-y-6">
            {quiz.questions.map((question, qIndex) => (
              <div key={question.id} className="rounded-lg border p-4">
                <p className="mb-3 font-medium">
                  {qIndex + 1}. {question.questionText}
                </p>
                <div className="space-y-2">
                  {question.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted"
                    >
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        value={option.id}
                        checked={selectedAnswers[question.id] === option.id}
                        onChange={() =>
                          setSelectedAnswers((prev) => ({
                            ...prev,
                            [question.id]: option.id,
                          }))
                        }
                        className="size-4 accent-primary"
                      />
                      <span className="text-sm">{option.optionText}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <Button type="submit" disabled={!allAnswered || isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Quiz"}
            </Button>
            {!allAnswered && (
              <p className="mt-2 text-sm text-muted-foreground">
                Please answer all questions before submitting.
              </p>
            )}
          </div>
        </quizFetcher.Form>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { slug } = useParams();
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this lesson.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 403) {
      // Module locked — drip content, not an error
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div className="text-center">
            <Lock className="mx-auto mb-4 size-12 text-muted-foreground" />
            <h1 className="mb-2 text-2xl font-bold">Not yet unlocked</h1>
            <p className="mb-6 text-muted-foreground">
              {typeof error.data === "string"
                ? error.data
                : "This module hasn't been unlocked yet."}
            </p>
            <Link to={slug ? `/courses/${slug}` : "/"}>
              <Button>{slug ? "Back to course" : "Go Home"}</Button>
            </Link>
          </div>
        </div>
      );
    } else if (error.status === 404) {
      title = "Lesson not found";
      message =
        "The lesson you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please log in to continue.";
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
