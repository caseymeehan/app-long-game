import { Form, Link, useActionData, useNavigation } from "react-router";
import { redirect, data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/set-password";
import { getCurrentUserId } from "~/lib/session";
import { createSupabaseServerClient } from "~/lib/supabase.server";
import { parseFormData } from "~/lib/validation";
import { clearPasswordSetupFlag } from "~/services/userService";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";

type ActionResult = {
  errors: Record<string, string>;
  success: boolean;
};

const setPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export function meta() {
  return [
    { title: "Set Your Password — AI for the Long Game" },
    { name: "description", content: "Create a password for your AI for the Long Game account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect("/login");
  }
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const responseHeaders = new Headers();
  const currentUserId = await getCurrentUserId(request, responseHeaders);

  if (!currentUserId) {
    throw redirect("/login");
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, setPasswordSchema);

  if (!parsed.success) {
    return data(
      { errors: parsed.errors, success: false },
      { status: 400, headers: responseHeaders }
    );
  }

  const { password } = parsed.data;
  const supabase = createSupabaseServerClient(request, responseHeaders);

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return data(
      { errors: { password: error.message }, success: false },
      { status: 400, headers: responseHeaders }
    );
  }

  await clearPasswordSetupFlag(currentUserId);

  throw redirect("/courses", { headers: responseHeaders });
}

export default function SetPassword() {
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Long-Game
          </Link>
          <h1 className="mt-4 text-xl font-semibold">Set your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a password so you can log in anytime
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
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
                  placeholder="At least 8 characters"
                  aria-invalid={!!actionData?.errors?.password}
                />
                {actionData?.errors?.password && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.password}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-1.5 block text-sm font-medium"
                >
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  placeholder="Type it again"
                  aria-invalid={!!actionData?.errors?.confirmPassword}
                />
                {actionData?.errors?.confirmPassword && (
                  <p className="mt-1 text-sm text-destructive">
                    {actionData.errors.confirmPassword}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Setting password..." : "Set Password & Continue"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
