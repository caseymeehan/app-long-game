import { createHash } from "crypto";
import * as Sentry from "@sentry/react-router";
import { Resend } from "resend";
import { z } from "zod";
import type { Route } from "./+types/api.mailchimp-subscribe";

const subscribeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().default(""),
  affiliateRef: z.string().optional().default(""),
  tags: z.string().optional().default(""),
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
    tags: formData.get("tags") ?? undefined,
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

  const { email, firstName, affiliateRef, tags, redirectTo } = parsed.data;
  const tagList = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

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
          ...(tagList.length > 0 ? { tags: tagList } : {}),
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

    console.log(`[mailchimp-subscribe] Subscribed ${email} (ref: ${affiliateRef || "none"}, tags: ${tagList.join("|") || "none"})`);

    // For existing members the PUT body's `tags` is sometimes ignored; the
    // canonical way to set tags is a follow-up POST to /members/{hash}/tags.
    if (tagList.length > 0) {
      try {
        const tagRes = await fetch(
          `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${emailHash}/tags`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`anystring:${apiKey}`)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tags: tagList.map((name) => ({ name, status: "active" })),
            }),
          }
        );
        if (!tagRes.ok) {
          const body = await tagRes.text();
          console.error(`[mailchimp-subscribe] Tag POST error ${tagRes.status}: ${body}`);
          Sentry.captureException(new Error(`MailChimp tag POST error ${tagRes.status}`), {
            tags: { stage: "mailchimp-tags" },
            extra: { status: tagRes.status, body: body.slice(0, 500) },
          });
        }
      } catch (tagErr) {
        console.error("[mailchimp-subscribe] Tag POST fetch error (non-blocking):", tagErr);
        Sentry.captureException(tagErr, { tags: { stage: "mailchimp-tags" } });
      }
    }

    // Skip the masterclass "Video 1 is ready" confirmation when this is a
    // waitlist/non-masterclass signup — wrong copy for those subscribers.
    const skipMasterclassConfirmation = tagList.includes("cohort-waitlist");

    // Send confirmation email via Resend (fire-and-forget, never blocks redirect)
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey && !skipMasterclassConfirmation) {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Casey Meehan <hello@blazingzebra.ai>",
          to: [email],
          subject: "You're in — Video 1 is ready",
          text: `Hey,

Thanks for signing up for the AI Systems Masterclass — you're in! And you've got perfect timing: Video 1 just went live.

Watch Video 1 here: https://join.long-game.ai/masterclass/training/plc-1/

In the first video I cover:

- The one-sentence test that separates a real AI system from a well-intentioned pile of tools
- The invisible lines that decide when AI helps your work and when it quietly takes it over
- Why your tools aren't the only parts of your system, and what happens when you forget the others
- The quiet beliefs shaping your AI setup right now
- Mapping the real limits of your system: time, cost, privacy, ethics

Video 2 drops in a few days — keep an eye on your inbox.

A few quick things so you don't miss it:

- Add hello@blazingzebra.ai to your contacts
- Check your Promotions or Spam folder and move this email to your Primary inbox
- Reply to this email with "got it" — it helps with deliverability

Talk soon,
Casey

P.S. Watch all the way to the end — that's where I unlock a quick exercise you can run right now.
Watch Video 1: https://join.long-game.ai/masterclass/training/plc-1/`,
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
