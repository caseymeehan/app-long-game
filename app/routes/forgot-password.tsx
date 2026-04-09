import {
  Form,
  Link,
  useActionData,
  useNavigation,
} from "react-router";
import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/forgot-password";
import { getCurrentUserId } from "~/lib/session";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { parseFormData } from "~/lib/validation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";

type ActionResult = {
  errors: Record<string, string>;
  values: { email: string };
  linkSent: boolean;
};

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
});

export function meta() {
  return [
    { title: "Forgot Password — AI for the Long Game" },
    { name: "description", content: "Request a login link for your account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    throw redirect("/");
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, forgotPasswordSchema);

  if (!parsed.success) {
    return data(
      {
        errors: parsed.errors,
        values: { email: String(formData.get("email") ?? "") },
        linkSent: false,
      },
      { status: 400 }
    );
  }

  const { email } = parsed.data;
  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient(request, responseHeaders);

  const url = new URL(request.url);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${url.origin}/auth/callback`,
    },
  });

  if (error) {
    return data(
      {
        errors: { email: error.message },
        values: { email },
        linkSent: false,
      },
      { status: 400 }
    );
  }

  return data(
    {
      errors: {} as Record<string, string>,
      values: { email },
      linkSent: true,
    },
    { headers: responseHeaders }
  );
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (actionData?.linkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
            <span className="text-2xl">✉️</span>
          </div>
          <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a login link to{" "}
            <strong>{actionData.values?.email}</strong>. Click the link in the
            email to access your account.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            Back to login
          </Link>
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
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your email and we'll send you a link to log in.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
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

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send me a login link"}
              </Button>
            </Form>

            <div className="mt-4 text-center">
              <Link
                to="/login"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
