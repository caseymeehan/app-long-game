import {
  Form,
  Link,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/signup";
import { getCurrentUserId } from "~/lib/session";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { getUserByEmail } from "~/services/userService";
import { db } from "~/db";
import { users, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";
import { useState } from "react";

type ActionResult = {
  errors: Record<string, string>;
  values: { name: string; email: string };
  magicLinkSent: boolean;
};

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
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
    { title: "Sign Up — AI for the Long Game" },
    { name: "description", content: "Create your AI for the Long Game account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo");
    const destination =
      redirectTo && redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/courses";
    throw redirect(destination);
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, signupSchema);

  if (!parsed.success) {
    return data(
      {
        errors: parsed.errors,
        values: {
          name: String(formData.get("name") ?? ""),
          email: String(formData.get("email") ?? ""),
        },
        magicLinkSent: false,
      },
      { status: 400 }
    );
  }

  const { name, email, password, method } = parsed.data;
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
        data: { name },
        emailRedirectTo: `${url.origin}/auth/callback?redirectTo=${encodeURIComponent(destination)}`,
      },
    });

    if (error) {
      return data(
        {
          errors: { email: error.message },
          values: { name, email },
          magicLinkSent: false,
        },
        { status: 400 }
      );
    }

    return data(
      {
        errors: {} as Record<string, string>,
        values: { name, email },
        magicLinkSent: true,
      },
      { headers: responseHeaders }
    );
  }

  // Email + password signup
  if (!password || password.length < 6) {
    return data(
      {
        errors: { password: "Password must be at least 6 characters." },
        values: { name, email },
        magicLinkSent: false,
      },
      { status: 400 }
    );
  }

  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
    },
  });

  if (error) {
    return data(
      {
        errors: { email: error.message },
        values: { name, email },
        magicLinkSent: false,
      },
      { status: 400, headers: responseHeaders }
    );
  }

  // Create app user linked to Supabase auth user
  if (signUpData.user) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.supabaseAuthId, signUpData.user.id));

    if (!existing) {
      await db.insert(users).values({
        name,
        email,
        role: UserRole.Student,
        supabaseAuthId: signUpData.user.id,
      });
    }
  }

  throw redirect(destination, { headers: responseHeaders });
}

export default function SignUp() {
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
            email to sign up.
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
            AI for the Long Game
          </Link>
          <h1 className="mt-4 text-xl font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start learning today
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="method" value={method} />
              <div>
                <label
                  htmlFor="name"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Name
                </label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="Your name"
                  defaultValue={actionData?.values?.name ?? ""}
                  aria-invalid={!!actionData?.errors?.name}
                />
                {actionData?.errors?.name && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.name}
                  </p>
                )}
              </div>

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
                    placeholder="At least 6 characters"
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
                  ? "Creating account..."
                  : method === "magic_link"
                    ? "Send Magic Link"
                    : "Sign Up"}
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
          Already have an account?{" "}
          <Link
            to={
              redirectTo
                ? `/login?redirectTo=${encodeURIComponent(redirectTo)}`
                : "/login"
            }
            className="font-medium text-primary hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
