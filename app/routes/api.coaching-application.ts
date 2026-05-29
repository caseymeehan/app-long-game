import * as Sentry from "@sentry/react-router";
import { Resend } from "resend";
import { z } from "zod";
import { db } from "~/db";
import { coachingApplications } from "~/db/schema";
import type { Route } from "./+types/api.coaching-application";

const BASE = "https://join.long-game.ai/one-on-one/";
const NOTIFY_TO = "hello@blazingzebra.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://join.long-game.ai",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const applicationSchema = z.object({
  describesYou: z.string().max(200).optional().default(""),
  biggestChallenge: z.string().max(5000).optional().default(""),
  engineChange: z.string().max(5000).optional().default(""),
  helpAreas: z.string().max(2000).optional().default(""),
  focusQuestion: z.string().max(5000).optional().default(""),
  interestLevel: z.string().max(200).optional().default(""),
  budget: z.string().max(200).optional().default(""),
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  redirectTo: z.string().url().optional().default(BASE),
});

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, ...corsHeaders },
  });
}

// Verify a Cloudflare Turnstile token. Returns true when the secret is not yet
// configured, so the form keeps working (behind the honeypot) until the widget
// is set up; once TURNSTILE_SECRET_KEY is present, verification is enforced.
async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[coaching-application] TURNSTILE_SECRET_KEY not set — skipping captcha verification");
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[coaching-application] Turnstile verify error:", err);
    Sentry.captureException(err, { tags: { stage: "turnstile" } });
    return false;
  }
}

// OPTIONS preflight + HEAD/GET check
export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response("OK", { status: 200, headers: corsHeaders });
}

export const action = Sentry.wrapServerAction(
  { name: "coaching-application", description: "1:1 coaching application capture + Resend notify" },
  async ({ request }: Route.ActionArgs) => {
    Sentry.setTag("webhook", "coaching-application");

    const formData = await request.formData();

    // Honeypot: real users never see/fill this. If filled, pretend success
    // (don't save, don't email) so bots get no signal.
    if ((formData.get("website") ?? "").toString().trim() !== "") {
      console.warn("[coaching-application] Honeypot tripped — dropping submission");
      return redirect(`${BASE}?submitted=1`);
    }

    // Checkboxes share name="helpAreas"; collect all checked values.
    const helpAreas = formData
      .getAll("helpAreas")
      .map((v) => v.toString())
      .filter(Boolean)
      .join(" • ");

    const raw = {
      describesYou: formData.get("describesYou") ?? undefined,
      biggestChallenge: formData.get("biggestChallenge") ?? undefined,
      engineChange: formData.get("engineChange") ?? undefined,
      helpAreas: helpAreas || undefined,
      focusQuestion: formData.get("focusQuestion") ?? undefined,
      interestLevel: formData.get("interestLevel") ?? undefined,
      budget: formData.get("budget") ?? undefined,
      name: formData.get("name") ?? undefined,
      email: formData.get("email") ?? undefined,
      redirectTo: formData.get("redirectTo") ?? undefined,
    };

    const parsed = applicationSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[coaching-application] Validation failed:", parsed.error.message);
      const back = typeof raw.redirectTo === "string" && raw.redirectTo ? raw.redirectTo : BASE;
      return redirect(`${back}?error=validation`);
    }

    const data = parsed.data;
    const { redirectTo } = data;

    // Captcha
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      null;
    const token = (formData.get("cf-turnstile-response") ?? "").toString();
    const captchaOk = await verifyTurnstile(token, ip);
    if (!captchaOk) {
      console.warn("[coaching-application] Captcha verification failed");
      return redirect(`${redirectTo}?error=captcha`);
    }

    // Failsafe: the DB row is the source of truth and is written first, so a
    // Resend outage never loses a lead. We still attempt the email even if the
    // insert throws, and only report failure to the applicant if BOTH fail.
    let saved = false;
    let emailed = false;

    try {
      await db.insert(coachingApplications).values({
        describesYou: data.describesYou,
        biggestChallenge: data.biggestChallenge,
        engineChange: data.engineChange,
        helpAreas: data.helpAreas,
        focusQuestion: data.focusQuestion,
        interestLevel: data.interestLevel,
        budget: data.budget,
        name: data.name,
        email: data.email,
      });
      saved = true;
      console.log(`[coaching-application] Saved application from ${data.email}`);
    } catch (err) {
      console.error("[coaching-application] DB insert failed:", err);
      Sentry.captureException(err, { tags: { stage: "db-insert" } });
    }

    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Long Game Applications <hello@blazingzebra.ai>",
          to: [NOTIFY_TO],
          replyTo: data.email,
          subject: `New 1:1 coaching application — ${data.name}`,
          text: [
            `New application from the /one-on-one page.`,
            ``,
            `Name:  ${data.name}`,
            `Email: ${data.email}`,
            ``,
            `Biggest challenge with AI right now?`,
            `  ${data.biggestChallenge || "—"}`,
            ``,
            `If one thing got 10x easier, 10x better, what change would move you forward most?`,
            `  ${data.engineChange || "—"}`,
            ``,
            `Areas they most need help with:`,
            `  ${data.helpAreas || "—"}`,
            ``,
            saved ? `(Saved to coaching_applications.)` : `(WARNING: DB insert failed — this email is the only copy.)`,
          ].join("\n"),
        });
        emailed = true;
        console.log(`[coaching-application] Notification email sent to ${NOTIFY_TO}`);
      } else {
        console.warn("[coaching-application] RESEND_API_KEY not set — skipping notification email");
      }
    } catch (err) {
      console.error("[coaching-application] Resend email failed:", err);
      Sentry.captureException(err, { tags: { stage: "resend" } });
    }

    if (!saved && !emailed) {
      Sentry.captureException(new Error("Coaching application not captured (DB + email both failed)"), {
        tags: { stage: "capture" },
        extra: { email: data.email },
      });
      return redirect(`${redirectTo}?error=1`);
    }

    return redirect(`${redirectTo}?submitted=1`);
  },
);
