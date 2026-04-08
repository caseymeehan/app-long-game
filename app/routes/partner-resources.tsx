import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/partner-resources";
import {
  getPageSettings,
  getAllCategoriesWithResources,
} from "~/services/partnerResourceService";
import { isActivePartner, getPartnerByUserId } from "~/services/partnerService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import { renderMarkdown } from "~/lib/markdown.server";
import { YouTubePlayer } from "~/components/youtube-player";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, FileText } from "lucide-react";
import { Button } from "~/components/ui/button";
import { data, isRouteErrorResponse } from "react-router";

export function meta() {
  return [
    { title: "Partner Resources — Long-Game" },
    { name: "description", content: "Partner marketing resources and materials" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
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

  const partner = await getPartnerByUserId(currentUser.id);
  const pageSettings = await getPageSettings();
  const categories = await getAllCategoriesWithResources();

  const contentHtml = pageSettings?.content
    ? await renderMarkdown(pageSettings.content)
    : null;

  return {
    pageSettings: pageSettings
      ? { ...pageSettings, contentHtml }
      : null,
    categories,
    affiliateId: partner?.affiliateId ?? null,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <Skeleton className="mb-4 h-48 w-full" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

function AffiliateLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium w-36">{label}</span>
      <code className="flex-1 rounded bg-muted px-3 py-1.5 text-sm break-all">
        {url}
      </code>
      <Button variant="outline" size="sm" onClick={handleCopy}>
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}

export default function PartnerResources({
  loaderData,
}: Route.ComponentProps) {
  const { pageSettings, categories, affiliateId } = loaderData;

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <h1 className="mb-6 text-3xl font-bold">Partner Resources</h1>

      {/* Affiliate links */}
      {affiliateId && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">Your Affiliate Links</h2>
            <div className="space-y-3">
              <AffiliateLink
                label="Masterclass Opt-in"
                url={`https://join.long-game.ai/masterclass?ref=${affiliateId}`}
              />
              <AffiliateLink
                label="Sales Page"
                url={`https://join.long-game.ai?ref=${affiliateId}`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Welcome video */}
      {pageSettings?.videoUrl && (
        <div className="mb-6">
          <YouTubePlayer
            videoUrl={pageSettings.videoUrl}
            lessonId={0}
            title="Partner Welcome"
            startPosition={0}
            durationMinutes={null}
            watchProgress={0}
            trackingEnabled={false}
            autoplay={false}
            onToggleAutoplay={() => {}}
          />
        </div>
      )}

      {/* Intro content */}
      {pageSettings?.contentHtml && (
        <div
          className="prose prose-neutral dark:prose-invert mb-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: pageSettings.contentHtml }}
        />
      )}

      {/* Resource categories */}
      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No resources available yet. Check back soon!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {categories.map((cat) => (
            <section key={cat.id}>
              <h2 className="mb-3 text-xl font-semibold border-b pb-2">
                {cat.title}
              </h2>
              {cat.resources.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No resources in this category yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {cat.resources.map((resource) => (
                    <Link
                      key={resource.id}
                      to={`/partner-resources/${resource.id}`}
                      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-muted"
                    >
                      <FileText className="size-4 shrink-0 text-amber-500" />
                      <span>{resource.title}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have access to partner resources.";
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
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
