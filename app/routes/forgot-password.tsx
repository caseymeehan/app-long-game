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
import { redirectAfterLogin } from "~/lib/post-login.server";
import { parseFormData } from "~/lib/validation";
import { setPasswordSetupFlag } from "~/services/userService";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent } from "~/components/ui/card";

type ActionResult = {
  stage: "request" | "code";
  email: string;
  errors: Record<string, string>;
  notice?: string;
};

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
});

const codeSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
});

export function meta() {
  return [
    { title: "Log In — AI for the Long Game" },
    { name: "description", content: "Get a login code for your account" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    throw redirect("/");
  }
  const url = new URL(request.url);
  const emailParam = url.searchParams.get("email") ?? "";
  return { emailParam };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "request-code");
  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient(request, responseHeaders);

  // Step 2: user typed the 6-digit code. verifyOtp needs no PKCE verifier
  // cookie, so it works on whatever device they're holding (and there's no
  // link for a corporate scanner to pre-consume).
  if (intent === "verify-code") {
    const parsed = parseFormData(formData, codeSchema);
    if (!parsed.success) {
      return data(
        {
          stage: "code",
          email: String(formData.get("email") ?? ""),
          errors: parsed.errors,
        },
        { status: 400 }
      );
    }

    const { email, code } = parsed.data;
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    if (error) {
      return data(
        {
          stage: "code",
          email,
          errors: {
            code: "That code is invalid or has expired. Request a new one below.",
          },
        },
        { status: 400, headers: responseHeaders }
      );
    }

    return await redirectAfterLogin(supabase, responseHeaders);
  }

  // Step 1: send (or resend) the login code.
  const parsed = parseFormData(formData, emailSchema);
  if (!parsed.success) {
    return data(
      {
        stage: "request",
        email: String(formData.get("email") ?? ""),
        errors: parsed.errors,
      },
      { status: 400 }
    );
  }

  const { email } = parsed.data;
  const isResend = formData.get("resend") === "1";

  // Flag the user to set a password after logging in with the code.
  await setPasswordSetupFlag(email);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Don't spawn a brand-new auth user for an unknown email. Without this,
      // a fat-fingered address creates an orphan auth.users row that lands on
      // an empty dashboard (see the Jason McNish three-accounts case).
      shouldCreateUser: false,
    },
  });

  // With shouldCreateUser:false, an unknown email throws "Signups not allowed
  // for otp" (code otp_disabled). Swallow that one case and advance to the code
  // screen anyway, so the response never reveals whether an account exists
  // (anti-enumeration). Typing any code there simply fails to verify.
  const isUnknownEmail =
    error?.code === "otp_disabled" ||
    /signups? not allowed/i.test(error?.message ?? "");

  // Supabase enforces a per-email send cooldown (60s). Surface it gently
  // instead of treating it as a hard failure.
  const isRateLimited =
    error?.code === "over_email_send_rate_limit" ||
    /after \d+ seconds|rate limit|too many requests/i.test(error?.message ?? "");

  if (error && !isUnknownEmail && !isRateLimited) {
    return data(
      {
        stage: "request",
        email,
        errors: { email: error.message },
      },
      { status: 400 }
    );
  }

  return data(
    {
      stage: "code" as const,
      email,
      errors: {} as Record<string, string>,
      notice: isRateLimited
        ? "You just requested a code — please wait a moment before requesting another, then check your email."
        : isResend
          ? "We sent a new code to your email."
          : undefined,
    },
    { headers: responseHeaders }
  );
}

export default function ForgotPassword({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>() as ActionResult | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (actionData?.stage === "code") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10">
              <span className="text-2xl">✉️</span>
            </div>
            <h1 className="mb-2 text-xl font-semibold">Enter your code</h1>
            <p className="text-sm text-muted-foreground">
              We emailed a 6-digit code to{" "}
              <strong>{actionData.email}</strong>. Enter it below to log in.
            </p>
          </div>

          <Card>
            <CardContent className="p-6">
              {actionData.notice && (
                <p className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  {actionData.notice}
                </p>
              )}

              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="verify-code" />
                <input type="hidden" name="email" value={actionData.email} />
                <div>
                  <label
                    htmlFor="code"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    6-digit code
                  </label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    autoFocus
                    className="text-center text-lg tracking-[0.5em]"
                    aria-invalid={!!actionData.errors?.code}
                  />
                  {actionData.errors?.code && (
                    <p className="mt-1 text-sm text-destructive">
                      {actionData.errors.code}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Verifying..." : "Verify & continue"}
                </Button>
              </Form>

              <div className="mt-4 border-t pt-4">
                <Form method="post" className="text-center">
                  <input type="hidden" name="intent" value="request-code" />
                  <input type="hidden" name="email" value={actionData.email} />
                  <input type="hidden" name="resend" value="1" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="text-sm font-medium text-foreground hover:underline disabled:opacity-50"
                  >
                    Resend code
                  </button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Didn't get it? Check your spam folder, or request a new code.
                  </p>
                </Form>
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to login
            </Link>
          </div>
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
            Enter your email and we'll send you a code to log in.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="request-code" />
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
                  defaultValue={actionData?.email ?? loaderData?.emailParam ?? ""}
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
                {isSubmitting ? "Sending..." : "Send me a login code"}
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
