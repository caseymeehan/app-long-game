import { createHash } from "crypto";
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

export async function action({ request }: Route.ActionArgs) {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = process.env.MAILCHIMP_LIST_ID;
  const dc = process.env.MAILCHIMP_DC;

  if (!apiKey || !listId || !dc) {
    console.error("[mailchimp-subscribe] Missing MAILCHIMP env vars");
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
      return new Response(null, {
        status: 302,
        headers: { Location: `${redirectTo}?error=1`, ...corsHeaders },
      });
    }

    console.log(`[mailchimp-subscribe] Subscribed ${email} (ref: ${affiliateRef || "none"})`);
    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo, ...corsHeaders },
    });
  } catch (err) {
    console.error("[mailchimp-subscribe] Fetch error:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${redirectTo}?error=1`, ...corsHeaders },
    });
  }
}
