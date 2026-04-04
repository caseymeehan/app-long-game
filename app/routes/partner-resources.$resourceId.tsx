import { Link } from "react-router";
import type { Route } from "./+types/partner-resources.$resourceId";
import {
  getResourceById,
  getCategoryById,
} from "~/services/partnerResourceService";
import { isActivePartner } from "~/services/partnerService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { renderMarkdown } from "~/lib/markdown.server";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";

export function meta({ data: loaderData }: Route.MetaArgs) {
  const title = loaderData?.resource?.title ?? "Resource";
  return [
    { title: `${title} — Partner Resources — Long-Game` },
    { name: "description", content: `Partner resource: ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = await getUserById(currentUserId);
  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  // Allow admins and active partners
  const isPartner = await isActivePartner(currentUser.id);
  if (!isPartner && currentUser.role !== UserRole.Admin) {
    throw data("Only active partners can access this page.", { status: 403 });
  }

  const resourceId = parseInt(params.resourceId, 10);
  if (isNaN(resourceId)) {
    throw data("Invalid resource ID.", { status: 400 });
  }

  const resource = await getResourceById(resourceId);
  if (!resource) {
    throw data("Resource not found.", { status: 404 });
  }

  const category = await getCategoryById(resource.categoryId);

  const contentHtml = resource.content
    ? await renderMarkdown(resource.content)
    : null;

  return {
    resource,
    contentHtml,
    categoryTitle: category?.title ?? "Resources",
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-4 w-48" />
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function PartnerResourceView({
  loaderData,
}: Route.ComponentProps) {
  const { resource, contentHtml, categoryTitle } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/partner-resources" className="hover:text-foreground">
          Partner Resources
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted-foreground">{categoryTitle}</span>
        <span className="mx-2">/</span>
        <span className="text-foreground">{resource.title}</span>
      </nav>

      <Link
        to="/partner-resources"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1 size-4" />
        Back to Partner Resources
      </Link>

      <h1 className="mb-6 text-3xl font-bold">{resource.title}</h1>

      {contentHtml ? (
        <div
          className="prose prose-neutral dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No content has been added to this resource yet.
          </CardContent>
        </Card>
      )}
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
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have access to this resource.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message = "Please log in to access partner resources.";
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
        <Link to="/partner-resources">
          <Button>Back to Partner Resources</Button>
        </Link>
      </div>
    </div>
  );
}
