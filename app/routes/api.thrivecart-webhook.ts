import type { Route } from "./+types/api.thrivecart-webhook";
import { getSupabaseAdmin } from "~/lib/supabase-admin.server";
import { getUserByEmail } from "~/services/userService";
import { waitForAppUser } from "~/lib/wait-for-user";
import {
  createPurchase,
  findPurchaseByThrivecartOrderId,
  markPurchaseRefunded,
} from "~/services/purchaseService";
import {
  enrollUser,
  findEnrollment,
  unenrollUser,
} from "~/services/enrollmentService";

// ThriveCart sends HEAD to verify the endpoint exists
export async function loader({ request }: Route.LoaderArgs) {
  return new Response("OK", { status: 200 });
}

export async function action({ request }: Route.ActionArgs) {
  const secret = process.env.THRIVECART_SECRET;
  const courseId = parseInt(process.env.THRIVECART_COURSE_ID || "1", 10);

  if (!secret) {
    console.error("[thrivecart-webhook] THRIVECART_SECRET not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Parse URL-encoded body with bracket-notation keys
  const text = await request.text();
  const params = new URLSearchParams(text);

  // Validate secret
  const payloadSecret = params.get("thrivecart_secret");
  if (payloadSecret !== secret) {
    console.error("[thrivecart-webhook] Invalid secret");
    return new Response("Unauthorized", { status: 401 });
  }

  const event = params.get("event");
  console.log(`[thrivecart-webhook] Received event: ${event}`);

  switch (event) {
    case "order.success":
      return handleOrderSuccess(params, courseId);
    case "order.refund":
      return handleOrderRefund(params, courseId);
    default:
      console.log(`[thrivecart-webhook] Ignoring unhandled event: ${event}`);
      return new Response("OK", { status: 200 });
  }
}

function sanitize(value: string | null, maxLength: number): string {
  return (value ?? "").trim().slice(0, maxLength);
}

async function handleOrderSuccess(params: URLSearchParams, courseId: number) {
  const orderId = sanitize(params.get("order_id"), 100);
  const email = sanitize(params.get("customer[email]"), 254)?.toLowerCase();
  const firstName = sanitize(params.get("customer[first_name]"), 100);
  const lastName = sanitize(params.get("customer[last_name]"), 100);
  const totalStr = sanitize(params.get("order[0][total]"), 20) || "0";
  const affiliateId = sanitize(params.get("affiliate[id]"), 100) || undefined;

  if (!email) {
    console.error("[thrivecart-webhook] order.success missing customer email");
    return new Response("Missing customer email", { status: 400 });
  }

  if (!orderId) {
    console.error("[thrivecart-webhook] order.success missing order_id");
    return new Response("Missing order_id", { status: 400 });
  }

  // Idempotency: check if we already processed this order
  const existingPurchase = await findPurchaseByThrivecartOrderId(orderId);
  if (existingPurchase) {
    console.log(`[thrivecart-webhook] Order ${orderId} already processed, skipping`);
    return new Response("OK", { status: 200 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const name = `${firstName} ${lastName}`.trim() || email.split("@")[0];

  // 1. Create Supabase auth user (trigger auto-creates public.users row)
  const { data: createData, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    });

  if (createError && !createError.message?.includes("already") && createError.status !== 422) {
    console.error(`[thrivecart-webhook] Failed to create auth user: ${createError.message}`);
    return new Response("Failed to create auth user", { status: 500 });
  }

  if (createData?.user) {
    console.log(`[thrivecart-webhook] Created auth user ${createData.user.id} for ${email}`);
  }

  // 2. Wait briefly for trigger, then find the app user
  const appUser = await waitForAppUser(email);
  if (!appUser) {
    console.error(`[thrivecart-webhook] App user not found for ${email} after retries`);
    return new Response("App user not found", { status: 500 });
  }

  // 3. Create purchase record
  const pricePaid = parseInt(totalStr, 10) || 0;
  await createPurchase({ userId: appUser.id, courseId, pricePaid, country: null, thrivecartOrderId: orderId, affiliateId });
  console.log(`[thrivecart-webhook] Created purchase for order ${orderId}`);

  // 4. Enroll user (skip if already enrolled)
  const existing = await findEnrollment(appUser.id, courseId);
  if (!existing) {
    await enrollUser({ userId: appUser.id, courseId, sendEmail: false, skipValidation: true });
    console.log(`[thrivecart-webhook] Enrolled user ${appUser.id} in course ${courseId}`);
  }

  // 5. Send magic link email
  const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.APP_URL || "http://localhost:3000"}/auth/callback`,
    },
  });

  if (otpError) {
    console.error(`[thrivecart-webhook] Failed to send magic link: ${otpError.message}`);
  } else {
    console.log(`[thrivecart-webhook] Magic link sent to ${email}`);
  }

  return new Response("OK", { status: 200 });
}

async function handleOrderRefund(params: URLSearchParams, courseId: number) {
  const orderId = sanitize(params.get("order_id"), 100);
  const email = sanitize(params.get("customer[email]"), 254)?.toLowerCase();

  if (!orderId) {
    console.error("[thrivecart-webhook] order.refund missing order_id");
    return new Response("OK", { status: 200 }); // Don't retry
  }

  // Mark purchase as refunded
  const purchase = await findPurchaseByThrivecartOrderId(orderId);
  if (purchase) {
    await markPurchaseRefunded(purchase.id);
    console.log(`[thrivecart-webhook] Marked purchase ${purchase.id} as refunded`);
  } else {
    console.warn(`[thrivecart-webhook] No purchase found for order ${orderId}`);
  }

  // Revoke enrollment
  if (email) {
    const appUser = await getUserByEmail(email);
    if (appUser) {
      try {
        await unenrollUser(appUser.id, courseId);
        console.log(`[thrivecart-webhook] Unenrolled user ${appUser.id} from course ${courseId}`);
      } catch (err) {
        if (err instanceof Error && err.message.includes("not enrolled")) {
          console.log(`[thrivecart-webhook] User ${appUser.id} was not enrolled, nothing to revoke`);
        } else {
          console.error(`[thrivecart-webhook] Failed to unenroll user ${appUser.id}:`, err);
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
}
