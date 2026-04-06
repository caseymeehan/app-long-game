import { useState, useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.partner-resources";
import {
  getAllCategoriesWithResources,
  getPageSettings,
  upsertPageSettings,
  createCategory,
  updateCategory,
  deleteCategory,
  createResource,
  deleteResource,
} from "~/services/partnerResourceService";
import { requireAdmin } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { MonacoMarkdownEditor } from "~/components/monaco-markdown-editor";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FolderPlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  Video,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";

const adminPartnerResourceActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("update-page-settings"),
    content: z.string().optional(),
    videoUrl: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("add-category"),
    title: z.string().trim().min(1, "Category title is required."),
  }),
  z.object({
    intent: z.literal("rename-category"),
    categoryId: z.coerce.number().int(),
    title: z.string().trim().min(1, "Category title is required."),
  }),
  z.object({
    intent: z.literal("delete-category"),
    categoryId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("add-resource"),
    categoryId: z.coerce.number().int(),
    title: z.string().trim().min(1, "Resource title is required."),
  }),
  z.object({
    intent: z.literal("delete-resource"),
    resourceId: z.coerce.number().int(),
  }),
]);

export function meta() {
  return [
    { title: "Partner Content — Long-Game" },
    { name: "description", content: "Manage partner resource content" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const pageSettings = await getPageSettings();
  const categories = await getAllCategoriesWithResources();

  return { pageSettings, categories };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request, "action");

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminPartnerResourceActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "update-page-settings") {
    const { content, videoUrl } = parsed.data;
    await upsertPageSettings(content ?? null, videoUrl || null);
    return { success: true, field: "page-settings" };
  }

  if (intent === "add-category") {
    await createCategory(parsed.data.title);
    return { success: true, field: "category" };
  }

  if (intent === "rename-category") {
    await updateCategory(parsed.data.categoryId, parsed.data.title);
    return { success: true, field: "category" };
  }

  if (intent === "delete-category") {
    await deleteCategory(parsed.data.categoryId);
    return { success: true, field: "category" };
  }

  if (intent === "add-resource") {
    await createResource(parsed.data.categoryId, parsed.data.title);
    return { success: true, field: "resource" };
  }

  if (intent === "delete-resource") {
    await deleteResource(parsed.data.resourceId);
    return { success: true, field: "resource" };
  }

  throw data("Invalid action.", { status: 400 });
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="mb-4 h-48 w-full" />
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function AdminPartnerResources({
  loaderData,
}: Route.ComponentProps) {
  const { pageSettings, categories } = loaderData;

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <h1 className="mb-1 text-3xl font-bold">Partner Content</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Manage the partner resources page intro and resource categories.
      </p>

      <PageSettingsEditor pageSettings={pageSettings} />

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Resource Categories</h2>
          <AddCategoryForm />
        </div>

        {categories.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No categories yet. Add one above.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <CategoryCard key={cat.id} category={cat} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PageSettingsEditor({
  pageSettings,
}: {
  pageSettings: { id: number; content: string | null; videoUrl: string | null } | undefined;
}) {
  const fetcher = useFetcher();
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(pageSettings?.content ?? "");
  const [videoUrl, setVideoUrl] = useState(pageSettings?.videoUrl ?? "");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data.field === "page-settings") {
      toast.success("Page settings saved.");
      setIsEditing(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Page Intro</h2>
            <p className="text-sm text-muted-foreground">
              Welcome content shown at the top of the partner resources page.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </CardHeader>
      {isEditing && (
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="videoUrl">
              <Video className="mr-1.5 inline size-4" />
              Welcome Video URL
            </Label>
            <Input
              id="videoUrl"
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className="space-y-2">
            <Label>Intro Content (Markdown)</Label>
            <MonacoMarkdownEditor
              value={content}
              onChange={setContent}
              onSave={() => {
                fetcher.submit(
                  { intent: "update-page-settings", content, videoUrl },
                  { method: "post" }
                );
              }}
            />
          </div>
          <Button
            onClick={() => {
              fetcher.submit(
                { intent: "update-page-settings", content, videoUrl },
                { method: "post" }
              );
            }}
            disabled={fetcher.state !== "idle"}
          >
            <Save className="mr-2 size-4" />
            {fetcher.state !== "idle" ? "Saving..." : "Save Page Settings"}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

function AddCategoryForm() {
  const fetcher = useFetcher();
  const [title, setTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data.field === "category") {
      toast.success("Category added.");
      setTitle("");
      setIsAdding(false);
    }
  }, [fetcher.state, fetcher.data]);

  if (!isAdding) {
    return (
      <Button variant="outline" size="sm" onClick={() => setIsAdding(true)}>
        <FolderPlus className="mr-1.5 size-4" />
        Add Category
      </Button>
    );
  }

  return (
    <fetcher.Form method="post" className="flex items-center gap-2">
      <input type="hidden" name="intent" value="add-category" />
      <Input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Category name..."
        className="h-8 w-48"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsAdding(false);
        }}
      />
      <Button type="submit" size="sm" disabled={!title.trim() || fetcher.state !== "idle"}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
        Cancel
      </Button>
    </fetcher.Form>
  );
}

function CategoryCard({
  category,
}: {
  category: {
    id: number;
    title: string;
    position: number;
    resources: Array<{
      id: number;
      title: string;
      content: string | null;
      position: number;
    }>;
  };
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(category.title);
  const renameFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  useEffect(() => {
    if (renameFetcher.state === "idle" && renameFetcher.data?.success) {
      toast.success("Category renamed.");
      setIsRenaming(false);
    }
  }, [renameFetcher.state, renameFetcher.data]);

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.success) {
      toast.success("Category deleted.");
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>

            {isRenaming ? (
              <renameFetcher.Form method="post" className="flex items-center gap-2">
                <input type="hidden" name="intent" value="rename-category" />
                <input type="hidden" name="categoryId" value={category.id} />
                <Input
                  name="title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="h-7 w-48 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setIsRenaming(false);
                      setNewTitle(category.title);
                    }
                  }}
                />
                <Button type="submit" size="sm" className="h-7" disabled={!newTitle.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() => {
                    setIsRenaming(false);
                    setNewTitle(category.title);
                  }}
                >
                  Cancel
                </Button>
              </renameFetcher.Form>
            ) : (
              <h3 className="font-semibold">{category.title}</h3>
            )}

            <span className="text-xs text-muted-foreground">
              {category.resources.length} resource{category.resources.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setIsRenaming(true)}
              title="Rename category"
            >
              <Pencil className="size-3.5" />
            </Button>
            <deleteFetcher.Form method="post">
              <input type="hidden" name="intent" value="delete-category" />
              <input type="hidden" name="categoryId" value={category.id} />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                type="submit"
                title="Delete category and all resources"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </deleteFetcher.Form>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="pt-0">
          {category.resources.length > 0 && (
            <div className="space-y-1 mb-3">
              {category.resources.map((resource) => (
                <ResourceRow key={resource.id} resource={resource} />
              ))}
            </div>
          )}
          <AddResourceForm categoryId={category.id} />
        </CardContent>
      )}
    </Card>
  );
}

