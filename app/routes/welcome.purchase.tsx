import { Link } from "react-router";
import { createHash } from "crypto";
import type { Route } from "./+types/welcome.purchase";
import { getSupabaseAdmin } from "~/lib/supabase-admin.server";

export function meta() {
  return [
    { title: "You're In! — AI for the Long Game" },
    { name: "description", content: "Welcome to AI for the Long Game" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const hash = url.searchParams.get("thrivecart_hash");
  const secret = process.env.THRIVECART_SECRET;

  // Collect all thrivecart[...] params
  const thrivecartData: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^thrivecart\[(.+)\]$/);
    if (match) {
      thrivecartData[match[1]] = value;
    }
  }

  const email = thrivecartData["customer_email"] || thrivecartData["email"] || null;
  let hashValid = false;

  // Verify hash if we have the secret and hash
  if (secret && hash && Object.keys(thrivecartData).length > 0) {
    const sortedKeys = Object.keys(thrivecartData).sort();
    const sorted: Record<string, string> = {};
    for (const k of sortedKeys) {
      sorted[k] = thrivecartData[k];
    }
    const jsonStr = JSON.stringify(sorted).toUpperCase();
    const expectedHash = createHash("md5")
      .update(secret + jsonStr)
      .digest("hex");
    hashValid = expectedHash === hash;
  }

  // If hash is valid and we have an email, send magic link as fallback
  // (in case webhook hasn't processed yet)
  if (hashValid && email) {
    try {
      const supabaseAdmin = getSupabaseAdmin();
      await supabaseAdmin.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: "https://app.long-game.ai/auth/callback",
        },
      });
    } catch {
      // Non-critical — webhook should handle this
    }
  }

  return { email, hashValid };
}

export default function WelcomePurchase({ loaderData }: Route.ComponentProps) {
  const { email } = loaderData;

  return (
    <div className="flex min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-6 py-16">
        {/* Brand */}
        <Link
          to="/"
          className="mb-12 text-2xl font-bold tracking-tight text-foreground"
        >
          Long-Game
        </Link>

        {/* Main content */}
        <div className="w-full rounded-xl border bg-card p-10 text-center shadow-sm">
          {/* Success icon */}
          <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <svg
              className="size-7 text-emerald-600 dark:text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>

          <h1 className="mb-2 text-3xl font-bold tracking-tight">
            You're in!
          </h1>
          <p className="mb-8 text-lg text-muted-foreground">
            Welcome to <strong>AI for the Long Game</strong>. Your purchase is
            confirmed.
          </p>

          {/* Next steps */}
          <div className="mb-8 space-y-4 text-left">
            <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Here's what happens next
            </h2>

            <div className="flex gap-4 rounded-lg border bg-background p-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                1
              </div>
              <div>
                <p className="font-medium">Check your email</p>
                <p className="text-sm text-muted-foreground">
                  We sent a login link to
                  {email ? (
                    <strong className="text-foreground"> {email}</strong>
                  ) : (
                    " your email address"
                  )}
                  . It should arrive within a minute.
                </p>
              </div>
            </div>

            <div className="flex gap-4 rounded-lg border bg-background p-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                2
              </div>
              <div>
                <p className="font-medium">Set your password</p>
                <p className="text-sm text-muted-foreground">
                  After clicking the link, you'll create a password so you can
                  log in anytime.
                </p>
              </div>
            </div>

            <div className="flex gap-4 rounded-lg border bg-background p-4">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                3
              </div>
              <div>
                <p className="font-medium">Start learning</p>
                <p className="text-sm text-muted-foreground">
                  You'll have immediate access to the full course. Use AI with
                  confidence, no matter what changes next.
                </p>
              </div>
            </div>
          </div>

          {/* Help text */}
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p>
              Don't see the email? Check your spam folder. If it still doesn't
              show up,{" "}
              <Link
                to="/login"
                className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
              >
                request a new login link here
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-muted-foreground">
          AI for the Long Game &mdash; Use AI with confidence.
        </p>
      </div>
    </div>
  );
}
