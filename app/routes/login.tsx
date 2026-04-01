import {
  Form,
  Link,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/login";
import { getCurrentUserId } from "~/lib/session";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { useState } from "react";

type ActionResult = {
  errors: Record<string, string>;
  values: { email: string };
  magicLinkSent: boolean;
};

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z.string().optional(),
  method: z.enum(["password", "magic_link"]),
});

export function meta() {
  return [
    { title: "Log In — Long-Game" },
    { name: "description", content: "Log in to your Long-Game account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo");
    const destination =
      redirectTo && redirectTo.startsWith("/") ? redirectTo : "/courses";
    throw redirect(destination);
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, loginSchema);

  if (!parsed.success) {
    return data(
      {
        errors: parsed.errors,
        values: { email: String(formData.get("email") ?? "") },
        magicLinkSent: false,
      },
      { status: 400 }
    );
  }

  const { email, password, method } = parsed.data;
  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient(request, responseHeaders);

  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo");
  const destination =
    redirectTo && redirectTo.startsWith("/") ? redirectTo : "/courses";

  if (method === "magic_link") {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${url.origin}/auth/callback?redirectTo=${encodeURIComponent(destination)}`,
      },
    });

    if (error) {
      return data(
        {
          errors: { email: error.message },
          values: { email },
          magicLinkSent: false,
        },
        { status: 400 }
      );
    }

    return data(
      {
        errors: {} as Record<string, string>,
        values: { email },
        magicLinkSent: true,
      },
      { headers: responseHeaders }
    );
  }

  // Email + password login
  if (!password) {
    return data(
      {
        errors: { password: "Password is required." },
        values: { email },
        magicLinkSent: false,
      },
      { status: 400 }
    );
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return data(
      {
        errors: { email: error.message },
        values: { email },
        magicLinkSent: false,
      },
      { status: 400, headers: responseHeaders }
    );
  }

  throw redirect(destination, { headers: responseHeaders });
}

export default function Login() {
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");
  const [method, setMethod] = useState<"password" | "magic_link">("password");

  if (actionData?.magicLinkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
            <span className="text-2xl">✉️</span>
          </div>
          <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a magic link to{" "}
            <strong>{actionData.values?.email}</strong>. Click the link in the
            email to log in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Long-Game
          </Link>
          <h1 className="mt-4 text-xl font-semibold">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Log in to continue learning
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="method" value={method} />
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  defaultValue={actionData?.values?.email ?? ""}
                  aria-invalid={!!actionData?.errors?.email}
                />
                {actionData?.errors?.email && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.email}
                  </p>
                )}
              </div>

              {method === "password" && (
                <div>
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Password
                  </label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Your password"
                    aria-invalid={!!actionData?.errors?.password}
                  />
                  {actionData?.errors?.password && (
                    <p className="mt-1 text-sm text-destructive">
                      {actionData.errors.password}
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Logging in..."
                  : method === "magic_link"
                    ? "Send Magic Link"
                    : "Log In"}
              </Button>
            </Form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() =>
                  setMethod(method === "password" ? "magic_link" : "password")
                }
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {method === "password"
                  ? "Use magic link instead"
                  : "Use password instead"}
              </button>
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link
            to={
              redirectTo
                ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}`
                : "/signup"
            }
            className="font-medium text-primary hover:underline"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
