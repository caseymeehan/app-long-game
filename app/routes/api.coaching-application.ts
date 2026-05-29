import * as Sentry from "@sentry/react-router";
import { Resend } from "resend";
import { z } from "zod";
import { db } from "~/db";
import { coachingApplications } from "~/db/schema";
import type { Route } from "./+types/api.coaching-application";

const BASE = "https://join.long-game.ai/one-on-one/";
// Notify multiple inboxes so a single mailbox/spam-filter problem never hides a
// lead. The DB row is still the source of truth.
const NOTIFY_TO = ["hello@blazingzebra.ai", "casey@epicpresence.com"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Truncate (never reject) over-long text so a heartfelt long answer is never
// lost. Trims whitespace; caps generously.
const text = (max: number) =>
  z
    .string()
    .optional()
    .default("")
    .transform((s) => s.slice(0, max));

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://join.long-game.ai",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Everything is lenient on purpose: this form captures high-value leads, so we
// never reject a real submission over a length cap or a stray space. Bad input
// is saved-and-flagged (see the email below), not dropped.
const applicationSchema = z.object({
  describesYou: text(500),
  biggestChallenge: text(8000),
  engineChange: text(8000),
  helpAreas: text(4000),
  focusQuestion: text(8000),
  interestLevel: text(500),
  budget: text(500),
  name: z
    .string()
    .optional()
    .default("")
    .transform((s) => s.trim().slice(0, 200)),
  email: z
    .string()
    .optional()
    .default("")
    .transform((s) => s.trim().slice(0, 320)),
  redirectTo: z
    .string()
    .optional()
    .default(BASE)
    .transform((s) => {
      try {
        return new URL(s).toString();
      } catch {
        return BASE;
      }
    }),
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

    // Bot protection is handled server-side by the Cloudflare Turnstile check
    // below. We deliberately do NOT use a honeypot field here: a hidden field
    // (e.g. name="website") gets auto-filled by browsers/password managers,
    // which silently dropped real applications as "bots".

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

    // Captcha — FAIL OPEN. A blocked Cloudflare script (ad-blockers, privacy
    // browsers, corporate firewalls) or a Turnstile outage must never cost us a
    // real lead, so we never drop a submission on captcha failure. We record
    // whether it verified and flag unverified ones in the notification so spam
    // can be triaged by eye. Bot tolerance is an explicit, accepted tradeoff.
    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      null;
    const token = (formData.get("cf-turnstile-response") ?? "").toString();
    const captchaVerified = await verifyTurnstile(token, ip);
    if (!captchaVerified) {
      console.warn("[coaching-application] Captcha not verified — saving anyway (fail-open), flagged for review");
    }

    const emailLooksValid = EMAIL_RE.test(data.email);
    const flags: string[] = [];
    if (!captchaVerified) flags.push("captcha-unverified");
    if (!emailLooksValid) flags.push("email-looks-invalid");
    if (!data.name) flags.push("no-name");

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
        const flagPrefix = flags.length ? `[review: ${flags.join(", ")}] ` : "";
        await resend.emails.send({
          from: "Long Game Applications <hello@blazingzebra.ai>",
          to: NOTIFY_TO,
          // Only set replyTo when the address is well-formed — a malformed
          // replyTo can make Resend reject the whole send and lose the notice.
          ...(emailLooksValid ? { replyTo: data.email } : {}),
          subject: `${flagPrefix}New 1:1 coaching application — ${data.name || "(no name)"}`,
          text: [
            `New application from the /one-on-one page.`,
            flags.length ? `\n⚠ FLAGGED FOR REVIEW: ${flags.join(", ")}\n` : ``,
            `Name:  ${data.name || "(not provided)"}`,
            `Email: ${data.email || "(not provided)"}${emailLooksValid ? "" : "  ⚠ may be invalid — double-check before replying"}`,
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
        console.log(`[coaching-application] Notification email sent to ${NOTIFY_TO.join(", ")}`);
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
