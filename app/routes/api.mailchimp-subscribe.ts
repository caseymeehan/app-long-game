import { createHash } from "crypto";
import * as Sentry from "@sentry/react-router";
import { Resend } from "resend";
import { z } from "zod";
import type { Route } from "./+types/api.mailchimp-subscribe";

const subscribeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().default(""),
  affiliateRef: z.string().optional().default(""),
  redirectTo: z
    .string()
    .url()
    .optional()
    .default("https://join.long-game.ai/masterclass/training"),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://join.long-game.ai",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// OPTIONS preflight + HEAD/GET check
export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  return new Response("OK", { status: 200, headers: corsHeaders });
}

export const action = Sentry.wrapServerAction(
  { name: "mailchimp-subscribe", description: "MailChimp subscribe + Resend confirmation" },
  async ({ request }: Route.ActionArgs) => {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = process.env.MAILCHIMP_LIST_ID;
  const dc = process.env.MAILCHIMP_DC;

  Sentry.setTag("webhook", "mailchimp-subscribe");

  if (!apiKey || !listId || !dc) {
    console.error("[mailchimp-subscribe] Missing MAILCHIMP env vars");
    Sentry.captureException(new Error("Missing MAILCHIMP env vars"), {
      tags: { stage: "config" },
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: "https://join.long-game.ai/masterclass/training?error=1",
        ...corsHeaders,
      },
    });
  }

  // Parse form body
  const formData = await request.formData();
  const raw = {
    email: formData.get("email") ?? undefined,
    firstName: formData.get("firstName") ?? undefined,
    affiliateRef: formData.get("affiliateRef") ?? undefined,
    redirectTo: formData.get("redirectTo") ?? undefined,
  };

  const parsed = subscribeSchema.safeParse(raw);

  if (!parsed.success) {
    console.error("[mailchimp-subscribe] Validation failed:", parsed.error.message);
    const redirectTo =
      typeof raw.redirectTo === "string" && raw.redirectTo
        ? raw.redirectTo
        : "https://join.long-game.ai/masterclass/training";
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectTo}?error=1`, ...corsHeaders },
    });
  }

  const { email, firstName, affiliateRef, redirectTo } = parsed.data;

  const emailHash = createHash("md5")
    .update(email.toLowerCase().trim())
    .digest("hex");

  try {
    const res = await fetch(
      `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${emailHash}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: email,
          status_if_new: "subscribed",
          merge_fields: {
            FNAME: firstName,
            AFREF: affiliateRef,
          },
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[mailchimp-subscribe] MailChimp API error ${res.status}: ${body}`
      );
      Sentry.captureException(new Error(`MailChimp API error ${res.status}`), {
        tags: { stage: "mailchimp" },
        extra: { status: res.status, body: body.slice(0, 500) },
      });
      return new Response(null, {
        status: 302,
        headers: { Location: `${redirectTo}?error=1`, ...corsHeaders },
      });
    }

    console.log(`[mailchimp-subscribe] Subscribed ${email} (ref: ${affiliateRef || "none"})`);

    // Send confirmation email via Resend (fire-and-forget, never blocks redirect)
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Casey Meehan <hello@blazingzebra.ai>",
          to: [email],
          subject: "You're in! Here's what to expect",
          text: `Thanks for signing up for the AI Systems Masterclass — you're in!

Lesson 1 drops on April 22, 2026 at 10:00 AM ET. You'll get an email from me when it's live.

To make sure you don't miss it, here are a few quick things you can do:

- Add hello@blazingzebra.ai to your contacts
- Check your Promotions or Spam folder and move this email to your Primary inbox
- Reply to this email with "got it" — it helps with deliverability

I'm excited to share this with you. Talk soon.

- Casey`,
        });
        console.log(`[mailchimp-subscribe] Resend confirmation sent to ${email}`);
      }
    } catch (resendErr) {
      console.error("[mailchimp-subscribe] Resend email failed (non-blocking):", resendErr);
      Sentry.captureException(resendErr, { tags: { stage: "resend" } });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo, ...corsHeaders },
    });
  } catch (err) {
    console.error("[mailchimp-subscribe] Fetch error:", err);
    Sentry.captureException(err, { tags: { stage: "mailchimp-fetch" } });
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectTo}?error=1`, ...corsHeaders },
    });
  }
  },
);
