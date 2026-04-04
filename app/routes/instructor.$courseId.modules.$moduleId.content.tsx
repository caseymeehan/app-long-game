import { useState, useEffect } from "react";
import { Link, useFetcher, useBlocker } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/instructor.$courseId.modules.$moduleId.content";
import { getCourseById } from "~/services/courseService";
import { getModuleById, updateModuleContent } from "~/services/moduleService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { MonacoMarkdownEditor } from "~/components/monaco-markdown-editor";
import { AlertTriangle, ArrowLeft, ExternalLink, Save } from "lucide-react";
import { data, isRouteErrorResponse, redirect } from "react-router";
import { z } from "zod";
import { parseFormData, parseParams } from "~/lib/validation";

const moduleContentParamsSchema = z.object({
  courseId: z.coerce.number().int(),
  moduleId: z.coerce.number().int(),
});

const updateModuleContentSchema = z.object({
  intent: z.literal("update-module-content"),
  content: z.string().optional(),
  videoUrl: z.string().trim().optional(),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.module?.title ?? "Edit Module";
  return [
    { title: `Edit: ${title} — Long-Game` },
    { name: "description", content: `Edit module content: ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw redirect("/login");
  }

  const user = await getUserById(currentUserId);

  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can access this page.", {
      status: 403,
    });
  }

  const { courseId, moduleId } = parseParams(
    params,
    moduleContentParamsSchema
  );

  const course = await getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const mod = await getModuleById(moduleId);
  if (!mod || mod.courseId !== courseId) {
    throw data("Module not found in this course.", { status: 404 });
  }

  return { course, module: mod };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const user = await getUserById(currentUserId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    throw data("Only instructors and admins can edit modules.", {
      status: 403,
    });
  }

  const { courseId, moduleId } = parseParams(
    params,
    moduleContentParamsSchema
  );

  const course = await getCourseById(courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    throw data("You can only edit your own courses.", { status: 403 });
  }

  const mod = await getModuleById(moduleId);
  if (!mod || mod.courseId !== courseId) {
    throw data("Module not found in this course.", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, updateModuleContentSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  if (parsed.data.intent === "update-module-content") {
    const { content, videoUrl } = parsed.data;
    await updateModuleContent(moduleId, content ?? null, videoUrl || null);
    return { success: true };
  }

  throw data("Invalid action.", { status: 400 });
}

export default function InstructorModuleContentEditor({
  loaderData,
}: Route.ComponentProps) {
  const { course, module: mod } = loaderData;
  const fetcher = useFetcher();

  const [content, setContent] = useState(mod.content ?? "");
  const [videoUrl, setVideoUrl] = useState(mod.videoUrl ?? "");

  const hasChanges =
    content !== (mod.content ?? "") || videoUrl !== (mod.videoUrl ?? "");

  const blocker = useBlocker(hasChanges);

  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Module content saved.");
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    fetcher.submit(
      {
        intent: "update-module-content",
        content,
        videoUrl,
      },
      { method: "post" }
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Unsaved changes blocker dialog */}
      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-md">
            <CardHeader>
              <h2 className="text-lg font-semibold">Unsaved Changes</h2>
              <p className="text-sm text-muted-foreground">
                You have unsaved changes that will be lost if you leave this
                page.
              </p>
            </CardHeader>
            <CardContent className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => blocker.reset()}>
                Stay on Page
              </Button>
              <Button
                variant="destructive"
                onClick={() => blocker.proceed()}
              >
                Leave Page
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link
          to={`/instructor/${course.id}`}
          className="hover:text-foreground"
        >
          {course.title}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{mod.title}</span>
      </nav>

      <Link
        to={`/instructor/${course.id}`}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Course Editor
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{mod.title}</h1>
          <Link to={`/courses/${course.slug}/${mod.id}`}>
            <Button variant="outline" size="sm">
              <ExternalLink className="mr-1.5 size-4" />
              View Module
            </Button>
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit module introduction content and video.
        </p>
      </div>

      <div className="space-y-6">
        {/* Content */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Module Content</h2>
            <p className="text-sm text-muted-foreground">
              Write module introduction in Markdown. This appears above the
              lesson list on the module page.
            </p>
          </CardHeader>
          <CardContent>
            <MonacoMarkdownEditor
              value={content}
              onChange={setContent}
              onSave={handleSave}
            />
          </CardContent>
        </Card>

        {/* Video URL */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Video</h2>
            <p className="text-sm text-muted-foreground">
              Paste a YouTube video URL to embed at the top of the module page.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="videoUrl">YouTube URL</Label>
              <Input
                id="videoUrl"
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={fetcher.state !== "idle" || !hasChanges}
          >
            <Save className="mr-2 size-4" />
            {fetcher.state !== "idle" ? "Saving..." : "Save Module Content"}
          </Button>
          {hasChanges && (
            <span className="text-sm text-amber-600">Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message =
    "An unexpected error occurred while loading the module editor.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message =
        "The module you're looking for doesn't exist or doesn't belong to this course.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to edit this module.";
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
        <Link to="/instructor">
          <Button>Back to Courses</Button>
        </Link>
      </div>
    </div>
  );
}
