import { useState, useEffect } from "react";
import { Link, useFetcher, useBlocker } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/admin.partner-resources.$resourceId";
import {
  getResourceById,
  updateResource,
  getCategoryById,
} from "~/services/partnerResourceService";
import { requireAdmin } from "~/lib/session";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { MonacoMarkdownEditor } from "~/components/monaco-markdown-editor";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";
import { z } from "zod";
import { parseFormData } from "~/lib/validation";

const updateResourceSchema = z.object({
  intent: z.literal("update-resource"),
  title: z.string().trim().min(1, "Title is required."),
  content: z.string().optional(),
});

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.resource?.title ?? "Edit Resource";
  return [
    { title: `Edit: ${title} — Long-Game` },
    { name: "description", content: `Edit partner resource: ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const resourceId = parseInt(params.resourceId, 10);
  if (isNaN(resourceId)) {
    throw data("Invalid resource ID.", { status: 400 });
  }

  const resource = await getResourceById(resourceId);
  if (!resource) {
    throw data("Resource not found.", { status: 404 });
  }

  const category = await getCategoryById(resource.categoryId);

  return { resource, categoryTitle: category?.title ?? "Unknown" };
}

export async function action({ params, request }: Route.ActionArgs) {
  await requireAdmin(request, "action");

  const resourceId = parseInt(params.resourceId, 10);
  if (isNaN(resourceId)) {
    throw data("Invalid resource ID.", { status: 400 });
  }

  const resource = await getResourceById(resourceId);
  if (!resource) {
    throw data("Resource not found.", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, updateResourceSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { title, content } = parsed.data;
  await updateResource(resourceId, title, content ?? null);
  return { success: true };
}

export default function AdminPartnerResourceEditor({
  loaderData,
}: Route.ComponentProps) {
  const { resource, categoryTitle } = loaderData;
  const fetcher = useFetcher();

  const [title, setTitle] = useState(resource.title);
  const [content, setContent] = useState(resource.content ?? "");

  const hasChanges =
    title !== resource.title || content !== (resource.content ?? "");

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
      toast.success("Resource saved.");
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    fetcher.submit(
      { intent: "update-resource", title, content },
      { method: "post" }
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Unsaved changes blocker */}
      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="mx-4 w-full max-w-md">
            <CardHeader>
              <h2 className="text-lg font-semibold">Unsaved Changes</h2>
              <p className="text-sm text-muted-foreground">
                You have unsaved changes that will be lost if you leave.
              </p>
            </CardHeader>
            <CardContent className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => blocker.reset()}>
                Stay on Page
              </Button>
              <Button variant="destructive" onClick={() => blocker.proceed()}>
                Leave Page
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/admin/partner-resources" className="hover:text-foreground">
          Partner Content
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted-foreground">{categoryTitle}</span>
        <span className="mx-2">/</span>
        <span className="text-foreground">{resource.title}</span>
      </nav>

      <Link
        to="/admin/partner-resources"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Partner Content
      </Link>

      <div className="space-y-6">
        {/* Title */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Resource Title</h2>
          </CardHeader>
          <CardContent>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Resource title..."
            />
          </CardContent>
        </Card>

        {/* Content */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Content</h2>
            <p className="text-sm text-muted-foreground">
              Write resource content in Markdown. Press Ctrl+S to save.
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

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={fetcher.state !== "idle" || !hasChanges}
          >
            <Save className="mr-2 size-4" />
            {fetcher.state !== "idle" ? "Saving..." : "Save Resource"}
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
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message = "The resource you're looking for doesn't exist.";
    } else if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission.";
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
        <Link to="/admin/partner-resources">
          <Button>Back to Partner Content</Button>
        </Link>
      </div>
    </div>
  );
}
