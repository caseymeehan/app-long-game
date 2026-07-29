import * as Sentry from "@sentry/react-router";
import { z } from "zod";
import type { Route } from "./+types/api.ac-subscribe";

/**
 * ActiveCampaign opt-in endpoint for the join.blazingzebra.ai funnel.
 *
 * Mirrors api.mailchimp-subscribe.ts in shape (form POST in, 302 out, errors
 * surface as ?error=1 on the redirect target) but talks to ActiveCampaign.
 *
 * The notable difference from MailChimp: AC addresses lists, tags, and custom
 * fields by numeric ID, not by name. Those IDs are config, not user input —
 * see AC_LIST_ID / AC_TAG_ID / AC_AFFILIATE_FIELD_ID.
 *
 * Delivery of the training link is NOT handled here. It is an ActiveCampaign
 * automation triggered by the tag, so the copy stays editable without a deploy.
 */

const subscribeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().default(""),
  affiliateRef: z.string().optional().default(""),
  redirectTo: z
    .string()
    .url()
    .optional()
    .default("https://join.blazingzebra.ai/thank-you/"),
});

const ALLOWED_ORIGINS = [
  "https://join.blazingzebra.ai",
  "https://join.long-game.ai",
];

const FALLBACK_REDIRECT = "https://join.blazingzebra.ai/thank-you/";

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

/** Only redirect to hosts we own — an open redirect here would be a phishing vector. */
function safeRedirect(candidate: string): string {
  try {
    const url = new URL(candidate);
    const ok = ALLOWED_ORIGINS.some((o) => new URL(o).host === url.host);
    return ok ? url.toString() : FALLBACK_REDIRECT;
  } catch {
    return FALLBACK_REDIRECT;
  }
}

function redirect(to: string, request: Request, error = false) {
  const url = error ? `${to}${to.includes("?") ? "&" : "?"}error=1` : to;
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...corsHeaders(request) },
  });
}

// OPTIONS preflight + HEAD/GET check
export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  return new Response("OK", { status: 200, headers: corsHeaders(request) });
}

export const action = Sentry.wrapServerAction(
  { name: "ac-subscribe" },
  async ({ request }: Route.ActionArgs) => {
    const apiUrl = process.env.AC_API_URL;
    const apiKey = process.env.AC_API_KEY;
    const listId = process.env.AC_LIST_ID;
    const tagId = process.env.AC_TAG_ID;
    const affiliateFieldId = process.env.AC_AFFILIATE_FIELD_ID;

    Sentry.setTag("webhook", "ac-subscribe");

    if (!apiUrl || !apiKey || !listId || !tagId) {
      console.error("[ac-subscribe] Missing AC env vars");
      Sentry.captureException(new Error("Missing AC env vars"), {
        tags: { stage: "config" },
      });
      return redirect(FALLBACK_REDIRECT, request, true);
    }

    const formData = await request.formData();
    const parsed = subscribeSchema.safeParse({
      email: formData.get("email") ?? undefined,
      firstName: formData.get("firstName") ?? undefined,
      affiliateRef: formData.get("affiliateRef") ?? undefined,
      redirectTo: formData.get("redirectTo") ?? undefined,
    });

    if (!parsed.success) {
      console.error("[ac-subscribe] Validation failed:", parsed.error.message);
      const raw = formData.get("redirectTo");
      const fallback =
        typeof raw === "string" && raw ? safeRedirect(raw) : FALLBACK_REDIRECT;
      return redirect(fallback, request, true);
    }

    const { email, firstName, affiliateRef, redirectTo } = parsed.data;
    const target = safeRedirect(redirectTo);

    const acHeaders = {
      "Api-Token": apiKey,
      "Content-Type": "application/json",
    };

    try {
      // 1. Upsert the contact. contact/sync matches on email, so a repeat
      //    opt-in updates rather than erroring on a duplicate.
      const syncRes = await fetch(`${apiUrl}/api/3/contact/sync`, {
        method: "POST",
        headers: acHeaders,
        body: JSON.stringify({
          contact: {
            email,
            ...(firstName ? { firstName } : {}),
            ...(affiliateRef && affiliateFieldId
              ? {
                  fieldValues: [
                    { field: affiliateFieldId, value: affiliateRef },
                  ],
                }
              : {}),
          },
        }),
      });

      if (!syncRes.ok) {
        const body = await syncRes.text();
        console.error(
          `[ac-subscribe] contact/sync error ${syncRes.status}: ${body}`
        );
        Sentry.captureException(
          new Error(`AC contact/sync error ${syncRes.status}`),
          {
            tags: { stage: "ac-sync" },
            extra: { status: syncRes.status, body: body.slice(0, 500) },
          }
        );
        return redirect(target, request, true);
      }

      const syncJson = (await syncRes.json()) as {
        contact?: { id?: string };
      };
      const contactId = syncJson.contact?.id;

      if (!contactId) {
        console.error("[ac-subscribe] contact/sync returned no contact id");
        Sentry.captureException(new Error("AC sync returned no contact id"), {
          tags: { stage: "ac-sync" },
        });
        return redirect(target, request, true);
      }

      // 2. Subscribe to the list (status 1 = active). Without this the contact
      //    exists but is not mailable.
      const listRes = await fetch(`${apiUrl}/api/3/contactLists`, {
        method: "POST",
        headers: acHeaders,
        body: JSON.stringify({
          contactList: {
            list: Number(listId),
            contact: Number(contactId),
            status: 1,
          },
        }),
      });

      if (!listRes.ok) {
        const body = await listRes.text();
        console.error(
          `[ac-subscribe] contactLists error ${listRes.status}: ${body}`
        );
        Sentry.captureException(
          new Error(`AC contactLists error ${listRes.status}`),
          {
            tags: { stage: "ac-list" },
            extra: { status: listRes.status, body: body.slice(0, 500) },
          }
        );
        return redirect(target, request, true);
      }

      // 3. Apply the tag. This is what fires the delivery automation, so a
      //    failure here means the subscriber gets nothing — treat it as fatal
      //    rather than best-effort.
      const tagRes = await fetch(`${apiUrl}/api/3/contactTags`, {
        method: "POST",
        headers: acHeaders,
        body: JSON.stringify({
          contactTag: { contact: String(contactId), tag: String(tagId) },
        }),
      });

      if (!tagRes.ok) {
        const body = await tagRes.text();
        console.error(
          `[ac-subscribe] contactTags error ${tagRes.status}: ${body}`
        );
        Sentry.captureException(
          new Error(`AC contactTags error ${tagRes.status}`),
          {
            tags: { stage: "ac-tag" },
            extra: { status: tagRes.status, body: body.slice(0, 500) },
          }
        );
        return redirect(target, request, true);
      }

      console.log(
        `[ac-subscribe] Subscribed ${email} (contact ${contactId}, ref: ${affiliateRef || "none"})`
      );

      return redirect(target, request);
    } catch (err) {
      console.error("[ac-subscribe] Fetch error:", err);
      Sentry.captureException(err, { tags: { stage: "ac-fetch" } });
      return redirect(target, request, true);
    }
  }
);
