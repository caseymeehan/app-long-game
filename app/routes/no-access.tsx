import { Link } from "react-router";
import type { Route } from "./+types/no-access";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Button } from "~/components/ui/button";
import { Lock, LogOut } from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Access Required — AI for the Long Game" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  const currentUser = currentUserId ? await getUserById(currentUserId) : null;
  return { currentUser };
}

export default function NoAccess({ loaderData }: Route.ComponentProps) {
  const { currentUser } = loaderData;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-muted">
          <Lock className="size-8 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Access Required
        </h1>
        <p className="mt-3 text-muted-foreground">
          {currentUser
            ? `Hey ${currentUser.name.split(" ")[0]}, you need to purchase the program to access the platform.`
            : "You need to purchase the program to access the platform."}
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button asChild size="lg">
            <a
              href="https://long-game.ai"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn More & Enroll
            </a>
          </Button>
          {currentUser && (
            <form method="post" action="/api/logout">
              <button
                type="submit"
                className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