function ResourceRow({
  resource,
}: {
  resource: { id: number; title: string; content: string | null };
}) {
  const deleteFetcher = useFetcher();

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data?.success) {
      toast.success("Resource deleted.");
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted">
      <span className="text-sm">{resource.title}</span>
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">
          {resource.content ? "has content" : "empty"}
        </span>
        <Link to={`/admin/partner-resources/${resource.id}`} title="Edit content">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
            <FileEdit className="size-3.5" />
          </Button>
        </Link>
        <deleteFetcher.Form method="post">
          <input type="hidden" name="intent" value="delete-resource" />
          <input type="hidden" name="resourceId" value={resource.id} />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
            type="submit"
            title="Delete resource"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </deleteFetcher.Form>
      </div>
    </div>
  );
}

function AddResourceForm({ categoryId }: { categoryId: number }) {
  const fetcher = useFetcher();
  const [title, setTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data.field === "resource") {
      setTitle("");
      setIsAdding(false);
    }
  }, [fetcher.state, fetcher.data]);

  if (!isAdding) {
    return (
      <button
        onClick={() => setIsAdding(true)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add resource
      </button>
    );
  }

  return (
    <fetcher.Form method="post" className="flex items-center gap-2">
      <input type="hidden" name="intent" value="add-resource" />
      <input type="hidden" name="categoryId" value={categoryId} />
      <Input
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Resource title..."
        className="h-7 text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsAdding(false);
        }}
      />
      <Button type="submit" size="sm" className="h-7" disabled={!title.trim() || fetcher.state !== "idle"}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setIsAdding(false)}>
        Cancel
      </Button>
    </fetcher.Form>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 403) {
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
      </div>
    </div>
  );
}
