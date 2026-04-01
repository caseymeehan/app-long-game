import { Link } from "react-router";
import { createHash } from "crypto";
import type { Route } from "./+types/welcome.purchase";
import { getSupabaseAdmin } from "~/lib/supabase-admin.server";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";

export function meta() {
  return [
    { title: "You're In! — Long-Game" },
    { name: "description", content: "Welcome to AI For The Long Game" },
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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Long-Game
          </Link>
        </div>

        <Card>
          <CardContent className="p-8 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <span className="text-3xl">&#10003;</span>
            </div>

            <h1 className="mb-2 text-2xl font-bold">You're in!</h1>

            <p className="mb-4 text-muted-foreground">
              Your purchase is confirmed. We've sent a login link to
              {email ? (
                <>
                  {" "}
                  <strong>{email}</strong>
                </>
              ) : (
                " your email"
              )}
              .
            </p>

            <p className="mb-6 text-sm text-muted-foreground">
              Click the link in your email to access the course. It may take a
              minute to arrive — check your spam folder if you don't see it.
            </p>

            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Already have your password? Log in here</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
